// 런 규칙. 연속 입장 금지와 몸 상태.
import { q } from './db.js';
import { sanitizeParts } from '../public/body.js';

/** 연달아 들어가지 못하고 기다려야 하는 시간. 아무도 오지 않을 때 방이 잠기지 않게. */
export const SOLO_WAIT_MS = 5 * 60 * 1000;

/**
 * 가장 최근에 들어간 사람이 나면 다른 누군가가 먼저 들어가야 한다.
 * 방명록을 혼자 차지하지 못하게. 다만 5분이 지나면 그냥 들어갈 수 있다 —
 * 100명이라도 새벽에는 아무도 없고, 그때 방이 잠겨 버리면 곤란하다.
 */
export async function canEnter(userId, now = Date.now()) {
  if (process.env.DEV_NO_AUTH === '1') return true;
  const last = await q.lastRun.get();
  if (!last || last.user_id !== userId) return true;
  return now - (last.started_at ?? 0) >= SOLO_WAIT_MS;
}

export async function bodyOf(userId) {
  try { return sanitizeParts(JSON.parse((await q.bodyOf.get(userId))?.lost_parts || '[]')); } catch { return []; }
}

/** 나올 때의 몸을 남긴다. 나오면 돌아온다는 규칙이 있으면 온몸으로. */
export async function saveBodyOnClear(userId, parts, healOnExit) {
  // 이미 잃은 부위는 클라이언트가 뭐라 하든 돌아오지 않는다.
  const body = healOnExit ? [] : sanitizeParts([...(await bodyOf(userId)), ...sanitizeParts(parts)]);
  await q.setBody.run(JSON.stringify(body), userId);
  return body;
}

/** 공책을 한 번이라도 열어 봤는가. 앞사람들이 무엇을 적었는지 모르고 들어가게 두지 않는다. */
export const hasReadBook = async (userId) => !!(await q.readBook.get(userId))?.read_book;
export const markBookRead = async (userId) => { await q.markRead.run(userId); };

/** 아직 끝나지 않은 판인가. 끝난 판에 죽음·클리어를 다시 기록하지 않는다. */
export const isOpen = (run) => !run.cleared_at && !run.died_at;

/** 죽으면 몸은 그 자리에 남고, 다음에 들어오는 몸은 새것이다. */
export async function resetBody(userId) {
  await q.setBody.run('[]', userId);
}
