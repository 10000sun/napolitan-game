// 원작 방명록을 그대로 채워 넣는다.
// API 키 없이 "이미 굴러간 방"을 보고 싶을 때 쓴다.
//   DB_PATH=./dev.db node test/seed.js
import db, { q } from '../src/db.js';

const SCRIPT = [
  ['아무 말이나 적고 가면 그냥 나갈 수 있는 거 같아요 신기하네.', 'flavor_only', []],
  ['미로 같기도 하고 재밌네요.', 'applied', [{ type: 'maze.size', value: 15 }]],
  ['뭐 그래도 미로에 괴물은 없네. 아닌가 있는데 못 본 걸 수도?', 'applied', [{ type: 'entity.monster', count: 4 }]],
  ['미로에 있는 시체들 미끼로 던지면 몸 안 상하고 시간 벌 수 있음. 멀쩡한 시체 찾을 때마다 챙겨 놓으세요.',
    'applied', [{ type: 'entity.corpses', count: 18 }]],
  ['공책 앞에 놓여져 있는 권총을 쓰면 괴물 견제하기 쉬울 거 같습니다. 탄창은 입구 왼쪽에 쌓여 있는 거 쓰면 충분할 거 같네요.',
    'applied', [{ type: 'item.pistol', value: true }, { type: 'item.ammo', count: 40 }]],
  ['위에 권총 쓴 새끼 천사인가 진짜 고맙다 덕분에 살았다.', 'flavor_only', []],
  ['미로가 너무 쉽긴 하네. 함정 같은 것도 있으면 좋을 듯.', 'applied', [{ type: 'maze.traps', count: 12 }]],
  ["다음 분들은 꼭 공책 밑에 있는 '미로의 구조와 함정 위치와 종류가 표시 되어 있는 지도'를 꼭 지참하고 들어가세요.",
    'applied', [{ type: 'item.map', value: true }, { type: 'item.map_shows', what: 'traps' }]],
  ['괴물 위치도 나오네 말 안 된다 이거.', 'applied', [{ type: 'item.map_shows', what: 'monsters' }]],
  ['지도는 신이야.', 'duplicate', []],
  ['다음부터는 나갈 때 무조건 무작위로 자기 신체 부위 하나를 미로 안에 놓고 와야 함.',
    'applied', [{ type: 'rule.exit_cost', cost: 'random_body_part' }]],
  ['어떤 신체 부위인지 알 수 있음.', 'contradiction', []],
  ['출구 밖으로 나오면 이곳에서 잃은 모든 신체 부위가 다시 완벽하고 건강한 모습으로 돌아옴.',
    'applied', [{ type: 'rule.heal_on_exit', value: true }]],
  ['여기서 신체부위는 잘려도 아프지도 않고 죽지도 않고 1분 이내로 완벽하게 재생됨.',
    'applied', [{ type: 'rule.no_pain', value: true }]],
  ['나는 권총 말고 칼 쓰는 게 더 재밌더라.', 'applied', [{ type: 'item.knife', value: true }]],
  ['괴물 수 좀 늘리고 레벨업 기능 같은 거 생기면 좋을 듯. 아 스킬도.',
    'applied', [{ type: 'entity.monster', count: 10 }, { type: 'flavor.text', text: '벽 어딘가에 누군가 칼로 눈금을 새겨 놓았다. 세어 보니 열둘이다.' }]],
];

const REASONS = {
  applied: '문장이 공책에 스며들었다. 벽 너머에서 무언가 무너지는 소리가 난다.',
  duplicate: '이미 같은 말이 적혀 있다. 잉크가 겹쳐 번질 뿐이다.',
  contradiction: '앞장의 문장이 이 글을 밀어낸다. 공책은 두 말을 동시에 듣지 않는다.',
  flavor_only: '공책은 이 글을 그저 받아 적기만 했다.',
  swallowed: '쓰자마자 글자가 종이 속으로 가라앉아 사라졌다.',
};

const existing = db.prepare('SELECT COUNT(*) AS n FROM entries').get().n;
if (existing > 0) {
  console.log(`이미 ${existing}줄이 적혀 있습니다. 비우려면 DB 파일을 지우세요.`);
  process.exit(0);
}

const user = q.upsertUser.get('seed-anon', '이름 없음', null, Date.now());
let t = Date.now() - SCRIPT.length * 36e5;
for (const [text, verdict, effects] of SCRIPT) {
  q.insertEntry.run(user.id, null, text, verdict, REASONS[verdict], JSON.stringify(effects), t);
  t += 36e5;
}
console.log(`${SCRIPT.length}줄을 채웠습니다.`);
