# Quick Translate

Loyihaning ishchi manbalari shu papkada saqlanadi.

- `extension/` — tarjimon integratsiya qilingan GNOME kengaytmasi, sozlamalari, sxemalari va testlari. Kengaytma touchpad funksiyalarini ham o'z ichiga oladi; u mustaqil tarjimon kengaytmasi emas.
- `bin/quick-translate` — Ctrl+Alt+Z orqali chaqiriladigan skript.
- `PROJECT_QUICK_TRANSLATE.md` — texnik tavsif va o'zgarishlar tarixi.
- `extension/extension.js.bak` va `.prev` — avvalgi zaxira nusxalar.

## O'rnatilgan nusxa

GNOME ishlatadigan nusxa `/home/shamsiddin/.local/share/gnome-shell/extensions/touchpad-gestures@alpha.com/` manzilida qoldirildi. Chaqiruv skripti `/home/shamsiddin/.local/bin/quick-translate` manzilida. Papkaga joylash vaqtida ushbu nusxalar bilan loyiha nusxasi bir xil; avtomatik sinxronlash yo'q.

Keyingi o'zgarishlar avval shu loyihada qilinadi. Tekshiruvdan keyin o'zgargan fayllar o'rnatilgan kengaytmaga nusxalanadi. GNOME Wayland sessiyasida JavaScript yangilanishlari Log Out / Log In dan keyin yuklanadi. Win+L bunga yetmaydi.

## Tekshirish

Loyiha papkasidan:

```sh
# JavaScript sintaksisini tekshirish.
node --check extension/extension.js
# GNOME 46 manbasiga tayangan popup regressiya testi.
node extension/tests/popup-lifecycle.cjs
```

Avtomatik test haqiqiy Wayland oynasidagi bosish/fokus sinovini almashtirmaydi. Tashqariga bosish, Esc, Copy, hover va yopilgandan keyin boshqa dasturlarni boshqarish yangi sessiyada tekshirilishi kerak.
