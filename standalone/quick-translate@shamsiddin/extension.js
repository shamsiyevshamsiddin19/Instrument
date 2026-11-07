import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {QuickTranslatePopup} from './popup.js';
import {getSelection, getTruePointerCoords} from './selection-service.js';
import {requestMultiTranslation} from './translation-service.js';

export default class QuickTranslateExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._request = null;
        this._popup = null;
        this._selectionPending = false;

        Main.wm.addKeybinding(
            'toggle-popup',
            this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            () => this._toggle()
        );
    }

    disable() {
        Main.wm.removeKeybinding('toggle-popup');
        this._selectionPending = false;
        this._request?.cancel();
        this._request = null;
        this._popup?.destroy(true);
        this._popup = null;
        this._settings = null;
    }

    _toggle() {
        if (this._popup && !this._popup._destroyed) {
            this._popup.destroy();
            this._popup = null;
            return;
        }
        if (this._selectionPending) {
            this._request?.cancel();
            this._selectionPending = false;
            return;
        }

        const [x, y] = getTruePointerCoords();
        this._request?.cancel();
        const request = new Gio.Cancellable();
        this._request = request;
        this._selectionPending = true;

        getSelection((text, selectionError) => {
            if (request.is_cancelled() || this._request !== request) return;
            this._selectionPending = false;

            const popup = new QuickTranslatePopup(x, y, text || '');
            this._popup = popup;
            if (!text) {
                popup.setError(selectionError || 'Avval matnni sichqoncha bilan belgilang.');
                return;
            }
            if (!popup.startRequest(request)) return;
            if (Array.from(text).length > 3000) {
                popup.setError('Matn juda uzun. 3000 belgigacha bo‘lgan qismini tanlang.');
                return;
            }

            requestMultiTranslation(text, (result, error) => {
                if (this._popup !== popup || popup._destroyed) return;
                if (error || !result) popup.setError(error || 'Tarjima olinmadi.');
                else popup.setResult(result);
            }, request);
        }, request);
    }
}
