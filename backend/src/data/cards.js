// ============================================================================
// HODISA QUTISI KARTALARI (sandiq)
// Ta'siri nazorat ostida: hech qachon o'yinchini butunlay yo'q qilmaydi.
// effect(ctx) -> { text }   ctx = { state, player, api }
// ============================================================================

export const CARDS = [
  { id: 'c1', tone: 'gain', icon: '💰', title: "KUTILMAGAN DAROMAD", text: "Eski qarzni qaytarishdi. +120",
    run: (c) => c.api.credit(c.player, 120) },
  { id: 'c2', tone: 'loss', icon: '🧾', title: "KUTILMAGAN XARAJAT", text: "Uskuna ta'miri uchun −110",
    run: (c) => c.api.debit(c.player, 110) },
  { id: 'c3', tone: 'gain', icon: '🚚', title: "KATTA BUYURTMA", text: "Har bir biznesingiz uchun +25",
    run: (c) => c.api.credit(c.player, 25 * c.api.propCount(c.player)) },
  { id: 'c4', tone: 'loss', icon: '🔧', title: "TA'MIRLASH", text: "Har bir yaxshilanish uchun −35",
    run: (c) => c.api.debit(c.player, 35 * c.api.levelCount(c.player)) },
  { id: 'c5', tone: 'gain', icon: '🎁', title: "QISHLOQ YORDAMI", text: "Qishloq jamg'armasidan +80",
    run: (c) => c.api.credit(c.player, 80) },
  { id: 'c6', tone: 'loss', icon: '🏛', title: "MAHALLIY SOLIQ", text: "Har bir raqibga 30 to'laysiz",
    run: (c) => c.api.payEveryone(c.player, 30) },
  { id: 'c7', tone: 'gain', icon: '🤝', title: "HOMIYLIK", text: "Har bir raqib sizga 25 beradi",
    run: (c) => c.api.collectEveryone(c.player, 25) },
  { id: 'c8', tone: 'gain', icon: '📈', title: "YAXSHI SAVDO", text: "Naqd pulingizning 10% bonusi (maks. 150)",
    run: (c) => c.api.credit(c.player, Math.min(150, Math.round(c.player.cash * 0.1))) },
  { id: 'c9', tone: 'strategy', icon: '🛡', title: "IJARA IMTIYOZI", text: "Keyingi 2 raundda ijaralar 50% arzon",
    run: (c) => c.api.addDiscount(c.player, 2) },
  { id: 'c10', tone: 'strategy', icon: '🚀', title: "TEZ QURILISH", text: "Bitta yaxshilanish bepul (mumkin bo'lsa)",
    run: (c) => c.api.freeUpgrade(c.player) },
  { id: 'c11', tone: 'loss', icon: '⛽', title: "YO'L XARAJATI", text: "Yoqilg'i xarajati. −70",
    run: (c) => c.api.debit(c.player, 70) },
  { id: 'c12', tone: 'gain', icon: '🎪', title: "YARMARKA", text: "Savdo yaxshi ketdi. +90",
    run: (c) => c.api.credit(c.player, 90) },
  { id: 'c13', tone: 'loss', icon: '👷', title: "ISHCHI HAQI", text: "Qo'shimcha ish haqi. −60",
    run: (c) => c.api.debit(c.player, 60) },
  { id: 'c14', tone: 'gain', icon: '🏦', title: "TADBIRKORLIK GRANTI", text: "Mahalliy dasturdan +150",
    run: (c) => c.api.credit(c.player, 150) },
  { id: 'c15', tone: 'gain', icon: '🌾', title: "BARAKALI HOSIL", text: "Har bir dehqonchilik mulki uchun +35",
    run: (c) => c.api.credit(c.player, 35 * c.api.groupCount(c.player, 'farm')) },
  { id: 'c16', tone: 'loss', icon: '📋', title: "SAVDO TEKSHIRUVI", text: "Har bir do'kon uchun −25",
    run: (c) => c.api.debit(c.player, 25 * c.api.groupCount(c.player, 'shop')) },
  { id: 'c17', tone: 'gain', icon: '🍽', title: "KATTA ZIYOFAT", text: "Har bir ovqatlanish mulki uchun +35",
    run: (c) => c.api.credit(c.player, 35 * c.api.groupCount(c.player, 'food')) },
  { id: 'c18', tone: 'loss', icon: '🚏', title: "YO'L TA'MIRI", text: "Har bir transport mulki uchun −40",
    run: (c) => c.api.debit(c.player, 40 * c.api.groupCount(c.player, 'transport')) },
  { id: 'c19', tone: 'loss', icon: '⚡', title: "TARMOQ NOSOZLIGI", text: "Har bir kommunal mulk uchun −50",
    run: (c) => c.api.debit(c.player, 50 * c.api.groupCount(c.player, 'utility')) },
  { id: 'c20', tone: 'gain', icon: '🧳', title: "YAXSHI SHARHLAR", text: "Har bir turizm mulki uchun +45",
    run: (c) => c.api.credit(c.player, 45 * c.api.groupCount(c.player, 'tourism')) },
  { id: 'c21', tone: 'loss', icon: '🪖', title: "XAVFSIZLIK TEKSHIRUVI", text: "Har bir sanoat mulki uchun −40",
    run: (c) => c.api.debit(c.player, 40 * c.api.groupCount(c.player, 'industry')) },
  { id: 'c22', tone: 'gain', icon: '💳', title: "BANK DIVIDENDI", text: "Har bir mulkingiz uchun +20 (maks. 180)",
    run: (c) => c.api.credit(c.player, Math.min(180, 20 * c.api.propCount(c.player))) },
  { id: 'c23', tone: 'strategy', icon: '🏦', title: "QARZ YORDAMI", text: "Qarzdan 100 kamayadi; qarz bo'lmasa +40",
    run: (c) => c.api.debtRelief(c.player, 100, 40) },
  { id: 'c24', tone: 'loss', icon: '🏠', title: "MULK SUG'URTASI", text: "Har bir mulkingiz uchun −15",
    run: (c) => c.api.debit(c.player, 15 * c.api.propCount(c.player)) },
  { id: 'c25', tone: 'loss', icon: '↩', title: "MIJOZGA QAYTARIM", text: "Naqd pulning 8% qaytariladi (maks. 120)",
    run: (c) => c.api.debit(c.player, Math.min(120, Math.round(c.player.cash * 0.08))) },
  { id: 'c26', tone: 'gain', icon: '💹', title: "OMONAT FOIZI", text: "Naqd pulning 8% bonusi (maks. 120)",
    run: (c) => c.api.credit(c.player, Math.min(120, Math.round(c.player.cash * 0.08))) },
  { id: 'c27', tone: 'strategy', icon: '🛡', title: "IJARA SUG'URTASI", text: "Keyingi 2 raundda ijaralar 50% arzon",
    run: (c) => c.api.addDiscount(c.player, 2) },
  { id: 'c28', tone: 'gain', icon: '🧩', title: "TURLI BIZNESLAR", text: "Har xil mulk guruhi uchun +30",
    run: (c) => c.api.credit(c.player, 30 * c.api.groupDiversity(c.player)) },
  { id: 'c29', tone: 'loss', icon: '🏘', title: "MAHALLA JAMG'ARMASI", text: "Har bir raqibga 20 to'laysiz",
    run: (c) => c.api.payEveryone(c.player, 20) },
  { id: 'c30', tone: 'loss', icon: '📜', title: "RUXSATNOMA TO'LOVI", text: "Yangi ruxsatnoma uchun −90",
    run: (c) => c.api.debit(c.player, 90) },
];

// ============================================================================
// IQTISODIY HODISALAR (qishloq iqtisodiyoti)
// O'yinchi tanlamaydi — har N raundda avtomatik ishga tushadi.
// mods: guruh -> ijara koeffitsienti,  upgradeMod: qurilish narxi koeffitsienti
// ============================================================================

export const ECONOMY_EVENTS = [
  { id: 'e1', icon: '🧳', title: "TURISTLAR MAVSUMI",
    text: "Qishloqqa yuzlab turist keldi. Mehmonxona va ovqatlanish gullab-yashnaydi.",
    mods: { tourism: 2.0, food: 1.5, transport: 1.3 } },

  { id: 'e2', icon: '🛒', title: "YANGI KATTA BOZOR",
    text: "Yangi supermarket ochildi. Kichik do'konlar raqobatga duch keldi.",
    mods: { shop: 0.6, food: 0.85, industry: 1.2 } },

  { id: 'e3', icon: '🌾', title: "HOSIL YILI",
    text: "Ajoyib hosil. Dehqonchilik va oshxonalar daromadi oshdi.",
    mods: { farm: 2.0, food: 1.25 } },

  { id: 'e4', icon: '🌵', title: "QURG'OQCHILIK",
    text: "Suv tanqisligi. Dehqonchilik zarar ko'rdi, suv qimmatlashdi.",
    mods: { farm: 0.5, utility: 1.6, tourism: 0.9 } },

  { id: 'e5', icon: '🛣', title: "YANGI YO'L",
    text: "Qishloqqa yangi yo'l qurildi. Transport oqimi keskin oshdi.",
    mods: { transport: 2.0, tourism: 1.3, shop: 1.1 } },

  { id: 'e6', icon: '🏗', title: "QURILISH BUMI",
    text: "Qurilish avj oldi: sanoat daromadi oshdi, yaxshilash qimmatlashdi.",
    mods: { industry: 1.8 }, upgradeMod: 1.3 },

  { id: 'e7', icon: '⚡', title: "ELEKTR TANQISLIGI",
    text: "Quvvat yetishmayapti. Zavodlar to'xtab qoldi, kommunal qimmatlashdi.",
    mods: { utility: 2.0, industry: 0.6 } },

  { id: 'e8', icon: '🎉', title: "QISHLOQ FESTIVALI",
    text: "Katta festival. Odamlar ko'p ovqatlanmoqda va xarid qilmoqda.",
    mods: { food: 1.8, shop: 1.4, tourism: 1.2 } },

  { id: 'e9', icon: '🏭', title: "YANGI ZAVOD OCHILDI",
    text: "Yirik zavod ishga tushdi. Ish o'rinlari ko'paydi, yer qimmatlashdi.",
    mods: { industry: 1.5, farm: 0.8, shop: 1.15 } },

  { id: 'e10', icon: '💳', title: "KREDIT ARZONLASHDI",
    text: "Bank foizni tushirdi. Yaxshilash arzonlashdi, moliya kuchaydi.",
    mods: { finance: 1.6 }, upgradeMod: 0.7 },
];

export const ECONOMY_DURATION = 3;   // necha raund davom etadi
export const ECONOMY_INTERVAL = 3;   // har necha raundda bir marta
