// 원작 방명록의 진행을 그대로 재생한다.
// 컴파일러가 낼 법한 출력을 직접 넣어서, Effect → 월드 변화가 맞는지 본다.
import { buildWorld, deathCell } from '../src/world.js';
import { foldEffects } from '../src/effects.js';
import fs from 'node:fs';

const SCRIPT = [
  ['아무 말이나 적고 가면 나갈 수 있는 거 같아요', []],
  ['미로 같기도 하고 재밌네요.', [{ type: 'maze.size', value: 15 }]],
  ['뭐 그래도 미로에 괴물은 없네. 아닌가 있는데 못 본 걸 수도?', [{ type: 'entity.monster', count: 4 }]],
  ['미로에 있는 시체들 미끼로 던지면 시간 벌 수 있음.', [{ type: 'entity.corpses', count: 20 }]],
  ['공책 앞 권총을 쓰면 괴물 견제하기 쉬울 거 같습니다. 탄창은 입구에 충분히.',
    [{ type: 'item.pistol', value: true }, { type: 'item.ammo', count: 40 }]],
  ['미로가 너무 쉽긴 하네. 함정 같은 것도 있으면 좋을 듯.', [{ type: 'maze.traps', count: 14 }]],
  ['미로의 구조와 함정 위치와 종류가 표시된 지도를 꼭 지참하고 들어가세요.',
    [{ type: 'item.map', value: true }, { type: 'item.map_shows', what: 'traps' }]],
  ['괴물 위치도 나오네 말 안 된다 이거.', [{ type: 'item.map_shows', what: 'monsters' }]],
  ['나갈 때 무조건 무작위로 자기 신체 부위 하나를 놓고 와야 함.',
    [{ type: 'rule.exit_cost', cost: 'random_body_part' }]],
  ['출구 밖으로 나오면 이곳에서 잃은 모든 신체 부위가 돌아옴.', [{ type: 'rule.heal_on_exit', value: true }]],
  ['신체부위는 잘려도 아프지도 않고 죽지도 않고 1분 이내로 완벽하게 재생됨.',
    [{ type: 'rule.no_pain', value: true }]],
  ['나는 권총 말고 칼 쓰는 게 더 재밌더라.', [{ type: 'item.knife', value: true }]],
  ['괴물 수 좀 늘리고', [{ type: 'entity.monster', count: 12 }]],
];

const rules = [];
let prevSeed = null;
let fail = 0;

const check = (cond, label) => { console.log(`  ${cond ? '✓' : '✗'} ${label}`); if (!cond) fail++; };

for (const [text, effects] of SCRIPT) {
  rules.push({ id: rules.length + 1, raw_text: text, effects });
  const w = buildWorld(rules);
  const s = w.state;
  console.log(`\n${rules.length}. "${text.slice(0, 38)}${text.length > 38 ? '…' : ''}"`);
  console.log(`   미로 ${s.mazeSize}×${s.mazeSize} · 괴물 ${w.monsters.length} · 함정 ${w.traps.length} · 시체 ${w.corpses.length}` +
              ` · 권총 ${s.pistol ? 'O' : 'X'} · 지도 ${s.map ? 'O' : 'X'} · 무적 ${s.noPain ? 'O' : 'X'}`);
  check(w.seed !== prevSeed, '규칙이 늘면 미로가 바뀐다');
  check(JSON.stringify(buildWorld(rules)) === JSON.stringify(w), '같은 방명록이면 같은 미로');
  prevSeed = w.seed;
}

const final = buildWorld(rules);
console.log('\n── 최종 상태 ──');
check(final.state.mazeSize === 15, '미로 크기 15');
check(final.monsters.length === 12, '괴물 12 (뒤에 적힌 수가 앞을 덮는다)');
check(final.state.pistol && final.state.knife, '권총·칼 둘 다');
check(final.state.ammo === 40, '탄약 40');
check(final.state.map && final.state.mapTraps && final.state.mapMonsters, '지도에 함정·괴물 표시');
check(final.state.noPain && final.state.healOnExit, '무적 + 복원');
check(final.state.exitCost === 'random_body_part', '출구가 신체 부위를 요구');
check(!!final.demandedPart, `요구 부위 결정됨 (${final.demandedPart})`);

// 배치가 서로 겹치지 않는지
const cells = [...final.monsters.map((m) => `${Math.floor(m.x)},${Math.floor(m.y)}`),
               ...final.traps.map((t) => `${t.x},${t.y}`),
               ...final.corpses.map((c) => `${c.x},${c.y}`)];
check(new Set(cells).size === cells.length, '괴물·함정·시체가 같은 칸에 겹치지 않는다');
check(final.grid[final.exit.y][final.exit.x] === 0, '출구가 벽에 박혀 있지 않다');

// 출구까지 실제로 갈 수 있는지 (BFS)
const g = final.grid, N = final.size;
const seen = new Set(['1,1']); const q = [[1, 1]];
for (let i = 0; i < q.length; i++) {
  const [x, y] = q[i];
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
    const nx = x + dx, ny = y + dy, k = `${nx},${ny}`;
    if (nx < 0 || ny < 0 || nx >= N || ny >= N || g[ny][nx] === 1 || seen.has(k)) continue;
    seen.add(k); q.push([nx, ny]);
  }
}
check(seen.has(`${final.exit.x},${final.exit.y}`), '시작점에서 출구까지 길이 있다');

// 모르는 Effect 는 걸러지는가
const junk = foldEffects([[{ type: 'rule.delete_everything' }, { type: 'maze.size', value: 9999 }]]);
check(junk.mazeSize === 41, '범위를 벗어난 값은 잘린다 (9999 → 41)');

// ── 오브젝트 ────────────────────────────────────────────
const withObj = [...rules, { id: 99, raw_text: '웃는 가면이 있었으면',
  effects: [{ type: 'object.spawn', name: '웃는 가면', tags: 'mask', emoji: '🎭', count: 3 }] }];
const wo = buildWorld(withObj);
check(wo.objects.length === 3 && wo.objects.every((o) => o.key === '웃는 가면'), '오브젝트가 count 만큼 놓인다');
check(JSON.stringify(buildWorld(withObj).objects) === JSON.stringify(wo.objects), '같은 방명록이면 오브젝트도 같은 자리');
check(wo.objects.every((o) => wo.grid[o.y][o.x] === 0), '오브젝트는 바닥 칸에만');
check(new Set(wo.objects.map((o) => o.id)).size === 3, '오브젝트 id 는 서로 다르다');

// ── 죽은 자리 시체 ──────────────────────────────────────
const nearExit = (x, y) => Math.abs(x - wo.exit.x) + Math.abs(y - wo.exit.y) <= 1;
let wallCell = null;
for (let y = 2; y < wo.size - 1 && !wallCell; y++) {
  for (let x = 2; x < wo.size - 1 && !wallCell; x++) {
    const floorNb = [[0, -1], [1, 0], [0, 1], [-1, 0]].some(([dx, dy]) => wo.grid[y + dy][x + dx] === 0);
    if (wo.grid[y][x] === 1 && floorNb && !nearExit(x, y)) wallCell = { x, y };
  }
}
const m0 = { x: Math.floor(wo.monsters[0].x), y: Math.floor(wo.monsters[0].y) };
const wd = buildWorld(withObj, [m0, wallCell, { x: 1, y: 1 }, { x: wo.exit.x, y: wo.exit.y }]);
const strip = (w) => JSON.stringify({ m: w.monsters, t: w.traps, o: w.objects, c: w.corpses.slice(0, wo.corpses.length) });
check(strip(wd) === strip(wo), '사망 기록은 괴물·함정·시체·오브젝트 위치를 바꾸지 않는다');
const added = wd.corpses.slice(wo.corpses.length);
check(added.length === 2, '시작 칸·출구 칸 사망은 버린다');
check(added[0].x === m0.x && added[0].y === m0.y, '바닥 칸에서 죽으면 그 자리에');
check(wd.grid[added[1].y][added[1].x] === 0
  && Math.abs(added[1].x - wallCell.x) + Math.abs(added[1].y - wallCell.y) === 1, '벽 칸 좌표는 가장 가까운 바닥으로');
check(buildWorld(withObj, Array(40).fill(m0)).corpses.length === wo.corpses.length + 30, '사망 시체는 30구까지');

// ── 사망 좌표 검증 ──────────────────────────────────────
check(JSON.stringify(deathCell({ x: 3, y: 4 }, 15)) === '{"x":3,"y":4}', '정상 좌표는 받는다');
for (const bad of [{ x: '3', y: 4 }, { x: -1, y: 4 }, { x: 3.5, y: 4 }, { x: 15, y: 4 }, { y: 4 }, null, { x: 3, y: 1e9 }]) {
  check(deathCell(bad, 15) === null, `이상한 좌표는 버린다 ${JSON.stringify(bad)}`);
}

check(!('hunger' in foldEffects([[{ type: 'rule.hunger', seconds: 60 }]])), '배고픔은 더 이상 없다 (옛 규칙은 버린다)');

// ── 말 그대로: 배치 ──────────────────────────────────────
const snap = JSON.parse(fs.readFileSync(new URL('./fixtures/replay-final.json', import.meta.url)));
const now = buildWorld(rules);
const { layout: _l, monsterLook: _m, objects: _o1, surfaces: _s1, ...nowOld } = now;
const { objects: _o2, ...snapOld } = snap;
delete snapOld.state.hunger;
delete nowOld.state.surfaces;
check(JSON.stringify(nowOld) === JSON.stringify(snapOld), '원작 방명록의 월드는 변경 전과 같다');
check(now.layout === 'maze', '크기 15 에 레이아웃이 없으면 미로');

const roomW = buildWorld([{ id: 1, effects: [{ type: 'maze.size', value: 15 }, { type: 'maze.layout', value: 'room' }] }]);
let inner = true;
for (let y = 1; y < 14; y++) for (let x = 1; x < 14; x++) if (roomW.grid[y][x] !== 0) inner = false;
check(roomW.layout === 'room' && inner, 'room + 15 은 내부가 전부 바닥');

const placeRules = [{ id: 1, effects: [
  { type: 'maze.size', value: 15 },
  { type: 'object.spawn', name: '활', where: 'entrance', count: 2 },
  { type: 'object.spawn', name: '종', where: 'exit', count: 2 },
  { type: 'object.spawn', name: '가면', where: 'wall', count: 5 },
  { type: 'object.spawn', name: '돌', count: 1 },
] }];
const pw = buildWorld(placeRules);
const bfs = (sx, sy) => { const d = {}; const q = [[sx, sy]]; d[`${sx},${sy}`] = 0;
  for (let i = 0; i < q.length; i++) { const [x, y] = q[i]; for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
    const nx = x + dx, ny = y + dy, k = `${nx},${ny}`; if (pw.grid[ny]?.[nx] === 0 && d[k] === undefined) { d[k] = d[`${x},${y}`] + 1; q.push([nx, ny]); } } } return d; };
const fromStart = bfs(1, 1), fromExit = bfs(pw.exit.x, pw.exit.y);
const byKey = (k) => pw.objects.filter((o) => o.key === k);
check(byKey('활').length === 2 && byKey('활').every((o) => fromStart[`${o.x},${o.y}`] <= 3), '입구 물체는 시작 칸 가까이');
check(byKey('종').length === 2 && byKey('종').every((o) => fromExit[`${o.x},${o.y}`] <= 3), '출구 물체는 출구 가까이');
const DV = [[1, 0], [0, 1], [-1, 0], [0, -1]];
check(byKey('가면').length === 5 && byKey('가면').every((o) => pw.grid[o.y][o.x] === 1
  && pw.grid[o.y + DV[o.face][1]]?.[o.x + DV[o.face][0]] === 0), '벽 물체는 벽 칸에, 바라보는 쪽은 바닥');
check(new Set(byKey('가면').map((o) => `${o.x},${o.y},${o.face}`)).size === 5, '같은 벽면에 둘은 없다');
const floorCells = pw.objects.filter((o) => o.where !== 'wall').map((o) => `${o.x},${o.y}`);
check(new Set(floorCells).size === floorCells.length, '바닥 물체끼리 겹치지 않는다');
check(!floorCells.includes('1,1') && !floorCells.includes(`${pw.exit.x},${pw.exit.y}`), '시작 칸·출구 칸은 비운다');
check(JSON.stringify(buildWorld(placeRules)) === JSON.stringify(pw), '같은 방명록이면 새 배치도 같다');

check(JSON.stringify(buildWorld(placeRules, [{ x: 1, y: 2 }, { x: 2, y: 1 }, { x: 3, y: 1 }]).objects) === JSON.stringify(pw.objects),
  '사망 기록은 입구·출구·벽 물체 위치도 바꾸지 않는다');

check(buildWorld([{ id: 1, effects: [{ type: 'object.spawn', name: '종이', pose: 'lie' }] }]).objects[0].pose === 'lie', '월드에 자세가 실린다');
check(JSON.stringify(buildWorld([{ id: 1, effects: [{ type: 'surface.look', surface: 'floor', name: '피웅덩이', color: '#551111' }] }]).surfaces?.floor?.color) === '"#551111"', '월드에 표면이 실린다');

const crowd = buildWorld([{ id: 1, effects: Array.from({ length: 30 }, (_, i) => ({ type: 'object.spawn', name: `e${i}`, where: 'entrance', count: 5 })) }]);
check(crowd.objects.length === 7, '빈 칸이 모자라면 놓을 수 있는 만큼만 (5×5 빈 방: 바닥 9 - 시작 - 출구)');

const old = buildWorld([{ id: 1, effects: [{ type: 'maze.size', value: 15 }, { type: 'object.spawn', name: '돌', count: 2 }] }]);
check(old.objects.every((o) => o.where === 'anywhere' && o.use === 'none' && o.moves === 'still'), '옛 규칙은 기본값으로');

console.log(fail === 0 ? '\n전부 통과\n' : `\n${fail}건 실패\n`);
process.exit(fail ? 1 : 0);
