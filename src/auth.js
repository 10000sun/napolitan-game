// 세션 쿠키. 입장은 마리 링크(src/link.js)로만 한다.
import crypto from 'node:crypto';
import { q } from './db.js';

const SECRET = () => process.env.SESSION_SECRET || 'dev-secret';
const MAX_AGE = 30 * 86400;

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

/** Set-Cookie 값. https 면 Secure. */
export function sessionCookie(user, secure = false) {
  const token = sign({ uid: user.id, name: user.username, exp: Date.now() + MAX_AGE * 1000 });
  return `nps=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${MAX_AGE}${secure ? '; Secure' : ''}`;
}

export const clearCookie = () => 'nps=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0';

/** Cookie 헤더에서 로그인한 사람. 없거나 망가졌으면 null. */
export async function currentUser(cookieHeader) {
  if (process.env.DEV_NO_AUTH === '1') return q.upsertUser.get('dev-local', '테스트 플레이어', null, Date.now());
  const token = /(?:^|;\s*)nps=([^;]*)/.exec(cookieHeader || '')?.[1];
  const s = verify(token);
  return s ? q.userById.get(s.uid) : null;
}
