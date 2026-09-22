// ─────────────────────────────────────────────────────────────
// 마리 링크
//
// 디스코드에서 마리가 준 링크로만 들어온다. 링크에는 그 사람 전용 표(토큰)가 붙는다.
//   표 = base64url(JSON) + "." + base64url(HMAC_SHA256(본문, 열쇠))
//   JSON = {"id": "디스코드ID", "n": "표시이름", "e": 만료(유닉스초), "a"?: 할 일}
//   "a" 가 없으면 입장 표, "reset" 이면 방명록 초기화 표. 서로 대신 쓰지 못한다.
// 만드는 쪽은 마리(`mari/cogs/minigame.py` 의 make_token), 검증하는 쪽은 여기다.
// 형식을 바꾸려면 두 곳을 같이 고친다 (test/server.js 의 파이썬 기준값이 지켜 준다).
// ─────────────────────────────────────────────────────────────

import crypto from 'node:crypto';

/**
 * 표가 멀쩡하면 { id, name }, 아니면 null. 열쇠가 없으면 아무것도 받지 않는다.
 * act 가 표의 "a" 와 정확히 같아야 한다. 입장 링크(act 없음)로 초기화하지 못하게.
 */
export function verifyLink(token, secret, nowSec = Math.floor(Date.now() / 1000), act = null) {
  if (!secret || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [body, mac] = parts;
  const expect = crypto.createHmac('sha256', secret).update(body, 'ascii').digest('base64url');
  if (mac.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
  let p;
  try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
  if (!p || typeof p.id !== 'string' || !/^\d{1,25}$/.test(p.id)) return null;
  if (typeof p.e !== 'number' || p.e <= nowSec) return null;
  if ((p.a ?? null) !== act) return null;
  const name = String(p.n ?? '').trim().slice(0, 32) || '이름 없는 사람';
  return { id: p.id, name };
}
