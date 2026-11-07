# Tezkor Tarjimon (Quick Translate) — Loyiha hujjati va Texnik tavsif

## Eng so'nggi UI talabi

Foydalanuvchi Gap tugmasi/kiritish paneli va so'z turkumi/lug'at shakli yozuvini rad etdi; ular olib tashlandi. RU/EN/UZ bosilganda 15 px misol ostida 12 px o'zbekcha tarjima chiqadi. Tarjima alohida bekor qilinadigan so'rov, 12 soniyalik timeout va keshga ega; lug'atga ham saqlanadi. Quyidagi eski bo'limlardagi Gap/grammatika tavsiflari tarixiydir.

## 2026-11-07: kontekst va o'rganish funksiyalari

Asosiy ishchi manzil: `/home/shamsiddin/Documents/project/instrument/quick-translate/`. GNOME o'rnatilgan nusxasi `.local/share/gnome-shell/extensions/touchpad-gestures@alpha.com/` da qoladi.

- `Gap`: to'liq gapni qayta tarjima qilish, manba tili Auto/UZ/RU/EN. Bu AI orqali alohida so'z ma'nosini ajratish emas; sifat uchun butun gap qo'lda beriladi.
- RU/EN talaffuzi va misol gap ovozi: Google TTS + ffplay, kalitsiz, internet kerak, 200 belgi va 30 soniya chegarasi. Popup yopilishi jarayonni to'xtatadi.
- Til belgisiga bosganda lug'at manbasi bilan so'z turkumi/lug'at shakli ko'rsatiladi. Yo'q ma'lumot taxmin qilinmaydi.
- `Saqlash` va `Lug'at`: lokal xususiy JSON, takroriy yozuvni yangilash, misollar, 20 yozuvli sahifalar, javobni yashirib takrorlash, ikki bosqichli o'chirish. 500 yozuv chegarasida avtomatik o'chirish yo'q.
- Alohida nusxalash va kartani mahkamlash foydalanuvchi talabiga ko'ra qo'shilmagan.
- Xizmat moduli: `extension/learning-services.js`; lug'at ma'lumoti: `extension/example-utils.js`; testlar `extension/tests/` da. Test buyruqlari README'da.
- Holat: avtomatik regression va haqiqiy Gio saqlash testlari o'tgan; ovoz manbasi MP3 qaytarishi tekshirilgan. Ovozning karnaydan eshitilishi va yangi UI haqiqiy kompozitorda tekshirilmagan; kod Log Out/Log In dan keyin yuklanadi.

Ushbu hujjat boshqa chat yoki yangi AI sessiyasida loyihani aynan to'xtagan joyidan davom ettirish uchun to'liq texnik ma'lumotlarni o'z ichiga oladi.

---

## 1. Loyiha maqsadi va Talablar

Foydalanuvchi brauzerda (yoki tizimdagi istalgan dasturda) matnni sichqoncha bilan belgilab, klaviaturadan **`Ctrl` + `Alt` + `Z`** kombinatsiyasini bosganda:
1. **Joylashuv:** Tarjima oynasi matn belgilangan joydagi kursor ustida (agar ekran tepasiga juda yaqin bo'lsa, ostida) markazlashib chiqishi kerak.
2. **Dizayn va O'lcham:** 
   - Haqiqiy bank plastik kartasi (ID-1 / CR80 formati, 85.6 × 53.98 mm, ~1.6:1 nisbat) masshtabida: **480 × 300 px**, burchak radiusi **18 px**.
   - OpenAI/ChatGPT qora minimalist uslubi (`#121212`, to'q fon, nozik hoshiya, sof oq yirik matn, hech qanday emojilarsiz).
3. **Ko'p tilli tarjima (Dual Output):**
   - Agar **o'zbekcha** matn kiritilsa — bir vaqtda ham **Ruscha (RU)**, ham **Inglizcha (EN)** variantlari chiqadi.
   - Agar **inglizcha** kiritilsa — **O'zbekcha (UZ)** va **Ruscha (RU)** variantlari chiqadi.
   - Agar **ruscha** kiritilsa — **O'zbekcha (UZ)** va **Inglizcha (EN)** variantlari chiqadi.
4. **Qo'shimcha funksiyalar:**
   - **Copy** tugmasi orqali ikkala tarjimani bir vaqtda clipboardga nusxalash.
   - `ESC` tugmasi yoki oynadan tashqariga sichqoncha bosilganda avtomatik yopilish.
   - Belgilangan vaqt (8 soniya) davomida tegilmasa avtomatik yopilish (kursor oyna ustiga olib borilsa taymer to'xtaydi).

---

## 2. Tizim Muhiti

- **OS:** Ubuntu Linux (Wayland sessiyasi)
- **Ish stoli:** GNOME Shell 46
- **Asosiy mexanizm:** GNOME Shell Extension (`touchpad-gestures@alpha.com`) ichiga integratsiya qilingan.

---

## 3. Asosiy Fayllar va Tuzilishi

### A. Asosiy Dvigatel (GNOME Shell Extension)
- **Fayl yo'li:** `~/.local/share/gnome-shell/extensions/touchpad-gestures@alpha.com/extension.js`
- **Zaxira nusxasi:** `~/.local/share/gnome-shell/extensions/touchpad-gestures@alpha.com/extension.js.bak`

**Ushbu fayl ichidagi asosiy bloklar:**
1. **`fetchOne(text, src, tgt, callback)`**:
   Google Translate API ga `Soup.Session` orqali asinxron so'rov yuboradi.
   - *Muhim:* `client=dict-chrome-ex` ishlatilgan (`client=gtx` emas, chunki `gtx` Google tomonidan avtomatlashtirilgan so'rov sifatida bloklanadi/CAPTCHA beradi).
2. **`requestMultiTranslation(text, callback)`**:
   Matn tilini avtomatik aniqlaydi. O'zbekcha bo'lsa parallel ravishda RU va EN tarjimalarini oladi.
3. **`getSelection(callback)`**:
   Wayland primary clipboardidan matnni `wl-paste -p` (va fallback `wl-paste`) orqali asinxron oladi.
4. **`getTruePointerCoords()`**:
   Wayland ostida Mutter apparat kursor kuzatuvchisidan (`global.backend.get_cursor_tracker().get_pointer()`) foydalanadi. (Wayland da eski `global.get_pointer()` (0,0) qaytaradi!).
5. **`QuickTranslatePopup` klassi**:
   - `St.BoxLayout` orqali `width: 480, height: 300` o'lchamli to'liq qora kartani yaratadi.
   - `Main.layoutManager.addTopChrome(this.actor)` orqali barcha oynalardan ustun qilib ekranga joylaydi.
   - `_positionWidget()` orqali kursorni aniq hisoblab, ekranning chetlariga chiqib ketmasligini ta'minlaydi.
6. **Triggerlar (`enable()` ichida)**:
   - `global.stage.connect('captured-event')` — to'g'ridan-to'g'ri `Ctrl + Alt + Z` tugmalarini eshitadi.
   - `Gio.File.new_for_path('/tmp/quick_translate_trigger').monitor_file(...)` — `/tmp/quick_translate_trigger` faylidagi o'zgarishlarni Linux yadrosi inotify orqali ushlaydi.

### B. Klaviaturadan Chaqirish Skripti (CLI Trigger)
- **Fayl yo'li:** `~/.local/bin/quick-translate`
- **Kodi:**
  ```bash
  #!/usr/bin/env bash
  touch /tmp/quick_translate_trigger
  ```
- **Vazifasi:** GNOME tizim klavishlari (`media-keys`) `Ctrl + Alt + Z` ni bosganda ushbu skriptni chaqiradi. Skript `/tmp/quick_translate_trigger` ga `touch` berishi bilan GNOME Shell dagi inotify hodisasi 0.5 ms ichida tarjimonni ochadi.

### C. GNOME Tizim Klavishlari (GSettings)
- **Sozlama:** `org.gnome.settings-daemon.plugins.media-keys`
  - `custom0` bog'langan: `<Primary><Alt>z` -> `/home/shamsiddin/.local/bin/quick-translate`

### D. Bekor qilingan / O'chirilgan eski qismlar:
- `~/.local/bin/quick-translate-daemon.disabled`:
  Oldingi tashqi Python GTK3 jarayoni. U Wayland da kursor koordinatasini bila olmagani sababli doim yuqori chap burchakka (`x=20, y=24`) qisilib qolar va o'lchami kichik bo'lib qolardi. Hozir u to'liq to'xtatilgan va o'chirilgan.

---

## 4. Tuzatilgan Asosiy Muammolar va Tajribalar (Lessons Learned)

1. **Wayland da kursor koordinatasining yo'qolishi:**
   - Wayland brauzer (Chrome/Firefox) ustida turganda X11 yoki tashqi GTK jarayonlariga sichqoncha koordinatasini bermaydi (xavfsizlik sababli).
   - Yagona to'g'ri yo'l: GNOME Shell kompozitori ichida `global.backend.get_cursor_tracker()` orqali apparat kursorini o'qish.
2. **Google Translate API bloklanishi:**
   - Standart `client=gtx` so'rovlariga Google bot-himoyasi yoqilib, HTML xatolik qaytaradi.
   - `client=dict-chrome-ex` esa rasmiy brauzer kengaytmalari kanali bo'lgani uchun cheklovsiz va juda tez ishlaydi.
3. **GNOME Shell St.BoxLayout o'lchami:**
   - St.BoxLayout da faqat CSS `width/height` yozish yetarli emas, GNOME uni bolalarining hajmiga qarab kichraytirib yuboradi.
   - Plastik karta o'lchamini qat'iy ushlash uchun `actor.set_size(480, 300)` va CSS da `min-width: 480px; max-width: 480px; min-height: 300px; max-height: 300px;` berildi.
4. **IPC / Chaqiruv ishonchliligi:**
   - Unix socketlar (EADDRINUSE yoki permission) ba'zida ulanishni rad etishi mumkin (`ConnectionRefused`).
   - Linux yadrosining `inotify` fayl monitori (`touch /tmp/quick_translate_trigger`) 100% buzilmas va barqaror ishlaydi.

---

## 5. Yangi Chatda Qilinishi Mumkin Bo'lgan Keyingi Qadamlar (G'oyalar)

Agar keyingi chatda loyihani yanada rivojlantirmoqchi bo'lsangiz:
1. **Oflayn tarjima yoki Ollama / DeepSeek / OpenAI API integratsiyasi:**
   - Google Translate o'rniga lokal LLM yoki boshqa tarjima dvigatellarini tanlash imkoniyati.
2. **Tarix (History):**
   - Tarjima qilingan so'zlarni kichik faylga (`~/.local/share/quick-translate/history.json`) saqlab borish.
3. **Ovozli o'qish (TTS):**
   - Tarjima qilingan inglizcha yoki ruscha so'zni eshitish uchun kichik ovoz tugmachasi.

---

## 6. Foydali Buyruqlar (Test va Qayta yuklash)

Kengaytmani sintaksisini tekshirish:
```bash
node -c ~/.local/share/gnome-shell/extensions/touchpad-gestures@alpha.com/extension.js
```

Kengaytmani o'chirib-yoqish (koddagi o'zgarishlarni qayta yuklamaydi):
```bash
gnome-extensions disable touchpad-gestures@alpha.com && sleep 1 && gnome-extensions enable touchpad-gestures@alpha.com
```

**Muhim:** GNOME Shell JavaScript modullarni sessiya davomida keshlaydi. Wayland ostida o'zgartirilgan `extension.js` yuklanishi uchun ishlarni saqlab, **Log Out**, so'ng qayta **Log In** qilish kerak. `ACTIVE` holati yangi kod yuklanganini yoki tarjimon ishlayotganini tasdiqlamaydi.

Terminaldan tarjima oynasini ochib ko'rish:
```bash
echo -n "Salom dunyo" | wl-copy -p && /home/shamsiddin/.local/bin/quick-translate
```

---

## 7. Joriy holat (2026-11-07)

### Barqarorlik tuzatishlari

### Oynaning ochilish va yopilish tartibi

#### Amaldagi muhandislik yangilanishi (2026-11-07)

Quyidagi tartib avvalgi qo'lda modal boshqarish tavsiflarini almashtiradi:

- GNOME 46 ning o'z `GrabHelper` komponenti Esc, tashqi bosish, touch va fokusni qaytarishni boshqaradi. Grab olinmasa popup darhol tozalanadi va xabar ko'rsatiladi.
- Holatlar: `loading → ready/error → closed`. Yopish idempotent: ikkinchi yopish resurslarni qayta bo'shatmaydi.
- Tarmoq sessiyasi timeoutidan tashqari butun tarjima uchun 20 soniyalik deadline bor. Javob, xato yoki yopilish deadline'ni tozalaydi.
- GNOME 46 kursor API: `Meta.CursorTracker.get_for_display(global.display)`. Oldingi `global.backend.get_cursor_tracker()` bu tizimda mavjud emas; uning watcher kodi olib tashlandi.
- Takrorlanuvchi test: `node ~/.local/share/gnome-shell/extensions/touchpad-gestures@alpha.com/tests/popup-lifecycle.cjs`. Test tizimning haqiqiy GrabHelper manbasini yuklaydi, hodisalar va resurslar boshqaruvini mock muhitda tekshiradi.
- Sintaksis, GNOME API mavjudligi va regressiya testlari tekshirildi. Bu real kompozitorning vizual/input sinovi emas. Yangi sessiyada karta ichki tugmalari, tashqi bosish, Esc, hover, timeout va yopilgandan keyin boshqa dasturga bosish qo'lda tasdiqlanishi kerak.

- Tuzatish: modal grab kartaning o'ziga emas, sahnaga mos shaffof ota qatlamga beriladi. Tashqi bosish va Esc shu qatlamning captured-event signalida ushlanadi. Yopilganda grab darhol bo'shatiladi, qatlam animatsiya tugagach olib tashlanadi. Avtomatik sinovda ichki bosish saqlanishi, tashqi bosish, touch va Esc yopishi tekshirildi; real Wayland tekshiruvi yangi sessiyada bajarilishi kerak.

- Yopiq oynada Ctrl+Alt+Z tanlovni oladi; ochiq oynada shu tugma oynani yopadi. Tanlov olinayotgan vaqtdagi ikkinchi chaqiruv kutishni bekor qiladi.
- Modal grab klaviatura fokusini kartaga beradi. Esc, X yoki karta tashqarisiga bosish yuklanish vaqtida ham yopadi. Tashqi bosish orqadagi dasturga o'tkazilmaydi.
- Natija yoki xato chiqqach 8 soniyalik taymer ishlaydi; hover vaqtida to'xtaydi, kursor chiqsa yangi 8 soniya boshlanadi.
- Overview, sessiya holati yoki monitorlar o'zgarsa oyna yopiladi.
- Yopilish modal grab, signal, taymer va tarmoq so'rovini tozalaydi. Kechikkan javob oynani qayta ochmaydi.
- Lifecycle avtomatik sinovlari o'tdi: loading/ready, hover, modal release, bekor qilish va takroriy destroy. Haqiqiy sessiyadagi vizual tekshiruv hali zarur.

- So'rovlar 12 soniyalik tarmoq timeout va HTTP/JSON tekshiruvi bilan bajariladi.
- Yangi chaqiruv, popup yopilishi yoki extension o'chirilishi eski tarjima so'rovini bekor qiladi.
- Belgilangan matn 2 soniyalik chegarada olinadi. Oddiy clipboardga avtomatik fallback olib tashlandi: eski nusxalangan matn tanlov deb tarjimaga yuborilmaydi.
- 3000 belgidan uzun matn yashirin kesilmaydi; foydalanuvchiga qisqaroq tanlov qilish aytiladi.
- Xatoli tarjima o'rnida asl matn boshqa til belgisi bilan ko'rsatilmaydi. Copy faqat olingan tarjimalarni nusxalaydi.
- Uzun tarjimalar suriladigan maydonga joylanadi. Natija chiqmaguncha avtomatik yopilish taymeri boshlanmaydi; kursor ustida bo'lsa taymer to'xtaydi.
- Copy taymeri oyna yopilganda tozalanadi; nol va manfiy monitor koordinatalari qabul qilinadi.
- Avtomatik tekshiruv: UZ/RU/EN/boshqa til yo'nalishlari, parallel so'rov boshlanishi, natijaning bir marta qaytishi va xatoda soxta tarjima yo'qligi tekshirildi.
- Cheklov: yangilangan kodni real GNOME sessiyasida sinash uchun Log Out / Log In zarur. UI oqimi hali yangi sessiyada tasdiqlanmagan.

- GNOME Shell 46 da `touchpad-gestures@alpha.com` kengaytmasi **ACTIVE** holatda.
- `Ctrl + Alt + Z` uchun GNOME media-key bog'lanishi `quick-translate` skriptiga ulangan; kengaytma ichidagi to'g'ridan-to'g'ri klaviatura ushlagichi ham zaxira trigger sifatida qolgan.
- `wl-paste` va `wl-copy` tizimda mavjud.
- O'zbekcha kirish uchun RU va EN so'rovlari endi ketma-ket emas, bir vaqtda yuboriladi.
- Popup ESC, tashqi bosish yoki vaqt tugashi bilan yopilsa, kechikib kelgan tarmoq javobi unga qayta yozilmaydi.
