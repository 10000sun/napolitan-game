// 디스코드 OAuth2. 지정한 서버(길드)의 멤버만 입장시킨다.
import crypto from 'node:crypto';
import { q } from './db.js';

const SECRET = () => process.env.SESSION_SECRET || 'dev-secret';
const API = 'https://discord.com/api/v10';

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', SECRET()).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verify(token) {
  if (!token || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const expect = crypto.createHmac('sha256', SECRET()).update(body).digest('base64url');
  if (mac.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
}

export function setSession(res, user) {
  const token = sign({ uid: user.id, name: user.username, exp: Date.now() + 30 * 864e5 });
  res.cookie('nps', token, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 864e5, secure: (process.env.BASE_URL || '').startsWith('https') });
}

export function currentUser(req) {
  if (process.env.DEV_NO_AUTH === '1') {
    const u = q.upsertUser.get('dev-local', '테스트 플레이어', null, Date.now());
    return u;
  }
  const s = verify(req.cookies?.nps);
  return s ? q.userById.get(s.uid) : null;
}

export function requireUser(req, res, next) {
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error: '문 밖에 서 있습니다. 로그인이 필요합니다.' });
  req.user = u;
  next();
}

export function authUrl() {
  const p = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID || '',
    redirect_uri: `${process.env.BASE_URL}/auth/callback`,
    response_type: 'code',
    scope: 'identify guilds',
  });
  return `https://discord.com/oauth2/authorize?${p}`;
}

/** code → 유저. 길드 멤버가 아니면 null. */
export async function exchangeCode(code) {
  const tokenRes = await fetch(`${API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: `${process.env.BASE_URL}/auth/callback`,
    }),
  });
  if (!tokenRes.ok) throw new Error('디스코드 인증에 실패했습니다.');
  const { access_token } = await tokenRes.json();
  const h = { Authorization: `Bearer ${access_token}` };

  const guilds = await (await fetch(`${API}/users/@me/guilds`, { headers: h })).json();
  const gid = process.env.DISCORD_GUILD_ID;
  if (gid && !(Array.isArray(guilds) && guilds.some((g) => g.id === gid))) return null;

  const me = await (await fetch(`${API}/users/@me`, { headers: h })).json();
  return q.upsertUser.get(me.id, me.global_name || me.username, me.avatar, Date.now());
}
