# Quick Translate standalone extension

Bu papka tarjimonning asosiy, mustaqil GNOME Shell kengaytmasidir. UUID: `quick-translate@shamsiddin`.

Arxitektura:

- `extension.js` — faqat enable/disable, native shortcut va request lifecycle.
- `selection-service.js` — Wayland primary selection va kursor koordinatasi.
- `translation-service.js` — Claude/Gemini/Google HTTP adapterlari.
- `translation-orchestrator.js` — primary/fallback holat mashinasi.
- `gemini-utils.js` — prompt, JSON ajratish va qat'iy normalizatsiya.
- `popup.js` — 480×300 karta UI va uning resurs lifecycle’i.
- `learning-services.js` — lug'at va talaffuz.
- `tests/` — unit, lifecycle, regression va jonli provider testlari.

Eski `touchpad-gestures@alpha.com` kengaytmasi tarjimon triggeriga egalik qilmaydi. `Ctrl+Alt+Z` faqat ushbu kengaytmaning GSettings keybindingi orqali boshqariladi.

Kod yangilangach Wayland sessiyasida **Log Out → Log In** talab qilinadi.
