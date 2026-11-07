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

## O'rganish funksiyalari

- **Gap:** butun gapni kiriting, manba tilini Auto / UZ / RU / EN orqali tanlang. Bunda butun gap qayta tarjima qilinadi; alohida so'z ma'nosini AI bilan ajratish yoki ko'rinmayotgan matnni avtomatik o'qish amalga oshirilmaydi.
- **Talaffuz:** RU va EN yonidagi ovoz belgisi so'z/iborani o'qiydi; misol ostidagi belgi misolni o'qiydi. Qayta bosish to'xtatadi. Bir vaqtda bitta ovoz; karta yopilganda ovoz to'xtaydi. Internet va `ffplay` kerak, API kaliti kerak emas. 200 belgidan uzun matn kesilmaydi, izoh ko'rsatiladi. O'zbekcha ovoz mavjud deb ko'rsatilmaydi.
- **So'z ma'lumoti:** til belgisi bosilganda lug'at bergan so'z turkumi va lug'at shakli ko'rsatiladi. EN lug'atidan olingan ma'lumot RU so'zining grammatikasi deb taqdim etilmaydi. Topilmagan shakl taxmin qilinmaydi.
- **Saqlash / Lug'at:** faqat tanlangan so'zlar tarjima, ochilgan misollar va lug'at ma'lumoti bilan lokal saqlanadi. Saqlangan kartada keyin ochilgan misol ham yangilanadi. Lug'at boshida bo'sh; 20 tadan sahifalanadi. Yozuvni bosib tarjimasini eslang, keyin javobini oching. O'chirish ikki bosqichli.

Saqlash manzili: `~/.local/share/quick-translate/vocabulary.json` (yoki XDG_DATA_HOME bo'lsa shu yerda). Fayl 0600 ruxsat bilan atomik almashtiriladi, oldingi nusxa zaxiralanadi. Buzilgan fayl avtomatik o'chirilmaydi yoki ustidan yozilmaydi. Limit 500 yozuv; to'lsa avval foydalanuvchi keraksizini o'chiradi. Lug'at GitHub'ga yuborilmaydi.

Alohida Copy va mahkamlash funksiyalari foydalanuvchi talabiga ko'ra qo'shilmagan. Asosiy Copy ikkala tarjimani ko'chirishda davom etadi. Bepul tarjima/lug'at/ovoz endpointlari kafolatlangan pullik API emas; xizmat javob bermasa aniq xabar chiqadi.

## Testlarni ishga tushirish

Loyiha papkasidan:

```sh
# JavaScript sintaksisini tekshirish.
node --check extension/extension.js
# GNOME 46 manbasiga tayangan popup regressiya testi.
node extension/tests/popup-lifecycle.cjs
# Misol gaplar, til almashtirish, kesh va kutish chegarasi.
node extension/tests/examples.cjs
# Kartaning boshqaruvlari, lug'at va kontekst holatlari (mock UI).
node extension/tests/learning-ui.cjs
# Haqiqiy GJS/Gio fayl ruxsatlari, dublikat, buzilgan baza va ovoz validatsiyasi.
gjs -m extension/tests/learning-services.js
```

Avtomatik test haqiqiy Wayland oynasidagi bosish/fokus sinovini almashtirmaydi. Tashqariga bosish, Esc, Copy, hover va yopilgandan keyin boshqa dasturlarni boshqarish yangi sessiyada tekshirilishi kerak.
