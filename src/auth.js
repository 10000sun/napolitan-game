// 세션 쿠키. 마리 링크(src/link.js)로 들어오면 그 신분을 쓰고, 그냥 온
// 사람은 손님으로 곧장 들어온다 — 디스코드가 문지기였던 건 없앴다.
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

/**
 * 마리 링크 없이 그냥 들어온 사람. 디스코드 없이도 곧장 손님으로 입장한다.
 * discord_id 는 실제 디스코드 ID(숫자만, link.js 참고)와 절대 겹치지 않게
 * "guest:" 를 붙인다. 쿠키가 곧 그 사람의 신분증이다 — 브라우저마다 다른
 * 손님이 되고, 같은 브라우저로 다시 오면 같은 손님으로 남는다.
 */
export async function guestUser() {
  const id = `guest:${crypto.randomUUID()}`;
  return q.upsertUser.get(id, `손님-${id.slice(7, 11)}`, null, Date.now());
}
