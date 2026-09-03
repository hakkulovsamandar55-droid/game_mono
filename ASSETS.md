# Economic Village — final asset ro'yxati

UI kodida hozir professional bir xil stroke'li inline SVG ikonlar ishlaydi.
Quyidagi assetlar majburiy emas, lekin keyinchalik Canva, Photoshop yoki
Illustrator'da yanada boy custom ko'rinish uchun bitta vizual tizimda chizilishi
mumkin: premium, yorug', yengil skeuomorphic; bolalarcha sticker va ortiqcha
gradientlarsiz.

## 1. Brend

| Fayl | O'lcham | Izoh |
|---|---:|---|
| `brand/crest.svg` | 512×512 | Asosiy qishloq gerbi, shaffof fon |
| `brand/wordmark.svg` | 1200×260 | ECONOMIC VILLAGE yozuvi |
| `brand/app-icon.png` | 1024×1024 | Telegram bot va Mini App ikonkasi |
| `brand/share-cover.png` | 1200×630 | Taklif havolasi preview rasmi |

## 2. Doska ikonkalari

Har biri `256×256 PNG`, shaffof fon, bir xil kamera va yorug'likda.

- `tiles/start.png`
- `tiles/random-event.png`
- `tiles/tax.png`
- `tiles/village-square.png`
- `tiles/festival.png`
- `groups/farm.png`
- `groups/shop.png`
- `groups/food.png`
- `groups/transport.png`
- `groups/utility.png`
- `groups/tourism.png`
- `groups/industry.png`
- `groups/finance.png`

## 3. O'yinchi tokenlari

5 ta token `256×256 PNG`: shakli bir qarashda farqlansin, faqat rangga
tayanmasin. Masalan: uy, shamol tegirmoni, traktor, savat, tanga.

## 4. Kartalar

| Fayl | O'lcham | Soni |
|---|---:|---:|
| `cards/event-frame.png` | 900×1200 | 1 ramka |
| `cards/economy-frame.png` | 900×1200 | 1 ramka |
| `cards/event-icons/*.png` | 256×256 | har hodisaga bitta |
| `cards/economy-icons/*.png` | 256×256 | har iqtisodiy holatga bitta |

Ramkaga matn yozilmaydi; sarlavha va izoh frontendda dinamik qoladi.

## 5. UI holatlari

- `ui/empty-property.png` — mulk yo'q holati
- `ui/no-debt.png` — qarzsiz moliya holati
- `ui/debt-warning.png` — yumshoq limit oshgan holat
- `ui/offline.png` — ulanish uzilishi belgisi
- `ui/winner-badge.png` — birinchi o'rin belgisi

## Eksport qoidasi

- Rang maydoni: sRGB.
- PNG assetlarda shaffof fon.
- Bir asset ichida matn bo'lmasin.
- Ikonkalar 32 px gacha kichrayganda ham o'qilishi kerak.
- Har bir PNG uchun 1x va 2x variant chiqarilsin.
