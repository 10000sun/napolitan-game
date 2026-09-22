// DB 연결. 운영은 D1(worker.js), 테스트는 better-sqlite3(store.js 의 nodeStore).
// 연결은 한 번만 하고, 모든 모듈은 여기의 q 를 쓴다 (ES 모듈의 살아 있는 바인딩).
import { queries } from './queries.js';

export let q = null;

export function useStore(store) {
  q = queries(store);
}

/** 반영된 규칙을 world.js 가 먹는 형태로 꺼낸다. */
export async function loadAppliedRules() {
  return (await q.appliedRules.all()).map((r) => ({
    id: r.id,
    raw_text: r.raw_text,
    effects: JSON.parse(r.effects || '[]'),
  }));
}
