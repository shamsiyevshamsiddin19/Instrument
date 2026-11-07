/**
 * extension.js  —  Custom Touchpad Gestures
 * uuid: touchpad-gestures@alpha.com
 *
 * Tested on: GNOME Shell 50 / Ubuntu 26.04 / Wayland
 *
 * KEY DESIGN DECISIONS
 * ════════════════════
 * 1. Uses 'captured-event::touchpad' (detail-filtered capture phase signal)
 *    to intercept touchpad events BEFORE GNOME's built-in handlers see them.
 *    Returning EVENT_STOP from capture phase prevents bubble-phase handlers.
 *
 * 2. Disables GNOME's built-in swipe trackers at THREE levels:
 *    a) Sets tracker.enabled = false on each SwipeTracker
 *    b) Sets tracker._touchpadGesture.enabled = false (inner gesture object)
 *    c) Disconnects the _touchpadGesture from global.stage via destroy()
 *    This ensures GNOME never processes our touchpad events.
 *
 * 3. Uses GNOME Shell 50 API:
 *    - w.is_maximized() instead of removed w.get_maximized()
 *    - w.maximize() / w.unmaximize() without Meta.MaximizeFlags
 *
 * 4. Delta accumulation across UPDATE phases, direction resolved at END.
 *
 * 5. Hold events detect multi-finger taps (short hold → tap).
 *
 * 6. Actions dispatched via GLib.idle_add to avoid re-entrancy.
 *
 * 7. Volume via Gvc.MixerControl, brightness via D-Bus, media via MPRIS.
 * 8. Volume/Brightness respond continuously during swipe UPDATE phase.
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { GrabHelper } from 'resource:///org/gnome/shell/ui/grabHelper.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import Soup from 'gi://Soup';
import St from 'gi://St';
import Shell from 'gi://Shell';
import Pango from 'gi://Pango';
import {chooseExample, englishLookup} from './example-utils.js';
import {VocabularyStore, Pronunciation} from './learning-services.js';


// ── Swipe detection threshold (accumulated px) ────────────────────────────────
const SWIPE_THRESHOLD = 15;

// ── Tap detection: max duration in ms for a hold to count as tap ──────────────
const TAP_MAX_DURATION_MS = 500;

// ── Volume/Brightness step per swipe-update delta pixel ───────────────────────
const VOL_STEP_PER_PX = 0.0012;
const BRIGHT_STEP_PER_PX = 0.0012;
const OSD_THROTTLE_MS = 120;

// ── MPRIS D-Bus interface XML ─────────────────────────────────────────────────
const MPRIS_PLAYER_IFACE = 'org.mpris.MediaPlayer2.Player';

// ── Action indices — MUST match dropdown order in prefs.js ───────────────────
const V = { ACTIVITIES: 0, VOLUME: 1, BRIGHTNESS: 2, MAX_MIN: 3, CLOSE: 4, SHOW_DESKTOP: 5, CUSTOM: 6, DISABLED: 7 };
const L = { WS_LEFT: 0, BRIGHT_DOWN: 1, ALTTAB_PREV: 2, MEDIA_PREV: 3, CUSTOM: 4, DISABLED: 5 };
const R = { WS_RIGHT: 0, BRIGHT_UP: 1, ALTTAB_NEXT: 2, MEDIA_NEXT: 3, CUSTOM: 4, DISABLED: 5 };
const T = { PLAY_PAUSE: 0, SHOW_DESKTOP: 1, CYCLE_WS: 2, NOTIFS: 3, CUSTOM: 4, DISABLED: 5 };

const MAX_V = 7, MAX_L = 5, MAX_R = 5, MAX_T = 5;


/* ── Quick Translate Helpers (OpenAI Aesthetic at Pointer) ─────────────────── */
const soupSession = new Soup.Session({timeout: 12});

function fetchOne(text, src, tgt, callback, cancellable) {
    // Har bir so'rov bekor qilinadi; HTTP va javob tuzilishi tekshiriladi.
    const url = 'https://translate.googleapis.com/translate_a/single?client=dict-chrome-ex&sl=' +
        encodeURIComponent(src) + '&tl=' + encodeURIComponent(tgt) + '&dt=t&q=' + encodeURIComponent(text);
    const msg = Soup.Message.new('GET', url);
    soupSession.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, cancellable, (session, res) => {
        let translated, detected, error;
        try {
            const bytes = session.send_and_read_finish(res);
            if (msg.status_code !== 200) throw new Error('Tarjima xizmati javob bermadi (' + msg.status_code + ').');
            const data = JSON.parse(new TextDecoder().decode(bytes.get_data()));
            if (!Array.isArray(data[0])) throw new Error('Tarjima javobi noto‘g‘ri.');
            translated = data[0].filter(Array.isArray).map(part => part[0] || '').join('');
            detected = typeof data[2] === 'string' ? data[2].toUpperCase() : src.toUpperCase();
            if (!translated) throw new Error('Tarjima topilmadi.');
        } catch (e) {
            error = 'Tarjima olinmadi. Internet aloqasini tekshirib, qayta urinib ko‘ring.';
        }
        if (!cancellable?.is_cancelled()) callback(translated, detected, error);
    });
}

function requestMultiTranslation(text, callback, cancellable, source = 'auto') {
    fetchOne(text, source, 'uz', (first, src, error) => {
        if (error) { callback(null, error); return; }
        if (source !== 'auto') src = source.toUpperCase();
        const targets = src === 'UZ' ? ['RU', 'EN'] : src === 'EN' ? ['UZ', 'RU'] : ['UZ', 'EN'];
        const items = new Array(2);
        let remaining = 2;
        const complete = (index, translation, failure) => {
            // Xatoda asl matnni boshqa til tarjimasi deb ko'rsatmaymiz.
            items[index] = {tag: targets[index], text: translation || '', error: failure || null};
            if (--remaining === 0) callback({src, items});
        };
        targets.forEach((target, index) => {
            if (target === 'UZ') complete(index, first, null);
            else fetchOne(text, src.toLowerCase(), target.toLowerCase(),
                (value, _source, failure) => complete(index, value, failure), cancellable);
        });
    }, cancellable);
}

function fetchDictionaryExample(text, language, callback, cancellable) {
    const url = 'https://translate.googleapis.com/translate_a/single?client=dict-chrome-ex&dj=1&dt=ex&dt=md&sl=' +
        encodeURIComponent(language.toLowerCase()) + '&tl=' + (language === 'EN' ? 'uz' : 'en') +
        '&q=' + encodeURIComponent(text);
    const message = Soup.Message.new('GET', url);
    soupSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, cancellable, (session, response) => {
        let example = '', failed = false;
        try {
            const bytes = session.send_and_read_finish(response);
            if (message.status_code !== 200) throw new Error('HTTP error');
            const data = JSON.parse(new TextDecoder().decode(bytes.get_data()));
            example = chooseExample(data);
        } catch (_error) { failed = true; }
        if (!cancellable.is_cancelled()) callback(example, failed);
    });
}

function getSelection(callback, cancellable) {
    // Faqat belgilangan matn: eski clipboardni tasodifan serverga yubormaymiz.
    let proc;
    try {
        proc = Gio.Subprocess.new(['wl-paste', '--primary', '--no-newline', '--type', 'text'],
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
    } catch (e) {
        callback('', 'wl-paste ishga tushmadi.');
        return;
    }
    let timeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
        timeout = 0;
        proc.force_exit();
        return GLib.SOURCE_REMOVE;
    });
    proc.communicate_utf8_async(null, cancellable, (p, res) => {
        let text = '';
        try {
            const [ok, stdout] = p.communicate_utf8_finish(res);
            if (ok && p.get_successful()) text = (stdout || '').trim();
        } catch (e) { proc.force_exit(); }
        if (timeout) GLib.source_remove(timeout);
        if (!cancellable.is_cancelled()) callback(text);
    });
}

function getTruePointerCoords() {
    try {
        let tracker = Meta.CursorTracker.get_for_display(global.display);
        if (tracker && tracker.get_pointer) {
            let res = tracker.get_pointer();
            if (res) {
                let coords = res[0];
                if (coords && typeof coords.x === 'number' && typeof coords.y === 'number') {
                    if (Number.isFinite(coords.x) && Number.isFinite(coords.y)) {
                        return [Math.round(coords.x), Math.round(coords.y)];
                    }
                }
                if (typeof res[0] === 'number' && typeof res[1] === 'number') {
                    if (Number.isFinite(res[0]) && Number.isFinite(res[1])) {
                        return [Math.round(res[0]), Math.round(res[1])];
                    }
                }
            }
        }
    } catch (e) {
        console.error('[QuickTranslate] Error getting tracker coords:', e);
    }

    try {
        let [x, y] = global.get_pointer();
        if (Number.isFinite(x) && Number.isFinite(y)) return [Math.round(x), Math.round(y)];
    } catch (e) {}

    try {
        let win = global.display ? global.display.get_focus_window() : null;
        if (win) {
            let rect = win.get_frame_rect();
            return [Math.round(rect.x + rect.width / 2), Math.round(rect.y + rect.height / 3)];
        }
    } catch (e) {}

    let mon = Main.layoutManager.primaryMonitor;
    return [Math.round(mon.x + mon.width / 2), Math.round(mon.y + mon.height / 2)];
}

class QuickTranslatePopup {
    constructor(pointerX, pointerY, originalText) {
        let mon = Main.layoutManager.primaryMonitor;
        this.pointerX = Number.isFinite(pointerX) ? pointerX : Math.round(mon.x + mon.width / 2);
        this.pointerY = Number.isFinite(pointerY) ? pointerY : Math.round(mon.y + mon.height / 2);
        this.originalText = originalText;
        this._timerId = null;
        this._stageClickId = null;
        this._stageKeyId = null;
        this._copiedText = '';
        this._destroyed = false;
        this._ready = false;
        this.state = 'loading';
        this._voice = new Pronunciation();
        this._store = new VocabularyStore();

        this._createWidget();
        this._positionWidget();
        this._setupEvents();
        // GNOME o'zining popup mexanizmi fokus va tashqi bosishlarni boshqaradi.
        this._grabHelper = new GrabHelper(this._overlay, {
            // Popup rejimi Print Screen kabi ruxsat etilgan tizim tugmalarini saqlaydi.
            actionMode: Shell.ActionMode.POPUP,
        });
        if (!this._grabHelper.grab({
            actor: this.actor,
            focus: this.actor,
            onUngrab: () => this.destroy(),
        })) {
            this.destroy(true);
            Main.notify('Tezkor tarjimon', 'Oyna ochilmadi. Boshqa menyuni yopib, qayta urinib ko‘ring.');
        }
    }

    _createWidget() {
        this.actor = new St.BoxLayout({
            vertical: true,
            reactive: true,
            can_focus: true,
            track_hover: true,
            width: 480,
            height: 300,
        });
        this.actor.set_size(480, 300);

        // Standard plastic bank card proportions: 480x300 px (1.6:1 aspect ratio), OpenAI dark theme
        this.actor.set_style(
            'background-color: #121212; ' +
            'border: 1px solid rgba(255, 255, 255, 0.14); ' +
            'border-radius: 18px; ' +
            'padding: 24px 28px; ' +
            'box-shadow: 0 24px 60px rgba(0, 0, 0, 0.9); ' +
            'min-width: 480px; ' +
            'max-width: 480px; ' +
            'min-height: 300px; ' +
            'max-height: 300px;'
        );

        // Header: Pill + Close button
        let header = new St.BoxLayout({ vertical: false, style: 'margin-bottom: 16px;' });

        this.pill = new St.Label({
            text: 'TRANSLATING',
            style: 'background-color: #242424; color: #a1a1aa; font-size: 11px; font-weight: bold; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.1); padding: 4px 12px; letter-spacing: 0.5px;'
        });
        header.add_child(this.pill);

        let spacer = new St.Widget({ x_expand: true });
        header.add_child(spacer);

        this.closeBtn = new St.Button({
            label: '×',
            reactive: true,
            style: 'color: #71717a; font-size: 22px; font-weight: bold; padding: 0 6px;'
        });
        this.closeBtn.connect('clicked', () => this.destroy());
        header.add_child(this.closeBtn);
        this.actor.add_child(header);

        // Center section: container for translations & original
        let bodyBox = new St.BoxLayout({ vertical: true, y_expand: true, x_expand: true });

        // Item 1 (Primary / RU)
        this.row1 = new St.BoxLayout({ vertical: false, style: 'margin-bottom: 12px;' });
        this.tag1 = new St.Button({
            label: '',
            can_focus: true,
            reactive: false,
            visible: false,
            style: 'background-color: #202024; color: #94a3b8; font-size: 11px; font-weight: 700; border-radius: 5px; border: 1px solid #33333f; padding: 2px 7px; margin-right: 12px; margin-top: 4px;'
        });
        this.row1.add_child(this.tag1);
        this.tag1.connect('clicked', () => this._showExample(0));

        this.trans1 = new St.Label({
            text: '...',
            style: 'color: #ffffff; font-size: 22px; font-weight: 600; line-height: 1.3;'
        });
        this.trans1.clutter_text.line_wrap = true;
        this.trans1.x_expand = true;
        this.trans1.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        this.row1.add_child(this.trans1);
        this.speak1 = this._iconButton('audio-volume-high-symbolic', 'Birinchi tarjimani tinglash',
            () => this._speak(this._items?.[0]));
        this.speak1.reactive = false;
        this.row1.add_child(this.speak1);
        bodyBox.add_child(this.row1);

        // Item 2 (Secondary / EN)
        this.row2 = new St.BoxLayout({ vertical: false, visible: false, style: 'margin-bottom: 12px;' });
        this.tag2 = new St.Button({
            label: '',
            can_focus: true,
            reactive: false,
            style: 'background-color: #202024; color: #94a3b8; font-size: 11px; font-weight: 700; border-radius: 5px; border: 1px solid #33333f; padding: 2px 7px; margin-right: 12px; margin-top: 4px;'
        });
        this.row2.add_child(this.tag2);
        this.tag2.connect('clicked', () => this._showExample(1));

        this.trans2 = new St.Label({
            text: '',
            style: 'color: #e4e4e7; font-size: 20px; font-weight: 500; line-height: 1.3;'
        });
        this.trans2.clutter_text.line_wrap = true;
        this.trans2.x_expand = true;
        this.trans2.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        this.row2.add_child(this.trans2);
        this.speak2 = this._iconButton('audio-volume-high-symbolic', 'Ikkinchi tarjimani tinglash',
            () => this._speak(this._items?.[1]));
        this.speak2.reactive = false;
        this.row2.add_child(this.speak2);
        bodyBox.add_child(this.row2);

        this.exampleLabel = new St.Label({
            text: '', visible: false, x_expand: true,
            style: 'color: #b4b4b4; font-size: 15px; margin-top: 8px; margin-bottom: 12px;',
        });
        this.exampleLabel.clutter_text.line_wrap = true;
        this.exampleLabel.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        bodyBox.add_child(this.exampleLabel);
        this.meaningLabel = new St.Label({
            text: '', visible: false, x_expand: true,
            style: 'color: #929292; font-size: 12px; margin-bottom: 10px;',
        });
        this.meaningLabel.clutter_text.line_wrap = true;
        this.meaningLabel.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        bodyBox.add_child(this.meaningLabel);
        this.exampleSpeak = this._iconButton('audio-volume-high-symbolic', 'Misol gapni tinglash',
            () => this._speak(this._activeExample));
        this.exampleSpeak.visible = false;
        bodyBox.add_child(this.exampleSpeak);

        // Body spacer to push original to bottom
        let midSpacer = new St.Widget({ y_expand: true });
        bodyBox.add_child(midSpacer);

        // Original snippet
        let origSnippet = (this.originalText || '').replace(/\s+/g, ' ');
        if (origSnippet.length > 80) origSnippet = origSnippet.slice(0, 77) + '...';
        this.origLabel = new St.Label({
            text: origSnippet,
            style: 'color: #71717a; font-size: 13px; line-height: 1.3;'
        });
        this.origLabel.clutter_text.line_wrap = true;
        this.origLabel.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        this.origLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        bodyBox.add_child(this.origLabel);

        const scroll = new St.ScrollView({x_expand: true, y_expand: true});
        scroll.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
        scroll.add_child(bodyBox);
        this.actor.add_child(scroll);
        this._mainScroll = scroll;

        this._libraryBody = new St.BoxLayout({vertical: true, x_expand: true});
        this._libraryScroll = new St.ScrollView({visible: false, x_expand: true, y_expand: true});
        this._libraryScroll.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
        this._libraryScroll.add_child(this._libraryBody);
        this.actor.add_child(this._libraryScroll);

        this._statusLabel = new St.Label({text: '', visible: false,
            style: 'font-size: 11px; color: #b4b4b4;'});
        this._statusLabel.clutter_text.line_wrap = true;
        this.actor.add_child(this._statusLabel);

        // Bottom Row: Hint + Copy button
        this.bottomRow = new St.BoxLayout({ vertical: false, style: 'margin-top: 14px;' });

        this.saveBtn = this._textButton('Saqlash', () => this._saveWord());
        this.saveBtn.reactive = false;
        this.bottomRow.add_child(this.saveBtn);
        this.libraryBtn = this._textButton('Lug‘at', () => this._toggleLibrary());
        this.bottomRow.add_child(this.libraryBtn);

        let bSpacer = new St.Widget({ x_expand: true });
        this.bottomRow.add_child(bSpacer);

        this.copyBtn = new St.Button({
            label: 'Copy',
            reactive: false,
            can_focus: true,
            style: 'background-color: #27272a; color: #f4f4f5; font-size: 12px; font-weight: 600; border-radius: 8px; border: 1px solid #3f3f46; padding: 6px 18px;'
        });
        this.copyBtn.connect('clicked', () => this._copy());
        this.bottomRow.add_child(this.copyBtn);
        this.actor.add_child(this.bottomRow);

        this._overlay = new St.Widget({reactive: true, can_focus: true});
        this._overlay.add_constraint(new Clutter.BindConstraint({
            source: global.stage,
            coordinate: Clutter.BindCoordinate.ALL,
        }));
        this._overlay.add_child(this.actor);
        Main.layoutManager.addTopChrome(this._overlay);
        this.actor.opacity = 0;
        this.actor.ease({
            opacity: 255,
            duration: 100,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD
        });
    }

    _positionWidget() {
        let monitor = Main.layoutManager.primaryMonitor;
        for (let m of Main.layoutManager.monitors) {
            if (this.pointerX >= m.x && this.pointerX < m.x + m.width &&
                this.pointerY >= m.y && this.pointerY < m.y + m.height) {
                monitor = m;
                break;
            }
        }

        let w = 480;
        let h = 300;

        // Center horizontally on pointer, position right above cursor
        let posX = Math.round(this.pointerX - w / 2);
        let posY = Math.round(this.pointerY - h - 16);

        // If not enough room above cursor, place directly below cursor
        if (posY < monitor.y + 40) {
            posY = Math.round(this.pointerY + 24);
        }

        // Clamp to monitor boundaries
        if (posX + w > monitor.x + monitor.width - 20) {
            posX = monitor.x + monitor.width - w - 20;
        }
        if (posX < monitor.x + 20) {
            posX = monitor.x + 20;
        }
        if (posY + h > monitor.y + monitor.height - 20) {
            posY = monitor.y + monitor.height - h - 20;
        }
        if (posY < monitor.y + 36) {
            posY = monitor.y + 36;
        }

        this.actor.set_position(posX, posY);
    }

    setResult(resultData) {
        if (this._destroyed) return;
        this._clearDeadline();
        this.state = 'ready';
        if (!resultData || !resultData.items || resultData.items.length === 0) {
            this.setError('No translation found');
            return;
        }

        let src = resultData.src || 'AUTO';
        let items = resultData.items;
        this._resultSource = src;
        this._savedCurrent = false;
        this._voice?.stop();
        this._speechPlaying = false;
        this._meaningCache = new Map();
        this.meaningLabel.visible = false;
        this.exampleLabel.visible = false;
        this.exampleSpeak.visible = false;
        this._activeExample = null;
        this.speak1.reactive = Boolean(items[0]?.text && ['RU', 'EN'].includes(items[0]?.tag));
        this.speak2.reactive = Boolean(items[1]?.text && ['RU', 'EN'].includes(items[1]?.tag));
        this.saveBtn.reactive = items.every(item => item.text && !item.error);
        this.saveBtn.set_label('Saqlash');
        this._items = items;
        this._exampleCache = new Map();
        this.tag1.reactive = Boolean(items[0]?.text && !items[0]?.error);
        this.tag2.reactive = Boolean(items[1]?.text && !items[1]?.error);

        if (items.length >= 2) {
            let tags = items.map(it => it.tag).join(' · ');
            this.pill.set_text(src + ' → ' + tags);

            this.tag1.set_label(items[0].tag);
            this.tag1.visible = true;
            this.trans1.set_text(items[0].text || items[0].error || 'Tarjima olinmadi');

            this.tag2.set_label(items[1].tag);
            this.tag2.visible = true;
            this.trans2.set_text(items[1].text || items[1].error || 'Tarjima olinmadi');
            this.row2.visible = true;

            this._copiedText = items[0].tag + ': ' + items[0].text + '\n' + items[1].tag + ': ' + items[1].text;
        } else {
            this.pill.set_text(src + ' → ' + items[0].tag);
            this.tag1.set_label(items[0].tag);
            this.tag1.visible = true;
            this.trans1.set_text(items[0].text);
            this.row2.visible = false;
            this._copiedText = items[0].text;
        }

        this._copiedText = items.filter(item => item.text && !item.error)
            .map(item => item.tag + ': ' + item.text).join('\n');
        this.copyBtn.reactive = Boolean(this._copiedText);
        this._ready = true;
        this._positionWidget();
        this._startAutoClose(8000);
    }

    setError(err) {
        if (this._destroyed) return;
        this._clearDeadline();
        this.state = 'error';
        this._ready = true;
        this._copiedText = '';
        this.copyBtn.reactive = false;
        this.tag1.reactive = false;
        this.tag2.reactive = false;
        this.speak1.reactive = false;
        this.speak2.reactive = false;
        this.saveBtn.reactive = false;
        this.pill.set_text('NOTICE');
        this.tag1.visible = false;
        this.trans1.set_text(err || 'Failed to translate');
        this.row2.visible = false;
        this._positionWidget();
        this._startAutoClose(8000);
    }

    _showExample(index) {
        const item = this._items?.[index];
        if (this._destroyed || !item?.text || item.error) return;
        this._exampleRequest?.cancel();
        this._meaningRequest?.cancel();
        if (this._meaningTimer) GLib.source_remove(this._meaningTimer);
        this._meaningTimer = 0;
        this._meaningLoading = false;
        if (this.meaningLabel) this.meaningLabel.visible = false;
        if (this._exampleTimer) GLib.source_remove(this._exampleTimer);
        this._exampleTimer = 0;
        const request = new Gio.Cancellable();
        this._exampleRequest = request;
        this._activeExample = null;
        if (this.exampleSpeak) this.exampleSpeak.visible = false;
        this.exampleLabel.visible = true;
        this.tag1.set_label(this._items[0].tag + (index === 0 ? ' ·' : ''));
        if (this._items[1]) this.tag2.set_label(this._items[1].tag + (index === 1 ? ' ·' : ''));
        const finish = (text, cache = false) => {
            if (this._destroyed || request.is_cancelled() || this._exampleRequest !== request) return;
            if (this._exampleTimer) GLib.source_remove(this._exampleTimer);
            this._exampleTimer = 0;
            this._exampleLoading = false;
            this.exampleLabel.set_text(item.tag + ' — ' + text);
            if (cache) this._exampleCache.set(item.tag, text);
            if (cache && this._savedCurrent) this._saveWord(true);
            if (cache || this._exampleCache.has(item.tag)) {
                this._showMeaning?.(text, item.tag);
                this._activeExample = {tag: item.tag, text};
                if (this.exampleSpeak) {
                    this.exampleSpeak.visible = ['RU', 'EN'].includes(item.tag);
                    this.exampleSpeak.reactive = Array.from(text).length <= 200;
                }
            }
            this._startAutoClose(8000);
        };
        if (this._exampleCache.has(item.tag)) {
            finish(this._exampleCache.get(item.tag));
            return;
        }
        this._exampleLoading = true;
        this._startAutoClose(8000);
        this.exampleLabel.set_text(item.tag + ' — Misol yuklanmoqda…');
        this._exampleTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 15000, () => {
            this._exampleTimer = 0;
            finish('Misol olinmadi. Qayta bosib urinib ko‘ring.');
            request.cancel();
            return GLib.SOURCE_REMOVE;
        });
        const fromEnglish = () => {
            const lookup = english => {
                fetchDictionaryExample(englishLookup(english), 'EN', (example, failed) => {
                    if (!example) {
                        finish(failed ? 'Internet aloqasini tekshirib, qayta urinib ko‘ring.' :
                            'Bu so‘z yoki ibora uchun misol topilmadi.');
                        return;
                    }
                    if (item.tag === 'EN') { finish(example, true); return; }
                    fetchOne(example, 'en', item.tag.toLowerCase(), (translated, _src, error) => {
                        finish(error ? 'Misol tarjima qilinmadi. Qayta urinib ko‘ring.' : translated, !error);
                    }, request);
                }, request);
            };
            const english = this._items.find(value => value.tag === 'EN' && value.text && !value.error);
            if (english) lookup(english.text);
            else fetchOne(item.text, item.tag.toLowerCase(), 'en', (text, _src, error) => {
                if (error) finish('Misol olinmadi. Qayta urinib ko‘ring.');
                else lookup(text);
            }, request);
        };
        fetchDictionaryExample(item.text, item.tag, (example, failed) => {
            if (example) finish(example, true);
            else if (failed) finish('Internet aloqasini tekshirib, qayta urinib ko‘ring.');
            else fromEnglish();
        }, request);
    }


    _showMeaning(text, tag) {
        if (!this.meaningLabel || this._destroyed) return;
        this._meaningCache ??= new Map();
        const key = tag + ':' + text;
        const request = new Gio.Cancellable();
        this._meaningRequest = request;
        this.meaningLabel.visible = true;
        const finish = (translation, error) => {
            if (this._destroyed || request.is_cancelled() || this._meaningRequest !== request) return;
            if (this._meaningTimer) GLib.source_remove(this._meaningTimer);
            this._meaningTimer = 0;
            this._meaningLoading = false;
            this.meaningLabel.set_text(error ? 'O‘zbekcha tarjima olinmadi. Tilni qayta bosing.' : translation);
            if (!error) {
                this._meaningCache.set(key, translation);
                if (this._savedCurrent) this._saveWord(true);
            }
            this._startAutoClose(8000);
        };
        if (tag === 'UZ') { finish(text, null); return; }
        if (this._meaningCache.has(key)) { finish(this._meaningCache.get(key), null); return; }
        this._meaningLoading = true;
        this.meaningLabel.set_text('O‘zbekcha ma’nosi yuklanmoqda…');
        this._startAutoClose(8000);
        this._meaningTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 12000, () => {
            this._meaningTimer = 0;
            finish('', true);
            request.cancel();
            return GLib.SOURCE_REMOVE;
        });
        fetchOne(text, tag.toLowerCase(), 'uz',
            (translation, _source, error) => finish(translation, error), request);
    }

    _textButton(label, callback) {
        const button = new St.Button({label, reactive: true, can_focus: true,
            style: 'color: #ececec; background-color: #242424; border-radius: 7px; padding: 5px 9px; margin-right: 5px; font-size: 12px;'});
        button.connect('clicked', callback);
        return button;
    }

    _iconButton(icon, description, callback) {
        const button = new St.Button({reactive: true, can_focus: true,
            accessible_name: description, y_align: Clutter.ActorAlign.START,
            style: 'color: #b4b4b4; padding: 5px; border-radius: 7px;'});
        button.set_child(new St.Icon({icon_name: icon, icon_size: 16}));
        button.connect('clicked', callback);
        return button;
    }

    _status(text) {
        if (this._destroyed) return;
        this._statusLabel.set_text(text);
        this._statusLabel.visible = Boolean(text);
    }

    _speak(item) {
        if (this._destroyed || !item?.text || item.error) return;
        if (this._voice.process && this._speakingText === item.text) {
            this._voice.stop();
            this._speechPlaying = false;
            this._status('');
            this._startAutoClose(8000);
            return;
        }
        this._speakingText = item.text;
        this._speechPlaying = true;
        this._startAutoClose(8000);
        this._status('O‘qilmoqda… Qayta bosish — to‘xtatish.');
        this._voice.play(item.text, item.tag, error => {
            this._speechPlaying = false;
            this._status(error);
            this._startAutoClose(8000);
        });
    }


    _saveWord(quiet = false) {
        if (!this._items?.length || this._items.some(item => !item.text || item.error)) return;
        try {
            this._store.save({
                original: this.originalText, src: this._resultSource,
                items: this._items.map(item => ({tag: item.tag, text: item.text})),
                examples: Object.fromEntries(this._exampleCache || []),
                meanings: Object.fromEntries(this._meaningCache || []),
            });
            this.saveBtn.set_label('Saqlandi');
            this._savedCurrent = true;
            if (!quiet) this._status('So‘z va ochilgan misollar lug‘atga saqlandi.');
        } catch (error) { this._status(error.message || 'Saqlab bo‘lmadi.'); }
    }

    _toggleLibrary() {
        const opening = !this._libraryScroll.visible;
        this._libraryScroll.visible = opening;
        this._mainScroll.visible = !opening;
        this.libraryBtn.set_label(opening ? 'Orqaga' : 'Lug‘at');
        this.saveBtn.visible = !opening;
        this.copyBtn.visible = !opening;
        this._status('');
        if (opening) this._renderLibrary();
        this._startAutoClose(8000);
    }

    _libraryLabel(text) {
        const label = new St.Label({text, x_expand: true,
            style: 'font-size: 14px; color: #ececec; margin-bottom: 10px;'});
        label.clutter_text.line_wrap = true;
        label.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        this._libraryBody.add_child(label);
        return label;
    }

    _renderLibrary(page = 0) {
        this._libraryBody.destroy_all_children();
        let entries;
        try { entries = this._store.list(); }
        catch (error) { this._libraryLabel('Lug‘at ochilmadi. Asl fayl o‘zgartirilmadi.'); return; }
        if (!entries.length) {
            this._libraryLabel('Hali saqlangan so‘z yo‘q. Tarjimadan keyin “Saqlash”ni bosing.');
            return;
        }
        const offset = page * 20;
        this._libraryLabel('Saqlangan so‘zlar · ' + entries.length);
        entries.slice(offset, offset + 20).forEach(entry => {
            const title = entry.original.replace(/\s+/g, ' ');
            const button = this._textButton(title.length > 44 ? title.slice(0, 41) + '…' : title,
                () => this._reviewSaved(entry, page));
            this._libraryBody.add_child(button);
        });
        const navigation = new St.BoxLayout();
        if (page > 0) navigation.add_child(this._textButton('Oldingi', () => this._renderLibrary(page - 1)));
        if (offset + 20 < entries.length)
            navigation.add_child(this._textButton('Keyingi', () => this._renderLibrary(page + 1)));
        this._libraryBody.add_child(navigation);
    }

    _reviewSaved(entry, page) {
        this._libraryBody.destroy_all_children();
        this._libraryLabel(entry.original);
        const answer = this._libraryLabel(entry.items.map(item => item.tag + ': ' + item.text +
            (entry.examples?.[item.tag] ? '\n' + entry.examples[item.tag] : '') +
            (entry.meanings?.[item.tag + ':' + entry.examples?.[item.tag]] ?
                '\n' + entry.meanings[item.tag + ':' + entry.examples[item.tag]] : '')).join('\n\n'));
        answer.visible = false;
        const reveal = this._textButton('Tarjimasini eslang · Javob', () => {
            answer.visible = !answer.visible;
            reveal.set_label(answer.visible ? 'Javobni yashirish' : 'Javob');
        });
        this._libraryBody.add_child(reveal);
        for (const item of entry.items.filter(item => ['RU', 'EN'].includes(item.tag)))
            this._libraryBody.add_child(this._textButton(item.tag + ' · Tinglash', () => this._speak(item)));
        this._libraryBody.add_child(this._textButton('Ro‘yxatga', () => this._renderLibrary(page)));
        let confirmed = false;
        const remove = this._textButton('O‘chirish', () => {
            if (!confirmed) { confirmed = true; remove.set_label('O‘chirishni tasdiqlash'); return; }
            try { this._store.remove(entry.id); this._renderLibrary(0); }
            catch (error) { this._status('O‘chirib bo‘lmadi.'); }
        });
        this._libraryBody.add_child(remove);
    }

    _copy() {
        if (!this._copiedText) return;
        St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, this._copiedText);
        this.copyBtn.set_label('Copied');
        if (this._copyTimer) GLib.source_remove(this._copyTimer);
        this._copyTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
            this._copyTimer = 0;
            if (!this._destroyed) this.copyBtn.set_label('Copy');
            return GLib.SOURCE_REMOVE;
        });
    }

    _setupEvents() {
        // Bolalar orasidagi enter/leave hodisalari taymerni buzmasin.
        this.actor.connect('notify::hover', () => {
            this._startAutoClose(8000);
        });

        // Faqat tezkor tugma shu qatlamda ishlanadi; Esc/tashqi bosish GrabHelperda.
        this._stageClickId = this._overlay.connect('captured-event', (_actor, event) => {
            if (event.type() !== Clutter.EventType.KEY_PRESS) return Clutter.EVENT_PROPAGATE;
            const symbol = event.get_key_symbol();
            const state = event.get_state();
            const ctrlAlt = Clutter.ModifierType.CONTROL_MASK | Clutter.ModifierType.MOD1_MASK;
            const forbidden = Clutter.ModifierType.SHIFT_MASK | Clutter.ModifierType.SUPER_MASK;
            if ((symbol === Clutter.KEY_z || symbol === Clutter.KEY_Z) &&
                (state & ctrlAlt) === ctrlAlt && !(state & forbidden)) {
                this.destroy();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        Main.overview.connectObject('showing', () => this.destroy(true), this);
        Main.sessionMode.connectObject('updated', () => this.destroy(true), this);
        Main.layoutManager.connectObject('monitors-changed', () => this.destroy(true), this);
    }

    _clearDeadline() {
        if (this._deadlineId) {
            GLib.source_remove(this._deadlineId);
            this._deadlineId = 0;
        }
    }

    startRequest(request) {
        if (this._destroyed) {
            request.cancel();
            return false;
        }
        this._cancellable = request;
        // Soup timeoutiga qo'shimcha butun tarjima oqimining qat'iy chegarasi.
        this._deadlineId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 20000, () => {
            this._deadlineId = 0;
            request.cancel();
            this.setError('Kutish vaqti tugadi. Oynani yopib, qayta urinib ko‘ring.');
            return GLib.SOURCE_REMOVE;
        });
        return true;
    }

    _startAutoClose(ms) {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = null;
        }
        if (this._destroyed || !this._ready || this._exampleLoading || this._meaningLoading ||
            this._speechPlaying || this.actor.hover) return;
        this._timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._timerId = null;
            this.destroy();
            return GLib.SOURCE_REMOVE;
        });
    }

    destroy(immediate = false) {
        // A network response can arrive after the user has closed the card.
        // Mark it first, so the extension can discard that stale response.
        if (this._destroyed) return;
        this._destroyed = true;
        this.state = 'closed';
        this._meaningRequest?.cancel();
        if (this._meaningTimer) {
            GLib.source_remove(this._meaningTimer);
            this._meaningTimer = 0;
        }
        this._voice?.stop();
        this._exampleRequest?.cancel();
        if (this._exampleTimer) {
            GLib.source_remove(this._exampleTimer);
            this._exampleTimer = 0;
        }
        this._clearDeadline();
        Main.overview.disconnectObject(this);
        Main.sessionMode.disconnectObject(this);
        Main.layoutManager.disconnectObject(this);
        this._grabHelper?.ungrab({actor: this.actor});
        this._cancellable?.cancel();
        if (this._copyTimer) {
            GLib.source_remove(this._copyTimer);
            this._copyTimer = 0;
        }

        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = null;
        }
        if (this._stageClickId) {
            this._overlay.disconnect(this._stageClickId);
            this._stageClickId = null;
        }
        if (this._stageKeyId) {
            global.stage.disconnect(this._stageKeyId);
            this._stageKeyId = null;
        }
        if (this.actor) {
            // Yopilish animatsiyasini kutmasdan input qatlamini bo'shatamiz.
            this._overlay.reactive = false;
            this.actor.reactive = false;
            this.actor.remove_all_transitions();
            if (immediate) {
                Main.layoutManager.removeChrome(this._overlay);
                this._overlay.destroy();
                this._overlay = null;
                this.actor = null;
                return;
            }
            this.actor.ease({
                opacity: 0,
                duration: 100,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    if (this.actor) {
                        Main.layoutManager.removeChrome(this._overlay);
                        this._overlay.destroy();
                        this._overlay = null;
                        this.actor = null;
                    }
                }
            });
        }
    }
}

export default class TouchpadGesturesExtension extends Extension {

    enable() {
        console.warn('TOUCHPAD_GESTURES_ENABLE_CALLED_' + Date.now());
        this._settings = this.getSettings();

        // Virtual keyboard for key simulation
        const seat = Clutter.get_default_backend().get_default_seat();
        this._kb = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);

        // Gesture state
        this._dx = 0;
        this._dy = 0;
        this._holdStartTime = 0;
        this._holdFingers = 0;

        // Continuous swipe state (for volume/brightness during UPDATE)
        this._swipeContinuousAction = null; // 'volume' | 'brightness' | null
        this._swipeDirectionLocked = false;

        // OSD throttle timestamp
        this._lastOsdTime = 0;


        // Track pending idle/timeout source IDs for cleanup in disable()
        this._pendingSources = new Set();

        // ── Volume subsystem — reuse Shell's built-in MixerControl ────────────
        this._volumeControl = null;

        // ── Disable ALL built-in swipe trackers ──────────────────────────────
        this._savedTrackerState = [];
        this._disableBuiltinTrackers();

        // Re-disable after shell startup
        if (Main.layoutManager._startingUp) {
            Main.layoutManager.connectObject('startup-complete', () => {
                this._disableBuiltinTrackers();
            }, this);
        }

        // Re-disable on overview state changes
        Main.overview.connectObject(
            'showing', () => this._disableBuiltinTrackers(),
            'hidden', () => this._disableBuiltinTrackers(),
            this,
        );

        // Watchdog: re-disable trackers periodically
        this._watchdogId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
            this._disableBuiltinTrackers();
            return GLib.SOURCE_CONTINUE;
        });

        // ── Connect to touchpad events using detail-filtered capture signal
        this._stageSignalId = global.stage.connect(
            'captured-event::touchpad',
            (_actor, event) => this._onEvent(event)
        );

        // ── Quick Translate Setup ──────────────────────────────────────────
        this._lastTranslateTime = 0;
        this._currentTranslatePopup = null;
        this._lastPointerX = 0;
        this._lastPointerY = 0;

        // Kursor holati faqat chaqiruv vaqtida olinadi; doimiy watcher kerak emas.

        // Direct key capture for Ctrl + Alt + Z
        this._stageKeySignalId = global.stage.connect(
            'captured-event',
            (_actor, event) => {
                try {
                    if (event.type() === Clutter.EventType.KEY_PRESS) {
                        let sym = event.get_key_symbol();
                        let state = event.get_state();

                        let isZ = (sym === Clutter.KEY_z || sym === Clutter.KEY_Z);
                        let hasCtrl = Boolean(state & Clutter.ModifierType.CONTROL_MASK);
                        let hasAlt = Boolean(state & Clutter.ModifierType.MOD1_MASK);
                        let hasShift = Boolean(state & Clutter.ModifierType.SHIFT_MASK);
                        let hasSuper = Boolean(state & Clutter.ModifierType.SUPER_MASK);

                        if (isZ && hasCtrl && hasAlt && !hasShift && !hasSuper) {
                            let now = Date.now();
                            if (now - this._lastTranslateTime > 250) {
                                this._lastTranslateTime = now;
                                this._triggerQuickTranslate();
                            }
                            return Clutter.EVENT_STOP;
                        }
                    }
                } catch (err) {
                    console.error('[QuickTranslate] Key event error:', err);
                }
                return Clutter.EVENT_PROPAGATE;
            }
        );

        // File trigger monitor for /tmp/quick_translate_trigger (used by media-keys)
        try {
            let triggerPath = '/tmp/quick_translate_trigger';
            GLib.file_set_contents(triggerPath, '0');
            let triggerFile = Gio.File.new_for_path(triggerPath);
            this._fileMonitor = triggerFile.monitor_file(Gio.FileMonitorFlags.NONE, null);
            this._fileMonitor.connect('changed', () => {
                let now = Date.now();
                if (now - this._lastTranslateTime > 250) {
                    this._lastTranslateTime = now;
                    this._triggerQuickTranslate();
                }
            });
        } catch (e) {
            console.error('[QuickTranslate] File monitor error:', e);
        }

    }

    disable() {
        this._selectionPending = false;
        this._translateRequest?.cancel();
        this._translateRequest = null;

        if (this._fileMonitor) {
            try { this._fileMonitor.cancel(); } catch (e) {}
            this._fileMonitor = null;
        }

        if (this._stageKeySignalId) {
            global.stage.disconnect(this._stageKeySignalId);
            this._stageKeySignalId = null;
        }


        if (this._currentTranslatePopup) {
            this._currentTranslatePopup.destroy(true);
            this._currentTranslatePopup = null;
        }

        if (this._stageSignalId) {
            global.stage.disconnect(this._stageSignalId);
            this._stageSignalId = null;
        }

        if (this._watchdogId) {
            GLib.source_remove(this._watchdogId);
            this._watchdogId = null;
        }

        Main.layoutManager.disconnectObject(this);
        Main.overview.disconnectObject(this);

        // Remove all pending idle/timeout sources
        if (this._pendingSources) {
            for (const srcId of this._pendingSources) {
                GLib.source_remove(srcId);
            }
            this._pendingSources.clear();
            this._pendingSources = null;
        }

        this._restoreBuiltinTrackers();
        this._kb = null;
        this._settings = null;
        this._volumeControl = null;
    }

    // ── GNOME tracker management
    _disableBuiltinTrackers() {
        const trackerGetters = [
            () => Main.overview?._swipeTracker,
            () => Main.wm?._workspaceAnimation?._swipeTracker,
            () => Main.overview?._overview?.controls?._workspacesDisplay?._swipeTracker,
            () => Main.overview?._overview?.controls?._swipeTracker,
            () => Main.wm?._swipeTracker,
            () => Main.overview?._overview?.controls?._appDisplay?._swipeTracker,
        ];

        for (const getter of trackerGetters) {
            const tracker = getter();
            if (!tracker) continue;

            // Only save state first time we see this tracker
            if (!this._savedTrackerState.some(s => s.tracker === tracker)) {
                this._savedTrackerState.push({
                    tracker,
                    wasEnabled: tracker.enabled ?? true,
                    touchpadGestureEnabled: tracker._touchpadGesture?.enabled ?? true,
                });
            }

            // Level 1: Disable the SwipeTracker itself
            if (tracker.enabled !== undefined)
                tracker.enabled = false;

            // Level 2: Disable the internal TouchpadSwipeGesture
            if (tracker._touchpadGesture) {
                tracker._touchpadGesture.enabled = false;
            }

            // Level 3: Disable internal PanGesture action
            if (tracker._panGesture) {
                tracker._panGesture.enabled = false;
            }
        }
    }

    _restoreBuiltinTrackers() {
        for (const saved of this._savedTrackerState) {
            if (saved.tracker.enabled !== undefined)
                saved.tracker.enabled = saved.wasEnabled;
            if (saved.tracker._touchpadGesture)
                saved.tracker._touchpadGesture.enabled = saved.touchpadGestureEnabled;
            if (saved.tracker._panGesture)
                saved.tracker._panGesture.enabled = true;
        }
        this._savedTrackerState = [];
    }

    // ── Raw event handler ─────────────────────────────────────────────────────

    _onEvent(event) {
        const type = event.type();

        // ── Touchpad SWIPE ────────────────────────────────────────────────────
        if (type === Clutter.EventType.TOUCHPAD_SWIPE) {
            const n = event.get_touchpad_gesture_finger_count();
            const phase = event.get_gesture_phase();

            // Only handle 3 and 4 finger gestures
            if (n < 3 || n > 4) return Clutter.EVENT_PROPAGATE;

            if (phase === Clutter.TouchpadGesturePhase.BEGIN) {
                this._dx = 0;
                this._dy = 0;
                this._swipeStartTime = GLib.get_monotonic_time();
                this._swipeContinuousAction = null;
                this._swipeDirectionLocked = false;
                this._swipePrefix = n === 4 ? 'four' : 'three';
                return Clutter.EVENT_STOP;
            }

            if (phase === Clutter.TouchpadGesturePhase.UPDATE) {
                const [dx, dy] = event.get_gesture_motion_delta();
                this._dx += dx;
                this._dy += dy;

                // Once we pass threshold, lock direction and check if continuous
                if (!this._swipeDirectionLocked) {
                    const adx = Math.abs(this._dx);
                    const ady = Math.abs(this._dy);
                    if (Math.max(adx, ady) >= SWIPE_THRESHOLD) {
                        this._swipeDirectionLocked = true;
                        let direction;
                        if (adx >= ady)
                            direction = this._dx > 0 ? 'swipe-right' : 'swipe-left';
                        else
                            direction = this._dy > 0 ? 'swipe-down' : 'swipe-up';

                        const key = `${this._swipePrefix}-${direction}`;
                        const actionType = this._settings.get_int(`${key}-action`);
                        this._swipeKey = key;

                        // Determine if this is a continuous action
                        const isVert = direction === 'swipe-up' || direction === 'swipe-down';
                        if (isVert && actionType === V.VOLUME)
                            this._swipeContinuousAction = 'volume';
                        else if (isVert && actionType === V.BRIGHTNESS)
                            this._swipeContinuousAction = 'brightness';
                        else if (!isVert && (direction === 'swipe-left' || direction === 'swipe-right')) {
                            const isLeft = direction === 'swipe-left';
                            if ((isLeft && actionType === L.BRIGHT_DOWN) ||
                                (!isLeft && actionType === R.BRIGHT_UP))
                                this._swipeContinuousAction = 'brightness';
                        }
                    }
                }

                // For continuous actions, apply delta on every update
                if (this._swipeContinuousAction === 'volume') {
                    this._volumeContinuous(-dy); // negative dy = swipe up = volume up
                    return Clutter.EVENT_STOP;
                }
                if (this._swipeContinuousAction === 'brightness') {
                    // For vertical swipes use -dy (up = brighter)
                    // For horizontal swipes use dx (right = brighter, left = dimmer)
                    const isHorizontal = this._swipeKey?.includes('swipe-left') ||
                        this._swipeKey?.includes('swipe-right');
                    const brightDelta = isHorizontal ? dx : -dy;
                    this._brightnessContinuous(brightDelta);
                    return Clutter.EVENT_STOP;
                }

                return Clutter.EVENT_STOP;
            }

            if (phase === Clutter.TouchpadGesturePhase.END ||
                phase === Clutter.TouchpadGesturePhase.CANCEL) {

                // If it was a continuous action, we already applied it during UPDATE
                if (this._swipeContinuousAction) {
                    this._swipeContinuousAction = null;
                    this._dx = 0;
                    this._dy = 0;
                    return Clutter.EVENT_STOP;
                }

                const adx = Math.abs(this._dx);
                const ady = Math.abs(this._dy);
                const prefix = this._swipePrefix || (n === 4 ? 'four' : 'three');

                if (Math.max(adx, ady) >= SWIPE_THRESHOLD) {
                    let direction;
                    if (adx >= ady) {
                        direction = this._dx > 0 ? 'swipe-right' : 'swipe-left';
                    } else {
                        direction = this._dy > 0 ? 'swipe-down' : 'swipe-up';
                    }
                    const key = `${prefix}-${direction}`;
                    this._idleExec(() => this._executeAction(key));
                } else if (phase === Clutter.TouchpadGesturePhase.END) {
                    // Small swipe (under threshold) might actually be a tap
                    const elapsed = (GLib.get_monotonic_time() - this._swipeStartTime) / 1000;
                    if (elapsed <= TAP_MAX_DURATION_MS) {
                        const key = `${prefix}-tap`;
                        this._idleExec(() => this._executeAction(key));
                    }
                }

                this._dx = 0;
                this._dy = 0;
                return Clutter.EVENT_STOP;
            }

            return Clutter.EVENT_STOP;
        }

        // ── Touchpad HOLD (tap detection) ─────────────────────────────────────
        if (type === Clutter.EventType.TOUCHPAD_HOLD) {
            const n = event.get_touchpad_gesture_finger_count();
            const phase = event.get_gesture_phase();

            if (n < 3 || n > 4) return Clutter.EVENT_PROPAGATE;

            if (phase === Clutter.TouchpadGesturePhase.BEGIN) {
                this._holdStartTime = GLib.get_monotonic_time();
                this._holdFingers = n;
                return Clutter.EVENT_STOP;
            }

            if (phase === Clutter.TouchpadGesturePhase.END) {
                const elapsed = (GLib.get_monotonic_time() - this._holdStartTime) / 1000;
                const prefix = this._holdFingers === 4 ? 'four' : 'three';

                if (elapsed <= TAP_MAX_DURATION_MS) {
                    const key = `${prefix}-tap`;
                    this._idleExec(() => this._executeAction(key));
                }

                this._holdStartTime = 0;
                this._holdFingers = 0;
                return Clutter.EVENT_STOP;
            }

            if (phase === Clutter.TouchpadGesturePhase.CANCEL) {
                this._holdStartTime = 0;
                this._holdFingers = 0;
                return Clutter.EVENT_STOP;
            }

            return Clutter.EVENT_STOP;
        }

        // ── Fallback tap detection via Pointer Buttons ────────────────────────
        // libinput translates 3-finger taps to middle click, and sometimes 4-finger to other buttons.
        if (type === Clutter.EventType.BUTTON_RELEASE) {
            const device = event.get_source_device();
            if (device && device.get_device_type() === Clutter.InputDeviceType.TOUCHPAD_DEVICE) {
                const button = event.get_button();
                let key = null;
                if (button === 2) {
                    key = 'three-tap';
                } else if (button === 8 || button === 9) {
                    // Just in case 4-finger tap maps to 8/9
                    key = 'four-tap';
                }

                if (key) {
                    this._idleExec(() => this._executeAction(key));
                    return Clutter.EVENT_STOP;
                }
            }
        }

        return Clutter.EVENT_PROPAGATE;
    }

    // ── Action dispatch ───────────────────────────────────────────────────────

    /**
     * Schedule a callback via GLib.idle_add, tracking the source ID
     * so it can be removed in disable() if still pending.
     */
    _idleExec(fn) {
        const id = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._pendingSources?.delete(id);
            fn();
            return GLib.SOURCE_REMOVE;
        });
        this._pendingSources?.add(id);
    }

    _executeAction(key) {
        const actionType = this._settings?.get_int(`${key}-action`);
        if (actionType === undefined || actionType === null) return;

        const isUp = key.endsWith('swipe-up');
        const isDown = key.endsWith('swipe-down');
        const isLeft = key.endsWith('swipe-left');
        const isRight = key.endsWith('swipe-right');
        const isTap = key.endsWith('tap');
        const isVert = isUp || isDown;

        // ── Overview/App-Grid hierarchical navigation ─────────────────────
        // When inside the overview or app grid, vertical swipes navigate
        // the hierarchy:  Desktop  ↔  Activities  ↔  App Grid
        //   • swipe-up  progresses forward  (desktop→activities→app grid)
        //   • swipe-down regresses backward (app grid→activities→desktop)
        // This intercepts BEFORE the normal configured action so the
        // configured swipe-down action only fires from the desktop.
        if (isVert && Main.overview.visible) {
            const inAppGrid = this._isAppGridVisible();

            if (isUp) {
                // Already in overview — check if we should open app grid
                if (!inAppGrid) {
                    // On activities page → open app grid
                    this._showAppGrid();
                }
                // If already on app grid, do nothing (top of hierarchy)
                return;
            }

            if (isDown) {
                if (inAppGrid) {
                    // On app grid → go back to activities page
                    this._hideAppGrid();
                } else {
                    // On activities page → close overview, back to desktop
                    Main.overview.hide();
                }
                return;
            }
        }

        if (isVert) {
            if (actionType < 0 || actionType > MAX_V) return;
            switch (actionType) {
                case V.ACTIVITIES:
                    // From desktop: open activities overview
                    Main.overview.show();
                    break;
                case V.VOLUME:
                    this._volume(isUp);
                    break;
                case V.BRIGHTNESS:
                    this._brightness(isUp);
                    break;
                case V.MAX_MIN: {
                    const w = global.display.get_focus_window();
                    if (!w) break;
                    if (isUp) {
                        // GNOME 50: maximize() takes no args
                        w.maximize();
                    } else {
                        // GNOME 50: is_maximized() replaces get_maximized()
                        if (w.is_maximized())
                            w.unmaximize();
                        else
                            w.minimize();
                    }
                    break;
                }
                case V.CLOSE: {
                    const w = global.display.get_focus_window();
                    if (w) w.delete(global.get_current_time());
                    break;
                }
                case V.SHOW_DESKTOP:
                    this._showDesktop();
                    break;
                case V.CUSTOM:
                    this._fireKeybind(key);
                    break;
                // V.DISABLED: do nothing
            }
            return;
        }

        if (isLeft) {
            if (actionType < 0 || actionType > MAX_L) return;
            switch (actionType) {
                case L.WS_LEFT: this._switchWorkspace(true); break;
                case L.BRIGHT_DOWN: this._brightness(false); break;
                case L.ALTTAB_PREV: this._altTab(false); break;
                case L.MEDIA_PREV: this._media('previous'); break;
                case L.CUSTOM: this._fireKeybind(key); break;
            }
            return;
        }

        if (isRight) {
            if (actionType < 0 || actionType > MAX_R) return;
            switch (actionType) {
                case R.WS_RIGHT: this._switchWorkspace(false); break;
                case R.BRIGHT_UP: this._brightness(true); break;
                case R.ALTTAB_NEXT: this._altTab(true); break;
                case R.MEDIA_NEXT: this._media('next'); break;
                case R.CUSTOM: this._fireKeybind(key); break;
            }
            return;
        }

        if (isTap) {
            if (actionType < 0 || actionType > MAX_T) return;
            switch (actionType) {
                case T.PLAY_PAUSE: this._media('play-pause'); break;
                case T.SHOW_DESKTOP: this._showDesktop(); break;
                case T.CYCLE_WS: this._switchWorkspace(true); break;
                case T.NOTIFS: Main.panel.statusArea.dateMenu?.menu?.toggle(); break;
                case T.CUSTOM: this._fireKeybind(key); break;
            }
        }
    }

    // ── Workspace switching ───────────────────────────────────────────────────

    _switchWorkspace(forward) {
        const wm = global.workspace_manager;
        const cur = wm.get_active_workspace_index();
        const idx = cur + (forward ? 1 : -1);
        if (idx >= 0 && idx < wm.n_workspaces)
            wm.get_workspace_by_index(idx).activate(global.get_current_time());
    }

    // ── App grid detection & navigation ───────────────────────────────────
    // These helpers enable hierarchical traversal:
    //   Desktop  ↔  Activities Overview  ↔  App Grid

    /**
     * Returns true if the app grid is currently showing.
     * Uses the dash "Show Apps" button's checked state which reflects
     * whether the overview is in app-grid mode.
     */
    _isAppGridVisible() {
        return Main.overview.dash?.showAppsButton?.checked === true;
    }

    /**
     * Transition from activities overview to app grid.
     * Sets the dash showAppsButton to checked, which triggers the
     * ControlsManager to animate into APP_GRID state.
     */
    _showAppGrid() {
        const btn = Main.overview.dash?.showAppsButton;
        if (btn) {
            btn.checked = true;
        }
    }

    /**
     * Transition from app grid back to activities overview.
     * Un-checks the dash showAppsButton, which triggers the
     * ControlsManager to animate back to WINDOW_PICKER state.
     */
    _hideAppGrid() {
        const btn = Main.overview.dash?.showAppsButton;
        if (btn) {
            btn.checked = false;
        }
    }

    // ── Show desktop ──────────────────────────────────────────────────────────

    _showDesktop() {
        const ws = global.workspace_manager.get_active_workspace();
        ws.list_windows()
            .filter(w => !w.is_skip_taskbar() && !w.minimized)
            .forEach(w => w.minimize());
    }

    // ── Media keys simulation ──────────────────────────────────────────────────

    _simulateKey(keyval) {
        if (!this._kb) return;
        const t = Clutter.get_current_event_time();
        this._kb.notify_keyval(t, keyval, Clutter.KeyState.PRESSED);
        this._kb.notify_keyval(t, keyval, Clutter.KeyState.RELEASED);
    }

    // ── Volume control (single step, used by discrete actions) ─────────────

    _volume(isUp) {
        this._volumeContinuous(isUp ? 3 : -3);
    }

    // ── Continuous volume (called per UPDATE event) ────────────────────────

    _volumeContinuous(delta) {
        if (!this._volumeControl) {
            this._volumeControl =
                Main.panel?.statusArea?.quickSettings?._volumeOutput?._control ?? null;
        }
        const ctrl = this._volumeControl;
        if (!ctrl) return;

        const stream = ctrl.get_default_sink();
        if (!stream) return;

        const maxVol = ctrl.get_vol_max_norm();
        const cur = stream.volume;
        const step = maxVol * VOL_STEP_PER_PX * Math.abs(delta);
        let newVol = delta > 0 ? cur + step : cur - step;
        newVol = Math.max(0, Math.min(maxVol, newVol));

        stream.volume = newVol;
        stream.push_volume();

        // Throttle OSD to avoid choppiness
        const now = GLib.get_monotonic_time() / 1000;
        if (now - this._lastOsdTime > OSD_THROTTLE_MS) {
            this._lastOsdTime = now;
            const level = newVol / maxVol;
            const icon = level <= 0 ? 'audio-volume-muted-symbolic'
                : level < 0.33 ? 'audio-volume-low-symbolic'
                    : level < 0.66 ? 'audio-volume-medium-symbolic'
                        : 'audio-volume-high-symbolic';
            // GNOME 50 API: showOne(monitorIndex, icon, label, level, maxLevel)
            Main.osdWindowManager.showOne(
                Main.layoutManager.primaryIndex,
                Gio.Icon.new_for_string(icon), null, level,
            );
        }
    }

    // ── Brightness control (single step, used by discrete actions) ─────────

    _brightness(isUp) {
        const scale = Main.brightnessManager?.globalScale;
        if (!scale) return;
        if (isUp)
            scale.stepUp();
        else
            scale.stepDown();
    }

    // ── Continuous brightness (called per UPDATE event) ────────────────────

    _brightnessContinuous(delta) {
        const scale = Main.brightnessManager?.globalScale;
        if (!scale) return;

        const step = BRIGHT_STEP_PER_PX * Math.abs(delta);
        let newVal = delta > 0 ? scale.value + step : scale.value - step;
        newVal = Math.max(0, Math.min(1.0, newVal));
        scale.value = newVal;

        // OSD is handled by BrightnessManager itself via _showOSD(),
        // but we throttle an extra OSD call here for visual feedback
        // in case the internal one doesn't trigger.
        const now = GLib.get_monotonic_time() / 1000;
        if (now - this._lastOsdTime > OSD_THROTTLE_MS) {
            this._lastOsdTime = now;
            // GNOME 50 API: showOne(monitorIndex, icon, label, level, maxLevel)
            Main.osdWindowManager.showOne(
                Main.layoutManager.primaryIndex,
                Gio.Icon.new_for_string('display-brightness-symbolic'),
                null, newVal,
            );
        }
    }

    // ── Media control via MPRIS D-Bus ─────────────────────────────────────

    _media(cmd) {
        let method;
        if (cmd === 'play-pause') method = 'PlayPause';
        else if (cmd === 'next') method = 'Next';
        else if (cmd === 'previous') method = 'Previous';
        if (!method) return;

        if (cmd !== 'play-pause') {
            this._simulateMediaKey(cmd);
            return;
        }

        // For play-pause: use MPRIS D-Bus only (no key simulation)
        Gio.DBus.session.call(
            'org.freedesktop.DBus',
            '/org/freedesktop/DBus',
            'org.freedesktop.DBus',
            'ListNames',
            null,
            new GLib.VariantType('(as)'),
            Gio.DBusCallFlags.NONE, -1, null,
            (conn, res) => {
                const result = conn.call_finish(res);
                const names = result.get_child_value(0).deepUnpack();
                const mprisNames = names.filter(n => n.startsWith('org.mpris.MediaPlayer2.'));

                if (mprisNames.length === 0) {
                    this._simulateMediaKey(cmd);
                    return;
                }

                this._tryMprisPlayers(mprisNames, 0, method, cmd);
            }
        );
    }

    _tryMprisPlayers(players, idx, method, cmd) {
        if (idx >= players.length) return;
        const busName = players[idx];
        Gio.DBus.session.call(
            busName,
            '/org/mpris/MediaPlayer2',
            MPRIS_PLAYER_IFACE,
            method,
            null,
            null,
            Gio.DBusCallFlags.NONE, -1, null,
            (conn, res) => {
                conn.call_finish(res);
            }
        );
    }

    _simulateMediaKey(cmd) {
        let keyval;
        if (cmd === 'play-pause') keyval = Clutter.KEY_AudioPlay;
        else if (cmd === 'next') keyval = Clutter.KEY_AudioNext;
        else if (cmd === 'previous') keyval = Clutter.KEY_AudioPrev;
        if (keyval) this._simulateKey(keyval);
    }

    // ── Taskbar order window cycling ──────────────────────────────────────────

    _altTab(forward) {
        try {
            const fs = Gio.File.new_for_path('/tmp/gesture_debug.log');
            const out = fs.append_to(Gio.FileCreateFlags.NONE, null);
            const str = `_altTab called forward=${forward} time=${Date.now()}\n`;
            out.write(str, null);
            out.close(null);
        } catch (_) {}

        try {
            let runningApps = [];
            const activeWs = global.workspace_manager?.get_active_workspace?.();

            if (global.dashToPanel?.panels?.length) {
                for (let panel of global.dashToPanel.panels) {
                    if (panel.taskbar && typeof panel.taskbar._getAppIcons === 'function') {
                        let icons = panel.taskbar._getAppIcons();
                        for (let icon of icons) {
                            let wins = [];
                            if (icon.window) {
                                wins = [icon.window];
                            } else if (typeof icon.getAppIconInterestingWindows === 'function') {
                                wins = icon.getAppIconInterestingWindows();
                            } else if (icon.app && typeof icon.app.get_windows === 'function') {
                                wins = icon.app.get_windows();
                            }

                            wins = (wins || []).filter(w => {
                                if (!w || typeof w.get_id !== 'function') return false;
                                if (w.is_override_redirect?.() || w.skip_taskbar) return false;
                                if (activeWs && typeof w.get_workspace === 'function') {
                                    const ws = w.get_workspace();
                                    if (ws && ws !== activeWs && !w.is_on_all_workspaces?.()) return false;
                                }
                                return true;
                            });

                            if (wins.length > 0) {
                                wins.sort((a, b) => (b.get_user_time?.() || 0) - (a.get_user_time?.() || 0));
                                runningApps.push({
                                    icon: icon,
                                    windows: wins
                                });
                            }
                        }
                    }
                }
            }

            // Fallback: if dash-to-panel is not active, collect windows sorted spatially (left-to-right)
            if (runningApps.length === 0) {
                let allWins = activeWs ? activeWs.list_windows() : global.display.get_tab_list(Meta.TabList.NORMAL, null);
                let validWins = (allWins || []).filter(w => {
                    if (!w || typeof w.get_id !== 'function') return false;
                    return !w.is_override_redirect?.() && !w.skip_taskbar;
                });
                validWins.sort((a, b) => (a.get_frame_rect?.().x || 0) - (b.get_frame_rect?.().x || 0));
                for (let w of validWins) {
                    runningApps.push({ icon: null, windows: [w] });
                }
            }

            if (runningApps.length === 1) {
                let win = runningApps[0].windows[0];
                if (win) {
                    if (win.minimized) win.unminimize();
                    Main.activateWindow(win);
                }
                return;
            }

            if (runningApps.length > 1) {
                let focusedWin = global.display.get_focus_window();
                let curWin = focusedWin;
                while (curWin && curWin.is_transient?.() && curWin.get_transient_for?.()) {
                    curWin = curWin.get_transient_for();
                }

                let curIdx = runningApps.findIndex(item =>
                    item.windows.some(w =>
                        w === focusedWin || w === curWin ||
                        (focusedWin && typeof w.get_id === 'function' && (w.get_id() === focusedWin.get_id() || (curWin && w.get_id() === curWin.get_id())))
                    )
                );

                let nextIdx;
                if (curIdx === -1) {
                    nextIdx = forward ? 0 : runningApps.length - 1;
                } else {
                    if (forward) {
                        nextIdx = (curIdx + 1) % runningApps.length;
                    } else {
                        nextIdx = (curIdx - 1 + runningApps.length) % runningApps.length;
                    }
                }

                let target = runningApps[nextIdx];
                if (target && target.windows.length > 0) {
                    let winToActivate = target.windows[0];
                    if (winToActivate) {
                        if (winToActivate.minimized) winToActivate.unminimize();
                        Main.activateWindow(winToActivate);
                        return;
                    }
                }
            }
        } catch (e) {
            console.error('Taskbar cycling error:', e);
        }

        // Ultimate fallback: standard keyboard Alt+Tab simulation
        const t = Clutter.get_current_event_time();
        this._kb.notify_keyval(t, Clutter.KEY_Alt_L, Clutter.KeyState.PRESSED);
        if (!forward)
            this._kb.notify_keyval(t, Clutter.KEY_Shift_L, Clutter.KeyState.PRESSED);
        this._kb.notify_keyval(t, Clutter.KEY_Tab, Clutter.KeyState.PRESSED);
        this._kb.notify_keyval(t, Clutter.KEY_Tab, Clutter.KeyState.RELEASED);
        if (!forward)
            this._kb.notify_keyval(t, Clutter.KEY_Shift_L, Clutter.KeyState.RELEASED);
        this._kb.notify_keyval(t, Clutter.KEY_Alt_L, Clutter.KeyState.RELEASED);
    }

    // ── Custom keybind firing ─────────────────────────────────────────────────

    _fireKeybind(gestureKey) {
        const stored = this._settings?.get_string(`${gestureKey}-keybind`);
        if (!stored || !stored.includes(':')) return;

        const parts = stored.split(':');
        const keyval = parseInt(parts[0], 10);
        const mods = parseInt(parts[1], 10);
        if (!keyval) return;



        const kb = this._kb;

        // Gdk.ModifierType bitmask values (GTK4)
        const GDK_SHIFT_MASK = 1;
        const GDK_LOCK_MASK = 2;
        const GDK_CONTROL_MASK = 4;
        const GDK_ALT_MASK = 8;
        const GDK_SUPER_MASK = 67108864;
        const GDK_HYPER_MASK = 134217728;
        const GDK_META_MASK = 268435456;

        let t = global.get_current_time();
        if (!t) t = GLib.get_monotonic_time() / 1000;

        // Press modifier keys first
        if (mods & GDK_SHIFT_MASK) kb.notify_keyval(t, Clutter.KEY_Shift_L, Clutter.KeyState.PRESSED);
        if (mods & GDK_CONTROL_MASK) kb.notify_keyval(t, Clutter.KEY_Control_L, Clutter.KeyState.PRESSED);
        if (mods & GDK_ALT_MASK) kb.notify_keyval(t, Clutter.KEY_Alt_L, Clutter.KeyState.PRESSED);
        if (mods & GDK_SUPER_MASK) kb.notify_keyval(t, Clutter.KEY_Super_L, Clutter.KeyState.PRESSED);
        if (mods & GDK_HYPER_MASK) kb.notify_keyval(t, Clutter.KEY_Hyper_L, Clutter.KeyState.PRESSED);
        if (mods & GDK_META_MASK) kb.notify_keyval(t, Clutter.KEY_Meta_L, Clutter.KeyState.PRESSED);

        // Press and release the main key
        t += 1;
        kb.notify_keyval(t, keyval, Clutter.KeyState.PRESSED);
        t += 1;
        kb.notify_keyval(t, keyval, Clutter.KeyState.RELEASED);

        // Release modifier keys (reverse order)
        t += 1;
        if (mods & GDK_META_MASK) kb.notify_keyval(t, Clutter.KEY_Meta_L, Clutter.KeyState.RELEASED);
        if (mods & GDK_HYPER_MASK) kb.notify_keyval(t, Clutter.KEY_Hyper_L, Clutter.KeyState.RELEASED);
        if (mods & GDK_SUPER_MASK) kb.notify_keyval(t, Clutter.KEY_Super_L, Clutter.KeyState.RELEASED);
        if (mods & GDK_ALT_MASK) kb.notify_keyval(t, Clutter.KEY_Alt_L, Clutter.KeyState.RELEASED);
        if (mods & GDK_CONTROL_MASK) kb.notify_keyval(t, Clutter.KEY_Control_L, Clutter.KeyState.RELEASED);
        if (mods & GDK_SHIFT_MASK) kb.notify_keyval(t, Clutter.KEY_Shift_L, Clutter.KeyState.RELEASED);
    }

    _triggerQuickTranslate() {
        if (this._currentTranslatePopup && !this._currentTranslatePopup._destroyed) {
            this._currentTranslatePopup.destroy();
            this._currentTranslatePopup = null;
            return;
        }
        if (this._selectionPending) {
            this._translateRequest?.cancel();
            this._selectionPending = false;
            return;
        }
        const [x, y] = getTruePointerCoords();
        this._translateRequest?.cancel();
        const request = new Gio.Cancellable();
        this._translateRequest = request;
        this._selectionPending = true;

        if (this._currentTranslatePopup) {
            this._currentTranslatePopup.destroy();
            this._currentTranslatePopup = null;
        }

        getSelection((text, selectionError) => {
            if (request.is_cancelled() || this._translateRequest !== request) return;
            this._selectionPending = false;
            if (!text) {
                let popup = new QuickTranslatePopup(x, y, '');
                popup.setError(selectionError || 'Avval matnni sichqoncha bilan belgilang.');
                this._currentTranslatePopup = popup;
                return;
            }

            let popup = new QuickTranslatePopup(x, y, text);
            this._currentTranslatePopup = popup;
            if (!popup.startRequest(request)) return;
            if (Array.from(text).length > 3000) {
                popup.setError('Matn juda uzun. 3000 belgigacha bo‘lgan qismini tanlang.');
                return;
            }

            requestMultiTranslation(text, (resultData, err) => {
                // Do not update a card that was closed by ESC, an outside
                // click, its timer, or a newer quick-translate invocation.
                if (this._currentTranslatePopup !== popup || popup._destroyed) return;
                if (err || !resultData) {
                    popup.setError(err || 'Failed to translate');
                } else {
                    popup.setResult(resultData);
                }
            }, request);
        }, request);
    }
}
