# Quick Translate

Loyihaning ishchi manbalari shu papkada saqlanadi.

## Joriy arxitektura

Asosiy mahsulot endi `standalone/quick-translate@shamsiddin/` ichidagi mustaqil GNOME Shell kengaytmasidir. U touchpad kengaytmasiga runtime jihatdan bog'liq emas. `extension/` eski touchpad kengaytmasining migratsiya davridagi nusxasi bo'lib, undagi tarjimon triggeri o'chirilgan; touchpad funksiyalari saqlangan.

Yangi kengaytmada `Ctrl+Alt+Z` GNOME Shell native GSettings keybinding orqali boshqariladi. Eski `/tmp/quick_translate_trigger`, global captured-event va uchta GNOME media-key shortcut yangi tizimda ishlatilmaydi.

Tekshiruv:

```sh
./scripts/test-standalone.sh
LIVE_PROVIDER_TESTS=1 ./scripts/test-standalone.sh
```

O'rnatish:

```sh
./scripts/install-standalone.sh
```

- `extension/` — tarjimon integratsiya qilingan GNOME kengaytmasi, sozlamalari, sxemalari va testlari. Kengaytma touchpad funksiyalarini ham o'z ichiga oladi; u mustaqil tarjimon kengaytmasi emas.
- `bin/quick-translate` — Ctrl+Alt+Z orqali chaqiriladigan skript.
- `PROJECT_QUICK_TRANSLATE.md` — texnik tavsif va o'zgarishlar tarixi.
- `extension/extension.js.bak` va `.prev` — avvalgi zaxira nusxalar.

## O'rnatilgan nusxa

GNOME ishlatadigan nusxa `/home/shamsiddin/.local/share/gnome-shell/extensions/touchpad-gestures@alpha.com/` manzilida qoldirildi. Chaqiruv skripti `/home/shamsiddin/.local/bin/quick-translate` manzilida. Papkaga joylash vaqtida ushbu nusxalar bilan loyiha nusxasi bir xil; avtomatik sinxronlash yo'q.

Keyingi o'zgarishlar avval shu loyihada qilinadi. Tekshiruvdan keyin o'zgargan fayllar o'rnatilgan kengaytmaga nusxalanadi. GNOME Wayland sessiyasida JavaScript yangilanishlari Log Out / Log In dan keyin yuklanadi. Win+L bunga yetmaydi.

## Gemini asosiy tarjima kanali

Claude kaliti berilganida asosiy tarjima Claude Sonnet orqali olinadi; Claude kaliti bo'lmasa Gemini `gemini-3.8-flash` ishlatiladi. Kalitlar loyiha yoki GitHub'ga kiritilmaydi; faqat ushbu kompyuterda quyidagi faylda saqlanadi:

```json
~/.config/quick-translate/providers.json
{"apiKey":"YOUR_GEMINI_API_KEY","claudeApiKey":"YOUR_CLAUDE_API_KEY"}
```

Papka `0700`, fayl `0600` ruxsatida bo'lishi kerak. Google zaxira so'rovi fonda tayyorlanadi, ammo tanlangan AI muvaffaqiyatli bo'lsa uning natijasi ishlatilmaydi. Claude sakkiz soniyada, Gemini olti soniyada javob bermasa, HTTP xatosi bersa yoki JSON javobi to'liq/ishonchli bo'lmasa, tayyor zaxira natijasi darhol ishlatiladi. Claude va Gemini bir vaqtda yuborilmaydi — pullik AI so'rovlari ikki marta hisoblanmaydi. Shu sababli foydalanuvchi uchun oyna o'lchami, joylashuvi va dizayni o'zgarmaydi.

Claude odatda `src/items/tag/text` formatini qaytaradi. Ayrim model versiyasi mos ma'nodagi `source_language`, `UZ`, `RU`, `EN` maydonlarini qaytarsa, adapter ularni faqat kutilgan ikki til va bo'sh bo'lmagan matnlar mavjud bo'lgandagina xavfsiz standart formatga o'tkazadi. Boshqa har qanday javob rad etilib fallback ishlaydi.

Providerlar orasidagi tanlov `translation-orchestrator.js` dagi aniq holat mashinasi bilan boshqariladi. Primary va fallback qaysi tartibda tugashidan qat'i nazar UI faqat bir marta yangilanadi; bekor qilingan so'rov jim tugaydi; ikkala kanal ishlamasa provider nomini oshkor qilmaydigan yagona tushunarli xabar chiqadi. Eski `gemini.json` vaqtincha backward-compatible o'qiladi, yangi standart `providers.json`.

## So'zni gap ichida ko'rish

Tarjima tayyor bo'lgach RU, EN yoki UZ til belgisini bosing. Pastda tanlangan tilda 15 px qisqa misol, uning ostida 12 px o'zbekcha tarjima chiqadi. UZ misolda o'zbekcha matn qayta tarmoq so'rovisiz ko'rsatiladi. Faol til nuqta bilan belgilanadi; boshqa til bosilsa misol va uning tarjimasi almashadi. Yuklanayotganda avtomatik yopilish to'xtaydi, lekin Esc, X va tashqariga bosish ishlaydi. Copy oldingidek asosiy tarjimalarni nusxalaydi.

Misollar mavjud Google lug'at xizmatidan olinadi. Tanlangan tilda misol bo'lmasa, inglizcha misol qidirilib shu tilga tarjima qilinadi. Qisqa inglizcha iborada boshlang'ich yordamchi fe'l yoki artikl olib tashlanishi mumkin. Ko'p ma'noli so'zning kerakli ma'nosi har doim aniqlanmaydi; ayrim so'z va iboralar uchun misol mavjud emas. Bunday holatda «Misol topilmadi» ko'rsatiladi. Bu AI orqali har qanday so'z uchun yangi gap yaratish xizmati emas.

Bir karta ichida muvaffaqiyatli misollar xotirada saqlanadi; diskka yozilmaydi. Misol so'rovi 15 soniyadan oshmaydi; til almashtirilsa yoki karta yopilsa eski so'rov bekor qilinadi.

## O'rganish funksiyalari

- **Soddalashtirilgan karta:** foydalanuvchi talabiga ko'ra Gap tugmasi, gap kiritish paneli va grammatik lug'at yozuvi olib tashlandi. Aniqroq tarjima uchun manba dasturida to'liq gapni belgilang.
- **Talaffuz:** RU va EN yonidagi ovoz belgisi so'z/iborani o'qiydi; misol ostidagi belgi misolni o'qiydi. Qayta bosish to'xtatadi. Bir vaqtda bitta ovoz; karta yopilganda ovoz to'xtaydi. Internet va `ffplay` kerak, API kaliti kerak emas. 200 belgidan uzun matn kesilmaydi, izoh ko'rsatiladi. O'zbekcha ovoz mavjud deb ko'rsatilmaydi.
- **O'zbekcha ma'no:** misol ostida kichikroq shriftda uning tarjimasi chiqadi; u uchun alohida 12 soniyalik kutish chegarasi va karta ichidagi kesh mavjud.
- **Saqlash / Lug'at:** faqat tanlangan so'zlar tarjima, ochilgan misollar va lug'at ma'lumoti bilan lokal saqlanadi. Saqlangan kartada keyin ochilgan misol ham yangilanadi. Lug'at boshida bo'sh; 20 tadan sahifalanadi. Yozuvni bosib tarjimasini eslang, keyin javobini oching. O'chirish ikki bosqichli.

Saqlash manzili: `~/.local/share/quick-translate/vocabulary.json` (yoki XDG_DATA_HOME bo'lsa shu yerda). Fayl 0600 ruxsat bilan atomik almashtiriladi, oldingi nusxa zaxiralanadi. Buzilgan fayl avtomatik o'chirilmaydi yoki ustidan yozilmaydi. Limit 500 yozuv; to'lsa avval foydalanuvchi keraksizini o'chiradi. Lug'at GitHub'ga yuborilmaydi.

Alohida Copy va mahkamlash funksiyalari foydalanuvchi talabiga ko'ra qo'shilmagan. Asosiy Copy ikkala tarjimani ko'chirishda davom etadi. Bepul tarjima/lug'at/ovoz endpointlari kafolatlangan pullik API emas; xizmat javob bermasa aniq xabar chiqadi.

## Testlarni ishga tushirish

Loyiha papkasidan:

```sh
# JavaScript sintaksisini tekshirish.
node --check extension/extension.js
# Primary/fallback tartibi, ikki kanal xatosi, cancellation va bir martalik natija.
node extension/tests/translation-orchestrator.cjs
# AI JSON kontrakti va xavfsiz normalizatsiya.
node extension/tests/gemini-utils.cjs
# GNOME 46 manbasiga tayangan popup regressiya testi.
node extension/tests/popup-lifecycle.cjs
# Misol gaplar, til almashtirish, kesh va kutish chegarasi.
node extension/tests/examples.cjs
# Kartaning boshqaruvlari, lug'at va kontekst holatlari (mock UI).
node extension/tests/learning-ui.cjs
# Haqiqiy GJS/Gio fayl ruxsatlari, dublikat, buzilgan baza va ovoz validatsiyasi.
gjs -m extension/tests/learning-services.js
# Faqat tarmoq va mahalliy maxfiy Gemini sozlamasi bor bo'lsa, jonli API tekshiruvi.
gjs -m extension/tests/gemini-live.js
# Claude API va mahalliy maxfiy Claude kaliti bo'lsa, jonli API tekshiruvi.
gjs -m extension/tests/claude-live.js
```

Avtomatik test haqiqiy Wayland oynasidagi bosish/fokus sinovini almashtirmaydi. Tashqariga bosish, Esc, Copy, hover va yopilgandan keyin boshqa dasturlarni boshqarish yangi sessiyada tekshirilishi kerak.
