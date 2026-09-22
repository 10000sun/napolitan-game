// 세션 쿠키. 입장은 마리 링크(src/link.js)로만 한다.
import crypto from 'node:crypto';
import { q } from './db.js';

const SECRET = () => process.env.SESSION_SECRET || 'dev-secret';

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
