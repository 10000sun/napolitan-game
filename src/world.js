// ─────────────────────────────────────────────────────────────
// 월드 생성
//
// 같은 방명록이면 언제나 같은 미로가 나온다. 시드가 "반영된 규칙 목록"
// 에서만 파생되기 때문이다. 새 규칙이 반영되는 순간에만 미로가 바뀐다.
// ("다행히도 미로 구조가 계속 바뀌는 건 아닌 거 같습니다.")
// ─────────────────────────────────────────────────────────────

import { foldEffects } from './effects.js';
import { BODY_PARTS } from '../public/body.js';

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

/** (x, y) 에서 가장 가까운 바닥 칸. 범위 밖 좌표는 가장자리로 당겨서 찾는다. */
function nearestFloor(grid, x, y) {
  const n = grid.length;
  const sx = Math.max(0, Math.min(n - 1, x)), sy = Math.max(0, Math.min(n - 1, y));
  const seen = new Set([`${sx},${sy}`]);
  const q = [[sx, sy]];
  for (let i = 0; i < q.length; i++) {
    const [cx, cy] = q[i];
    if (grid[cy][cx] === 0) return { x: cx, y: cy };
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const nx = cx + dx, ny = cy + dy, k = `${nx},${ny}`;
      if (nx < 0 || ny < 0 || nx >= n || ny >= n || seen.has(k)) continue;
      seen.add(k);
      q.push([nx, ny]);
    }
  }
  return null;
}

/** 클라이언트가 보낸 사망 좌표. 믿을 수 있는 모양일 때만. */
export function deathCell(body, size) {
  const x = body?.x, y = body?.y;
  const ok = Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < size && y < size;
  return ok ? { x, y } : null;
}

const WALL_DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];   // 0 동 1 남 2 서 3 북 (game.js 의 DIRS 와 같다)

function objectOut(o, c, i) {
  const out = { id: `o:${o.key}:${i}`, key: o.key, name: o.name, emoji: o.emoji, x: c.x, y: c.y,
    where: o.where, use: o.use, moves: o.moves, desc: o.desc, pose: o.pose };
  if (c.face !== undefined) out.face = c.face;
  return out;
}

/**
 * 반영된 규칙 목록 → 플레이 가능한 월드.
 * @param {Array<{id:number, effects:Array}>} appliedRules 시간순
 * @param {Array<{x:number, y:number}>} deaths 최근 사망 칸 (최신순). 미로 구조에는 영향 없음
 */
export function buildWorld(appliedRules, deaths = []) {
  const state = foldEffects(appliedRules.map((r) => r.effects));

  // 시드는 반영된 규칙 id 들로만 결정된다 → 방명록이 그대로면 미로도 그대로.
  const seedSource = appliedRules.map((r) => r.id).join(',') || 'empty-room';
  const seed = hashString(seedSource);
  const rand = prng(seed);

  const size = state.mazeSize;
  const layout = state.layout ?? (size <= 5 ? 'room' : 'maze');
  // 크기 5 = 사실상 빈 방. 최초 상태의 "아무것도 없는 빈 공간".
  const grid = layout === 'room' ? emptyRoom(size) : generateMaze(size, rand);

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

  const objects = [];
  for (const o of state.objects) {
    if (o.where !== 'anywhere') continue;
    take(o.count).forEach((c, i) => objects.push(objectOut(o, c, i)));
  }

  const items = [];
  // 권총·탄창·지도·칼은 "공책 앞", 즉 입구 근처에 놓인다.
  if (state.pistol) items.push({ id: 'pistol', kind: 'pistol', x: 1.5, y: 2.5 });
  if (state.knife) items.push({ id: 'knife', kind: 'knife', x: 2.5, y: 1.5 });
  if (state.map) items.push({ id: 'map', kind: 'map', x: 1.5, y: 1.5, auto: true });

  // 출구가 신체 부위를 요구한다면 어떤 부위인지도 시드로 결정 (플레이마다 같음)
  const demandedPart = state.exitCost === 'random_body_part'
    ? BODY_PARTS[Math.floor(rand() * BODY_PARTS.length)]
    : null;

  // ── 말 그대로 배치. 기존 배치와 rand 순서를 흔들지 않도록 전부 여기서 한다.
  const used = new Set(['1,1', ...(exit ? [`${exit.x},${exit.y}`] : []),
    ...monsters.map((m) => `${Math.floor(m.x)},${Math.floor(m.y)}`),
    ...traps.map((t) => `${t.x},${t.y}`), ...corpses.map((c) => `${c.x},${c.y}`),
    ...items.map((it) => `${Math.floor(it.x)},${Math.floor(it.y)}`),
    ...objects.map((o) => `${o.x},${o.y}`)]);
  const nearest = (sx, sy) => {
    const d = bfsDistances(grid, sx, sy);
    const list = [];
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (d[y][x] > 0) list.push({ x, y, d: d[y][x] });
    return list.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
  };
  const takeFrom = (list, n) => {
    const out = [];
    for (const c of list) {
      if (out.length === n) break;
      const k = `${c.x},${c.y}`;
      if (used.has(k)) continue;
      used.add(k);
      out.push({ x: c.x, y: c.y });
    }
    return out;
  };
  const nearStart = nearest(1, 1);
  const nearExit = exit ? nearest(exit.x, exit.y) : null;
  // 벽면 후보: (바닥 칸, 방향) 중 그 방향이 벽. face 는 벽에서 바닥을 향하는 방향.
  const faces = [];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (grid[y][x] !== 0) continue;
    WALL_DIRS.forEach(([dx, dy], d) => {
      const wx = x + dx, wy = y + dy;
      if (wx >= 0 && wy >= 0 && wx < size && wy < size && grid[wy][wx] === 1) faces.push({ x: wx, y: wy, face: (d + 2) % 4 });
    });
  }
  for (let i = faces.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [faces[i], faces[j]] = [faces[j], faces[i]];
  }
  let faceCursor = 0;
  for (const o of state.objects) {
    if (o.where === 'anywhere') continue;
    let cells;
    if (o.where === 'wall') cells = faces.slice(faceCursor, (faceCursor += o.count));
    else if (o.where === 'exit' && nearExit) cells = takeFrom(nearExit, o.count);
    else cells = takeFrom(nearStart, o.count);   // entrance, 또는 출구가 없는 방의 exit
    cells.forEach((c, i) => objects.push(objectOut(o, c, i)));
  }

  // 여기서 죽은 사람들. 모든 배치가 끝난 뒤에 얹어야 사망 기록이 다른 배치를 흔들지 않는다.
  for (const d of deaths.slice(0, 30)) {
    const c = nearestFloor(grid, d.x, d.y);
    if (!c || (c.x === 1 && c.y === 1) || (exit && c.x === exit.x && c.y === exit.y)) continue;
    corpses.push(c);
  }

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
    objects,
    layout,
    monsterLook: state.monsterLook,
    surfaces: state.surfaces,
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
