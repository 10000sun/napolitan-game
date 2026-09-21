// ─────────────────────────────────────────────────────────────
// 몸
//
// 잘려 나간 부위는 이곳에서의 몸을 바꾼다. 다음에 들어올 때도 그대로다.
// 서버(world.js)도 이 파일을 읽는다. 순서를 바꾸면 이미 굴러간 방의
// "문이 요구하는 부위" 가 바뀌니 순서는 건드리지 않는다.
// ─────────────────────────────────────────────────────────────

export const PARTS = [
  { name: '머리카락 한 움큼', severity: 0, effect: null },
  { name: '왼쪽 새끼손가락', severity: 5, effect: null },
  { name: '오른쪽 검지손가락', severity: 10, effect: 'noTrigger' },
  { name: '왼쪽 손목', severity: 20, effect: 'noGrab' },
  { name: '오른쪽 팔', severity: 35, effect: 'noGrab' },
  { name: '왼쪽 발목', severity: 20, effect: 'slow' },
  { name: '오른쪽 다리', severity: 35, effect: 'slow' },
  { name: '왼쪽 귀', severity: 10, effect: 'deaf' },
  { name: '앞니 두 개', severity: 5, effect: null },
  { name: '오른쪽 눈', severity: 30, effect: 'blind' },
  { name: '혀', severity: 50, effect: null },
  { name: '신장 하나', severity: 40, effect: null },
];

export const BODY_PARTS = PARTS.map((p) => p.name);
const BY_NAME = new Map(PARTS.map((p) => [p.name, p]));

export const severityOf = (name) => BY_NAME.get(name)?.severity ?? 0;

export function effectsOf(lost) {
  return new Set(lost.map((n) => BY_NAME.get(n)?.effect).filter(Boolean));
}

/** 남은 부위 중 하나. effect 를 주면 그 효과를 가진 부위를 먼저. 다 잃었으면 null. */
export function pickPart(lost, rng = Math.random, effect) {
  const left = PARTS.filter((p) => !lost.includes(p.name));
  if (!left.length) return null;
  const pool = effect ? left.filter((p) => p.effect === effect) : [];
  const from = pool.length ? pool : left;
  return from[Math.floor(rng() * from.length)].name;
}

/** 밖에서 들어온 목록을 믿을 수 있게. 알려진 이름만, 중복 없이. */
export function sanitizeParts(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter((n) => BY_NAME.has(n)))];
}
