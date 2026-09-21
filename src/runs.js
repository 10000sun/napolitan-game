// 런 규칙. 연속 입장 금지와 몸 상태.
import { q } from './db.js';
import { sanitizeParts } from '../public/body.js';

/** 가장 최근에 시작된 런이 내 것이면 들어갈 수 없다. 방명록을 혼자 차지하지 못하게. */
export function canEnter(userId) {
  if (process.env.DEV_NO_AUTH === '1') return true;
  const last = q.lastRun.get();
  return !last || last.user_id !== userId;
}

export function bodyOf(userId) {
  try { return sanitizeParts(JSON.parse(q.bodyOf.get(userId)?.lost_parts || '[]')); } catch { return []; }
}

/** 나올 때의 몸을 남긴다. 나오면 돌아온다는 규칙이 있으면 온몸으로. */
export function saveBodyOnClear(userId, parts, healOnExit) {
  const body = healOnExit ? [] : sanitizeParts(parts);
  q.setBody.run(JSON.stringify(body), userId);
  return body;
}

/** 죽으면 몸은 그 자리에 남고, 다음에 들어오는 몸은 새것이다. */
export function resetBody(userId) {
  q.setBody.run('[]', userId);
}
