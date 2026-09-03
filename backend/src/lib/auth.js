// ============================================================================
// Telegram WebApp initData tekshiruvi (HMAC-SHA256).
// DEV rejimida (ALLOW_DEV_AUTH=1) soxta foydalanuvchiga ruxsat beriladi.
// ============================================================================
import crypto from 'node:crypto';

export function verifyInitData(initData, botToken) {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');

  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calc = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
  if (!/^[0-9a-f]{64}$/i.test(hash)) return null;
  const given = Buffer.from(hash, 'hex');
  const expected = Buffer.from(calc, 'hex');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;

  // auth_date majburiy: 24 soatdan eski yoki kelajakdan kelgan initData
  // replay/soxta vaqt sifatida rad etiladi.
  const authDate = Number(params.get('auth_date'));
  const age = Date.now() / 1000 - authDate;
  if (!Number.isInteger(authDate) || authDate <= 0 || age > 86400 || age < -300) return null;

  try {
    const user = JSON.parse(params.get('user') || 'null');
    if (!user?.id) return null;
    return {
      id: `tg${user.id}`,
      tgId: user.id,
      name: [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || 'Player',
      username: user.username || null,
      avatar: user.photo_url || null,
    };
  } catch { return null; }
}

export function devUser(raw) {
  const id = String(raw || Math.floor(Math.random() * 1e6));
  return { id: `dev${id}`, tgId: null, name: `Dev-${id.slice(-4)}`, username: null, avatar: null };
}

export function authenticate({ initData, devId }, { botToken, allowDev }) {
  const real = verifyInitData(initData, botToken);
  if (real) return real;
  if (allowDev) return devUser(devId);
  return null;
}
