// ─────────────────────────────────────────────────────────────
// 월드 생성
//
// 같은 방명록이면 언제나 같은 미로가 나온다. 시드가 "반영된 규칙 목록"
// 에서만 파생되기 때문이다. 새 규칙이 반영되는 순간에만 미로가 바뀐다.
// ("다행히도 미로 구조가 계속 바뀌는 건 아닌 거 같습니다.")
// ─────────────────────────────────────────────────────────────

import { foldEffects } from './effects.js';

/** mulberry32 — 짧고 시드 재현성이 확실한 PRNG. */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * 벽 뚫기 방식(recursive backtracker) 미로.
 * 반환: grid[y][x] — 1 벽, 0 바닥. 크기는 항상 홀수.
 */
function generateMaze(size, rand) {
  const grid = Array.from({ length: size }, () => Array(size).fill(1));
  const stack = [[1, 1]];
  grid[1][1] = 0;

  while (stack.length) {
    const [x, y] = stack[stack.length - 1];
    const dirs = [[0, -2], [2, 0], [0, 2], [-2, 0]];
    // Fisher-Yates
    for (let i = dirs.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
    }
    const next = dirs
      .map(([dx, dy]) => [x + dx, y + dy])
      .find(([nx, ny]) => nx > 0 && ny > 0 && nx < size - 1 && ny < size - 1 && grid[ny][nx] === 1);

    if (next) {
      const [nx, ny] = next;
      grid[(y + ny) / 2][(x + nx) / 2] = 0;
      grid[ny][nx] = 0;
      stack.push([nx, ny]);
    } else {
      stack.pop();
    }
  }
  return grid;
}

/** 시작점에서의 거리(BFS). 출구는 제일 먼 칸에 둔다. */
function bfsDistances(grid, sx, sy) {
  const size = grid.length;
  const dist = Array.from({ length: size }, () => Array(size).fill(-1));
  const q = [[sx, sy]];
  dist[sy][sx] = 0;
  for (let i = 0; i < q.length; i++) {
    const [x, y] = q[i];
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < size && ny < size && grid[ny][nx] === 0 && dist[ny][nx] < 0) {
        dist[ny][nx] = dist[y][x] + 1;
        q.push([nx, ny]);
      }
    }
  }
  return dist;
}

const BODY_PARTS = [
  '머리카락 한 움큼', '왼쪽 새끼손가락', '오른쪽 검지손가락', '왼쪽 손목', '오른쪽 팔',
  '왼쪽 발목', '오른쪽 다리', '왼쪽 귀', '앞니 두 개', '오른쪽 눈', '혀', '신장 하나',
];

/**
 * 반영된 규칙 목록 → 플레이 가능한 월드.
 * @param {Array<{id:number, effects:Array}>} appliedRules 시간순
 */
export function buildWorld(appliedRules) {
  const state = foldEffects(appliedRules.map((r) => r.effects));

  // 시드는 반영된 규칙 id 들로만 결정된다 → 방명록이 그대로면 미로도 그대로.
  const seedSource = appliedRules.map((r) => r.id).join(',') || 'empty-room';
  const seed = hashString(seedSource);
  const rand = prng(seed);

  const size = state.mazeSize;
  // 크기 5 = 사실상 빈 방. 최초 상태의 "아무것도 없는 빈 공간".
  const grid = size <= 5 ? emptyRoom(size) : generateMaze(size, rand);

  const spawn = { x: 1.5, y: 1.5 };
  const dist = bfsDistances(grid, 1, 1);

  // 도달 가능한 바닥 칸 목록 (시작점 주변은 제외)
  const cells = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (grid[y][x] === 0 && dist[y][x] > 0) cells.push({ x, y, d: dist[y][x] });
    }
  }
  cells.sort((a, b) => b.d - a.d);

  // 출구: 시작점에서 가장 먼 칸
  const exit = state.noExit ? null : (cells[0] ? { x: cells[0].x, y: cells[0].y } : { x: 1, y: 1 });

  // 배치 후보는 출구/시작점을 뺀 나머지를 섞어서 소비
  const pool = cells
    .filter((c) => !exit || c.x !== exit.x || c.y !== exit.y)
    .filter((c) => c.d > 1);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  let cursor = 0;
  const take = (n) => pool.slice(cursor, (cursor += n)).map((c) => ({ x: c.x, y: c.y }));

  const monsters = take(state.monsters).map((c, i) => ({
    id: `m${i}`, x: c.x + 0.5, y: c.y + 0.5, hp: 3, alive: true, baited: 0,
  }));
  const traps = take(state.traps);
  const corpses = take(state.corpses);

  const items = [];
  // 권총·탄창·지도·칼은 "공책 앞", 즉 입구 근처에 놓인다.
  if (state.pistol) items.push({ id: 'pistol', kind: 'pistol', x: 1.5, y: 2.5 });
  if (state.knife) items.push({ id: 'knife', kind: 'knife', x: 2.5, y: 1.5 });
  if (state.map) items.push({ id: 'map', kind: 'map', x: 1.5, y: 1.5, auto: true });

  // 출구가 신체 부위를 요구한다면 어떤 부위인지도 시드로 결정 (플레이마다 같음)
  const demandedPart = state.exitCost === 'random_body_part'
    ? BODY_PARTS[Math.floor(rand() * BODY_PARTS.length)]
    : null;

  return {
    seed,
    size,
    grid,
    spawn,
    exit,
    monsters,
    traps,
    corpses,
    items,
    demandedPart,
    state,
    ruleCount: appliedRules.length,
  };
}

function emptyRoom(size) {
  const grid = Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x) =>
      (x === 0 || y === 0 || x === size - 1 || y === size - 1) ? 1 : 0));
  return grid;
}

export { BODY_PARTS };
