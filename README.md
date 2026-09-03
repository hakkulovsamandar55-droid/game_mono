# Economic Village

3–5 o'yinchili real-time Telegram Mini App iqtisodiy taxta o'yini.

## Asosiy qoida

- Vaqt yoki raund chegarasi yo'q.
- Iqtisodiyot matchni majburan tezlatish uchun sun'iy oshirilmaydi.
- Host tanaffusda o'yinni pauza qiladi va keyin davom ettiradi.
- Host o'yinni yakunlaganda eng katta **Net Worth** egasi g'olib bo'ladi.
- **Net Worth = naqd pul + mulk va binolar qiymati − qarz.**
- Majburiy to'lovga pul yetmasa o'yinchi chiqarilmaydi; farq avtomatik kreditga o'tadi.

## Qarz tizimi

- Kredit faqat ijara, soliq, karta yoki kelishuv muddati kabi majburiy to'lov yetishmaganda avtomatik olinadi.
- Daromadning 25% qismi mavjud qarzni avtomatik yopadi.
- Har 3-raundda qarzga 3% foiz qo'shiladi.
- Yumshoq limit: `600 + aktivlar qiymatining 65%`.
- Limitdan oshish o'yinchini chetlashtirmaydi; faqat yangi xarid, qurilish va naqd pul beriladigan kelishuvni vaqtincha bloklaydi.
- Qarz Moliya/Mulklar panelidan qo'lda ham yopiladi.

## Professional doska UI

- Yog'och ramka va yumshoq skeuomorphic chuqurlikka ega kvadrat o'yin stoli.
- Har bir iqtisodiy guruh doskaning ichki tomonida alohida rangli rels bilan ajratiladi.
- Barcha 28 katak yagona chiziqli SVG ikon tizimidan foydalanadi; emoji ishlatilmaydi.
- Mulk egasi, bino darajasi, o'yinchi tokenlari va joriy pozitsiya bir-biridan aniq farqlanadi.
- Uzun nomlar doskada ixcham, to'liq ma'lumot esa katak bosilganda kontekst oynasida chiqadi.
- Kubik, xarid, hodisa, pauza va navbat amallari doskaning markazida qoladi.

## Hodisa kartalari

- Doskada aniq 5 ta binafsha **HODISA / KARTA** katagi bor.
- O'yinchi shu katakka tushishi bilan 30 kartalik aralashtirilgan deckdan bitta karta avtomatik ochiladi.
- Bitta deck tugamaguncha karta takrorlanmaydi; keyingi deck ham oldingi ochilgan karta bilan boshlanmaydi.
- Kartalar foyda, xarajat va strategiya turlariga ajratilgan; ta'sirlar pul, qarz, mulk guruhi va raqiblar soniga mos hisoblanadi.
- Majburiy karta xarajatiga pul yetmasa o'yinchi chiqarilmaydi — yetishmagan qism qarz tizimi orqali hisoblanadi.

## Tarkib

```text
backend/          Node.js server (Express + Socket.IO + SQLite)
  public/         frontend — build talab qilmaydigan SPA
  src/data/       28 katakli doska, kartalar, iqtisodiy hodisalar
  src/game/       engine, state, qarz, kelishuv va bot mantiqi
  src/lib/        Telegram auth va doimiy saqlash
  src/rooms.js    xona, host, pauza va reconnect
  src/socket.js   real-time va ruxsat tekshiruvlari
  scripts/        audit, monitoring, DOM va yuk testlari
  AUDIT.md        joriy tekshiruv hisoboti
  render.yaml     Render konfiguratsiyasi
ui-mockup.html    dastlabki UI mockup
ASSETS.md          yakuniy custom assetlar ro'yxati
```

## Ishga tushirish

```bash
cd backend
npm ci
cp .env.example .env
npm start
```

Telegramdan tashqarida lokal sinash uchun `.env` ichida `ALLOW_DEV_AUTH=1`
qiling. Productionda bu qiymat `0` bo'lishi va `BOT_TOKEN` kiritilishi shart.

## Testlar

```bash
npm run check             # barcha avtomatik tekshiruvlar
npm run audit             # fuzz va invariant audit
npm run edge              # aniq qoida/qarz ssenariylari
npm run test:reconnect    # uzilish va qayta ulanish
npm run monitor           # timer, xona va holat monitoringi
npm run test:ui           # frontend ↔ server shartnomasi va xavfsizlik
npm run test:dom          # haqiqiy DOM ichida UI oqimi
npm run soak              # uzoq yuk testi
npm run sim               # balans simulyatsiyasi
```

## Xavfsizlik

- Telegram `initData` HMAC va 24 soatlik `auth_date` bilan tekshiriladi.
- Xona snapshotini faqat shu xonadagi o'yinchi oladi.
- Mijoz `startCash`, o'yinchi soni yoki qarz parametrlarini o'zgartira olmaydi.
- Xona yaratish, qo'shilish va o'yin amallari alohida rate-limit bilan himoyalangan.
- Server o'yin holatini o'zi hisoblaydi; mijoz faqat niyat yuboradi.

## Deploy

`backend/render.yaml` bitta servisda frontend, API va WebSocket'ni ishga tushiradi.
`BOT_TOKEN` va aniq `CORS_ORIGIN` Render panelida kiritiladi.

Render Free fayl tizimi vaqtinchalik. Pauza qilingan o'yinlar server qayta
ishga tushganda ham saqlanishi kerak bo'lsa persistent diskni yoqing yoki
keyingi bosqichda PostgreSQL store ishlating.

## Hali qolgan ishlar

- Telegram bot va xona deep-linklari.
- Xohlansa, inline SVG ikonlarni keyinchalik custom illustration assetlariga almashtirish.
- Real 3–5 kishilik playtest asosida qarz foizi va limit balansini sozlash.
