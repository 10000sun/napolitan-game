// 원작 방명록의 진행을 그대로 재생한다.
// 컴파일러가 낼 법한 출력을 직접 넣어서, Effect → 월드 변화가 맞는지 본다.
import { buildWorld } from '../src/world.js';
import { foldEffects } from '../src/effects.js';

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

console.log(fail === 0 ? '\n전부 통과\n' : `\n${fail}건 실패\n`);
process.exit(fail ? 1 : 0);
