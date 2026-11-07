# Quick Translate

Loyihaning ishchi manbalari shu papkada saqlanadi.

- `extension/` — tarjimon integratsiya qilingan GNOME kengaytmasi, sozlamalari, sxemalari va testlari. Kengaytma touchpad funksiyalarini ham o'z ichiga oladi; u mustaqil tarjimon kengaytmasi emas.
- `bin/quick-translate` — Ctrl+Alt+Z orqali chaqiriladigan skript.
- `PROJECT_QUICK_TRANSLATE.md` — texnik tavsif va o'zgarishlar tarixi.
- `extension/extension.js.bak` va `.prev` — avvalgi zaxira nusxalar.

## O'rnatilgan nusxa

GNOME ishlatadigan nusxa `/home/shamsiddin/.local/share/gnome-shell/extensions/touchpad-gestures@alpha.com/` manzilida qoldirildi. Chaqiruv skripti `/home/shamsiddin/.local/bin/quick-translate` manzilida. Papkaga joylash vaqtida ushbu nusxalar bilan loyiha nusxasi bir xil; avtomatik sinxronlash yo'q.

Keyingi o'zgarishlar avval shu loyihada qilinadi. Tekshiruvdan keyin o'zgargan fayllar o'rnatilgan kengaytmaga nusxalanadi. GNOME Wayland sessiyasida JavaScript yangilanishlari Log Out / Log In dan keyin yuklanadi. Win+L bunga yetmaydi.

## So'zni gap ichida ko'rish

Tarjima tayyor bo'lgach RU, EN yoki UZ til belgisini bosing. Pastda tanlangan tilda qisqa misol chiqadi. Faol til nuqta bilan belgilanadi; boshqa til bosilsa misol almashadi. Misol yuklanayotganda avtomatik yopilish to'xtaydi, lekin Esc, X va tashqariga bosish ishlaydi. Copy oldingidek asosiy tarjimalarni nusxalaydi.

Misollar mavjud Google lug'at xizmatidan olinadi. Tanlangan tilda misol bo'lmasa, inglizcha misol qidirilib shu tilga tarjima qilinadi. Qisqa inglizcha iborada boshlang'ich yordamchi fe'l yoki artikl olib tashlanishi mumkin. Ko'p ma'noli so'zning kerakli ma'nosi har doim aniqlanmaydi; ayrim so'z va iboralar uchun misol mavjud emas. Bunday holatda «Misol topilmadi» ko'rsatiladi. Bu AI orqali har qanday so'z uchun yangi gap yaratish xizmati emas.

Bir karta ichida muvaffaqiyatli misollar xotirada saqlanadi; diskka yozilmaydi. Misol so'rovi 15 soniyadan oshmaydi; til almashtirilsa yoki karta yopilsa eski so'rov bekor qilinadi.

## Tekshiruv buyruqlari

Loyiha papkasidan:

```sh
# JavaScript sintaksisini tekshirish.
node --check extension/extension.js
# GNOME 46 manbasiga tayangan popup regressiya testi.
node extension/tests/popup-lifecycle.cjs
# Misol gaplar, til almashtirish, kesh va kutish chegarasi.
node extension/tests/examples.cjs
```

Avtomatik test haqiqiy Wayland oynasidagi bosish/fokus sinovini almashtirmaydi. Tashqariga bosish, Esc, Copy, hover va yopilgandan keyin boshqa dasturlarni boshqarish yangi sessiyada tekshirilishi kerak.
