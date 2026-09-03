# Economic Village — audit hisoboti

Oxirgi yangilanish: 2026-09-02

## Joriy o'yin modeli

O'yin avtomatik tugamaydi va iqtisodiyot sun'iy ravishda tezlashtirilmaydi.
Host pauza/davomni boshqaradi va o'yinni kelishilgan paytda yakunlaydi.
Natija `Cash + Property/Building Value − Debt` bo'yicha saralanadi.

Pul yetishmasligi bankrotlik yoki spectator holatini yaratmaydi. Majburiy
to'lovning yetishmagan qismi qarzga o'tadi. Qarz foizga ega, daromaddan
avtomatik yopiladi va yumshoq limitdan oshganda yangi ixtiyoriy xarajatlarni
bloklaydi.

## 2026-09-02 da tuzatilgan asosiy muammolar

1. **Noto'g'ri product logic:** 10-raunddan oshuvchi ijara va qishloq solig'i
   olib tashlandi; oxirgi tirik o'yinchi modeli Net Worth modeliga almashtirildi.
2. **Erta chetlashtirish:** bankrotlik o'rniga doimiy Debt/Loan tizimi qo'shildi.
3. **Kelishuv UI xatosi:** string deal ID `onclick` ichiga qo'shtirnoqsiz
   yozilgani sabab QABUL/RAD ishlamasdi; DOM testi bilan tuzatildi.
4. **Xona ma'lumoti sizishi:** `room:state` endi membership tekshiradi.
5. **Soxta sozlamalar:** mijoz yuborgan `minPlayers`, `maxPlayers`,
   `startCash` va iqtisodiy parametrlar e'tiborsiz qoldiriladi.
6. **Xona yaratish spam xavfi:** room va gameplay hodisalari alohida
   rate-limit savatlariga ajratildi.
7. **Telegram auth:** `auth_date` majburiy qilindi, kelajak va 24 soatdan eski
   initData rad etiladi, hash `timingSafeEqual` bilan solishtiriladi.
8. **UI hisoblari:** mulk oynasi endi base narx emas, server hisoblagan joriy
   ijara va upgrade qiymatini ko'rsatadi.
9. **Hodisa tizimi:** doskadagi 5 ta aniq belgilangan katak 30 kartalik
   server-authoritative deckdan karta ochadi; deck tugamaguncha takror yo'q.

## Qarz qoidalari

| Parametr | Qiymat |
|---|---:|
| Boshlang'ich yumshoq limit | 600 |
| Aktivlardan limit | 65% |
| Foiz | har 3-raundda 3% |
| Daromaddan avtomatik to'lov | 25% |

Limitdan oshish o'yinchini chiqarmaydi. U navbat oladi, ijara oladi, mulkini
sotadi va qarzini to'laydi; faqat yangi xarid/qurilish va yangi naqd majburiyat
olish vaqtincha yopiladi.

## Test qamrovi

- Fuzz audit: pul, qarz, egalik, kelishuv, navbat va natija invariantlari.
- Edge: avtomatik kredit, mulk saqlanishi, auto/manual repayment, foiz,
  yumshoq limit, Net Worth g'olibi, 5 hodisa katagi va 30 kartaning takrorsiz decki.
- Reconnect: grace-period, host transfer, pause/resume, multi-device.
- UI integration: snapshot kontrakti, debt amallari, membership va settings.
- DOM: to'liq 3 mijozli oqim, haqiqiy QABUL/RAD, Moliya paneli va natija.
- Monitor/soak: bo'sh xona auto-pause, away skip, TTL, timer va xotira.

## Production cheklovlari

- Render Free'da SQLite fayli doimiy emas; persistent disk yoki PostgreSQL kerak.
- Bir nechta server nusxasi uchun Redis/pub-sub hali yo'q.
- Telegram bot/deep-link qatlamini keyingi bosqichda qo'shish kerak.
- Qarz parametrlari real 3–5 kishilik playtestdan keyin qayta balanslanadi.
