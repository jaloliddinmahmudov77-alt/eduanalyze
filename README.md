# EduAnalyze — BSB / CHSB tahlil platformasi

O‘qituvchilar uchun BSB va CHSB natijalarini kiritish, avtomatik tahlil qilish va rasmiy Excel hisobotini tayyorlash platformasi.

## Ishga tushirish

Talab: **Node.js 22.13+** (sinovdan Node 24 bilan o‘tgan). Alohida ma'lumotlar bazasi serverini o‘rnatish shart emas.

```bash
npm install
npm run dev          # ishlab chiqish rejimi: http://localhost:5173
```

Production rejimi (bitta server, bitta port):

```bash
npm run build
npm start            # http://localhost:5174  (port: EDU_PORT o‘zgaruvchisi)
```

### Boshlang‘ich foydalanuvchilar

Birinchi ishga tushirishda avtomatik yaratiladi (`server/db.js`):

| Rol | Login | Parol |
|---|---|---|
| Administrator | `admin` | `admin123` (yoki `EDU_ADMIN_PASSWORD`) |
| O‘qituvchi (namuna) | `teacher` | `teacher123` |

**Haqiqiy foydalanishdan oldin parollarni “Sozlamalar” bo‘limida almashtiring.** Yangi o‘qituvchilarni administrator kabinetida yaratasiz.

## Imkoniyatlar

- **Dashboard** — sinflar, o‘quvchilar, BSB/CHSB hisobotlari soni, oxirgi hisobotlar.
- **Yangi hisobot** (3 qadam) — maktab, sinf, guruh, o‘quv yili, fan, nazorat turi (BSB-I/II, CHSB-I/II), o‘qituvchi F.I.O.
- **O‘quvchilar** — XLSX/XLS/CSV import (F.I.Sh. yoki Familiya+Ism ustunlari avtomatik aniqlanadi), importdan oldin ko‘rib chiqish va tahrirlash, takrorlarni aniqlash, matndan joylashtirish, qo‘lda qo‘shish, A–Z tartiblash.
- **Mezonlar** — istalgancha mezon: nom, maksimal ball, kompetensiya (Bilish / Qo‘llash / Mulohaza); qo‘shish, o‘chirish, nomini o‘zgartirish, tartibini almashtirish.
- **Excel kabi tahrirlash** — katakni bosib/Enter/F2 yoki yozishni boshlab tahrirlash; strelkalar, Tab, Enter, Home/End, PageUp/Down; Shift va sichqoncha bilan diapazon tanlash; Ctrl+C / Ctrl+X / Ctrl+V (Excel’dan bir nechta katakni joylash, bitta qiymatni diapazonga to‘ldirish); Delete; Ctrl+Z / Ctrl+Y; qator va ustun qo‘shish/o‘chirish (o‘ng tugma menyusi ham bor); sarlavhada mezon nomi, kompetensiyasi va maksimal balini tahrirlash.
- **Avtomatik hisob-kitob** — umumiy ball, foiz, Bilish/Qo‘llash/Mulohaza foizlari, sinf bo‘yicha Jami, Maksimal ball va Foiz qatorlari, baholar taqsimoti va reyting (“Tahlil” bo‘limi).
- **Avtomatik saqlash** — har o‘zgarishdan ~1 soniya keyin serverga saqlanadi; Ctrl+S ham ishlaydi.
- **Rasmiy XLSX hisobot** (o‘qituvchi namunasi maketida) — kulrang birlashtirilgan sarlavha bloki (Sinf / Fan / FIO), bitta qatorli sariq sarlavha (mezonlarning maksimal bali, jami maks., Foiz %, Bilish, Qo‘llash, Mulohaza), qalin ballar, Jami va Foizi % qatorlari, Times New Roman, qora chegaralar, haqiqiy Excel formulalari, `0%` formati, imzo qatorlari. Mezon nomlari sarlavha kataklarining izohida saqlanadi.
- **Excel’ni qayta yuklash** — yuklab olingan (hatto Excel’da tahrirlangan) faylni, shuningdek shu maketda qo‘lda tayyorlangan eski hisobotlarni ochib tahrirlashni davom ettirish (3 mezonli faylda kompetensiyalar tartib bo‘yicha: Bilish, Qo‘llash, Mulohaza).
- **Hisobotlar** — saqlash, ochish, tahrirlash, nusxa olish, o‘chirish, BSB/CHSB filtri, sinf va fan bo‘yicha qidirish.
- **Rollar** — o‘qituvchi faqat o‘z hisobotlarini ko‘radi; administrator barcha o‘qituvchi va hisobotlarni ko‘radi, foydalanuvchilar, sinflar va fanlarni boshqaradi.

## AI Smart Scanner (rasm, screenshot, kamera, PDF)

Menyu: **AI Skaner** yoki hisobot ichidagi **AI Skaner** bo‘limi.

1. **Screenshot yuklash** (JPG/PNG/WEBP, Ctrl+V bilan ham), **Kamerani ochish** (old/orqa kamera, qayta olish, ketma-ket bir nechta sahifa) yoki **PDF yuklash** (ko‘p sahifali).
2. Har bir sahifani tahrirlash mumkin: aylantirish, kesish, 4 burchak bilan perspektivani to‘g‘rilash, avtomatik tekislash.
3. **Tahlil**: qiyshiqlik avtomatik tekislanadi → jadval chiziqlari topiladi → har bir katak alohida o‘qiladi (ismlar — lotin va kirill modellari, ballar — faqat raqam rejimi, har bir ball ikki xil ishlov bilan tekshiriladi). Chiziqsiz jadvallar uchun matn joylashuvi bo‘yicha zaxira usul.
4. **Tekshirish oynasi**: chapda asl rasm, o‘ngda aniqlangan jadval; ustunlarni mezonlarga moslashtirish (yangi mezon / mavjud mezon / e’tiborsiz); noaniq, ishonchi past, maksimaldan katta yoki ikki dvigatel farq qilgan kataklar sariq bilan belgilanadi; rasmdagi “Jami” ballar yig‘indisiga mos kelmasa ogohlantiriladi; takroriy o‘quvchilar va qaysi sahifadan olingani ko‘rsatiladi; mavjud o‘quvchilarga ism bo‘yicha biriktiriladi.
5. **Tasdiqlash** — faqat shundan keyin ma’lumotlar asosiy jadvalga qo‘shiladi (Ctrl+Z bilan qaytarish mumkin). Tekshirilmagan kataklar **taxmin qilinmaydi va qo‘shilmaydi** (bo‘sh qoladi).

**Dvigatellar:**
- **Mahalliy OCR** (standart) — Tesseract (WebAssembly) brauzerning o‘zida ishlaydi; model fayllari o‘z serverimizdan (`/ocr/`) beriladi. Rasm hech qayerga yuborilmaydi, internetsiz ishlaydi.
- **AI Vision (Google Gemini)** — ixtiyoriy. Serverda muhit o‘zgaruvchisini o‘rnating:
  ```bash
  GEMINI_API_KEY=... npm start          # ixtiyoriy: GEMINI_MODEL=gemini-flash-latest
  ```
  Kalit faqat serverda saqlanadi, brauzerga hech qachon yuborilmaydi. Har bir tahlildan oldin o‘qituvchi rasm Google’ga yuborilishiga rozilik beradi. **AI + OCR** rejimida ikkala natija solishtirilib, farqli kataklar tekshirishga belgilanadi.

**Kamera:** brauzer kamerani faqat `https://` yoki `localhost` da beradi. Telefonda tarmoq orqali ochganda HTTPS kerak; aks holda “Telefon kamerasi / galereyadan yuklash” tugmasi telefonning o‘z kamerasini ochadi.

## Hisob-kitob qoidalari

- **Bo‘sh katak = baholanmagan**: na bali, na maksimal bali hisobga kiradi. **0 = nol ball** (hisobga kiradi).
- O‘quvchi foizi = kiritilgan ballar yig‘indisi / shu mezonlar maksimal ballari yig‘indisi (masalan, max 6 va 10 bo‘lgan ikki mezondan faqat birinchisiga 5 qo‘yilsa — 5/6 = 83%).
- Hech qanday bali kiritilmagan o‘quvchi (masalan, kelmagan) sinf natijalariga qo‘shilmaydi.
- Kompetensiya foizi faqat shu kompetensiyaga tegishli mezonlar bo‘yicha hisoblanadi; mezoni bo‘lmasa 0%.
- Mezon bo‘yicha sinf foizi = mezon ballari yig‘indisi / (maks. ball × shu mezon bo‘yicha baholanganlar soni). Umumiy va kompetensiya sinf foizlari ham shu tarzda. Foizlar 100% dan oshmaydi.
- Maksimal balldan katta yoki manfiy ball qabul qilinmaydi (brauzerda ham, serverda ham tekshiriladi).

Excel’dagi formulalar aynan shu qoidalarni bajaradi.

## Testlar

```bash
npm test             # hisob-kitob, Excel eksport/import, o‘quvchilarni aniqlash (60 ta tekshiruv)
npm run test:excel   # haqiqiy Microsoft Excel’da formulalarni tekshirish (Windows + Excel kerak)
npm run test:ocr     # OCR: haqiqiy screenshot (tests/fixtures/sample-11B.png, shaxsiy — repozitoriyda yo‘q) dan jadvalni o‘qish
npm run test:scan    # skaner mantiqi: ko‘p sahifa, takrorlar, AI/OCR solishtirish, qo‘llash, backend AI (mock Gemini)
```

## Tuzilma

```
server/       Express API, autentifikatsiya, SQLite (node:sqlite) — ma'lumotlar server/data/ da
client/src/
  lib/        calc.ts (hisob-kitob), excel.ts (XLSX eksport/import), importStudents.ts, api.ts
  components/ Grid.tsx (Excel kabi muharrir), Students/Criteria editor, Analysis
  pages/      Dashboard, NewReport, ReportEditor, Reports, Admin, Settings, Login
tests/        avtomatik testlar
```

Ma'lumotlar bazasi: o‘rnatishsiz ishlashi uchun Node.js ichidagi SQLite ishlatilgan (`server/data/eduanalyze.db`). Zaxira nusxa olish uchun shu faylni nusxalash kifoya. PostgreSQL’ga o‘tish kerak bo‘lsa, barcha SQL so‘rovlar `server/index.js` va `server/db.js` da jamlangan.
