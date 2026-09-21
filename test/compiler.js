// 컴파일러와 LLM 어댑터를, 실제 호출 없이 fetch 를 가로채서 확인한다.
process.env.LLM_PROVIDER = 'gemini';
process.env.GEMINI_API_KEY = 'test-key';

let FAKE = null;        // 모델이 뱉을 본문
let lastReq = null;     // 마지막으로 나간 요청

globalThis.fetch = async (url, opts) => {
  lastReq = { url: String(url), headers: opts.headers, body: JSON.parse(opts.body) };
  const body = process.env.LLM_PROVIDER === 'gemini'
    ? { candidates: [{ content: { parts: [{ text: FAKE }] } }] }
    : { choices: [{ message: { content: FAKE } }] };
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
};

const { compileEntry } = await import('../src/compiler.js');
const { resolveProvider, isConfigured, describeProvider } = await import('../src/llm.js');
const { initialState } = await import('../src/effects.js');

let fail = 0;
const check = (c, label) => { console.log(`  ${c ? '✓' : '✗'} ${label}`); if (!c) fail++; };
const say = (obj) => { FAKE = JSON.stringify(obj); };

// ── 어댑터 고르기 ────────────────────────────────────────
check(resolveProvider().name === 'gemini', 'LLM_PROVIDER 로 제공자를 고른다');
check(isConfigured(), '키가 있으면 준비된 것으로 본다');
check(describeProvider().includes('gemini'), '무엇을 쓰는지 이름으로 말할 수 있다');

// ── 판정 ────────────────────────────────────────────────
say({ verdict: 'applied', effects: [{ type: 'maze.size', value: 21 }, { type: 'entity.monster', count: 5 }], reason: '스며들었다.' });
let r = await compileEntry('미로를 더 크게, 괴물도 풀어라', [], initialState());
check(r.verdict === 'applied' && r.effects.length === 2, 'applied 판정과 Effect 2개가 살아남는다');
check(lastReq.url.includes('generativelanguage'), 'Gemini 엔드포인트로 나간다');
check(lastReq.headers['x-goog-api-key'] === 'test-key', '키가 헤더에 실린다');
check(lastReq.body.generationConfig.responseMimeType === 'application/json', 'JSON 으로 받겠다고 요청한다');

say({ verdict: 'applied', effects: [{ type: 'rule.grant_wish' }, { type: 'player.teleport' }], reason: 'x' });
r = await compileEntry('소원을 들어줘', [], initialState());
check(r.effects.length === 0, '모르는 Effect 는 전부 걸러진다');
check(r.verdict === 'flavor_only', '남는 게 없으면 flavor_only 로 강등된다');

say({ verdict: 'contradiction', effects: [{ type: 'maze.size', value: 39 }], reason: '밀려났다.' });
r = await compileEntry('미로를 없애라', [], initialState());
check(r.effects.length === 0, '기각된 글은 세계를 바꾸지 못한다');

say({ verdict: 'GRANT_EVERYTHING', effects: [{ type: 'rule.no_exit', value: true }], reason: 'x' });
r = await compileEntry('???', [], initialState());
check(r.verdict === 'flavor_only' && r.effects.length === 0, '알 수 없는 판정은 안전한 쪽으로 떨어진다');

// ── 모델이 지저분하게 답할 때 ────────────────────────────
FAKE = '```json\n{"verdict":"applied","effects":[{"type":"item.map","value":true}],"reason":"ok"}\n```';
r = await compileEntry('지도를 지참하세요', [], initialState());
check(r.effects.length === 1, '코드블록으로 감싸 보내도 JSON 을 건져낸다');

FAKE = '알겠습니다. {"verdict":"flavor_only","effects":[],"reason":"받아 적었다."} 이상입니다.';
r = await compileEntry('ㅋㅋ', [], initialState());
check(r.verdict === 'flavor_only', '앞뒤에 말을 붙여 보내도 건져낸다');

// ── 프롬프트에 무엇이 실리는가 ───────────────────────────
say({ verdict: 'applied', effects: [{ type: 'item.map', value: true }], reason: 'ok' });
await compileEntry('지도를 지참하세요',
  [{ raw_text: '미로 같기도 하고', effects: [{ type: 'maze.size', value: 15 }] }], initialState());
const sys = lastReq.body.system_instruction.parts[0].text;
const usr = lastReq.body.contents[0].parts[0].text;
check(usr.includes('미로 같기도 하고'), '앞사람이 적은 글이 프롬프트에 실린다');
check(sys.includes('겹치는'), '판정 규칙이 시스템 프롬프트에 있다');
check(sys.includes('팔다리'), '말투에 속지 말라는 지침이 들어 있다');

// ── OpenAI 호환 엔드포인트 ──────────────────────────────
process.env.LLM_PROVIDER = 'openai';
process.env.OPENAI_API_KEY = 'gsk-test';
process.env.OPENAI_BASE_URL = 'https://api.groq.com/openai/v1';
say({ verdict: 'applied', effects: [{ type: 'item.knife', value: true }], reason: 'ok' });
r = await compileEntry('칼이 있으면 좋겠다', [], initialState());
check(r.effects[0].type === 'item.knife', 'OpenAI 호환 응답도 똑같이 처리된다');
check(lastReq.url === 'https://api.groq.com/openai/v1/chat/completions', 'BASE_URL 뒤에 경로를 붙인다');
check(lastReq.headers.Authorization === 'Bearer gsk-test', 'Bearer 로 키를 보낸다');
check(lastReq.body.messages[0].role === 'system', '시스템 프롬프트가 첫 메시지로 간다');

// ── object.spawn ────────────────────────────────────────
const { normalizeObject, foldEffects } = await import('../src/effects.js');

let o = normalizeObject({ name: '  웃는   가면 ', tags: 'Mask, SMILING!, porcelain, mask', emoji: '🎭x', count: 9 });
check(o.key === '웃는 가면', 'key 는 공백을 줄이고 소문자로');
check(JSON.stringify(o.tags) === '["mask","smiling","porcelain"]', '태그 정규화·중복 제거');
check(o.emoji === '🎭', '이모지는 첫 글자 하나');
check(o.count === 5, 'count 는 5 로 잘린다');
check(normalizeObject({ name: '웃는 가면', tags: 'a,b' }).key === normalizeObject({ name: '웃는  가면 ' }).key,
  '공백만 다른 이름은 같은 key');
check(normalizeObject({ name: 'Slime' }).key === normalizeObject({ name: 'slime' }).key, '대소문자만 다른 이름은 같은 key');
check(normalizeObject({ name: '   ', tags: 'x' }) === null, '빈 이름은 버린다');
check(normalizeObject({ name: 'x'.repeat(80) }).name.length === 40, '이름은 40자');
check(normalizeObject({ name: 'a', tags: 'a,b,c,d,e,f,g,h' }).tags.length === 6, '태그는 6개까지');
check(normalizeObject({ name: '가면', emoji: 'mask' }).emoji === '❔', '이모지가 아니면 ❔');
check(normalizeObject({ name: '가면', count: 0 }).count === 1, 'count 최소 1');
check(normalizeObject({ name: 'Dark Slime' }).tags[0] === 'dark slime', '태그가 없고 이름이 영어면 이름이 태그');
check(normalizeObject({ name: '젤리' }).tags.length === 0, '태그가 없고 이름이 한국어면 빈 태그');

let st = foldEffects([
  [{ type: 'object.spawn', name: '가면', tags: 'mask', emoji: '🎭', count: 1 }],
  [{ type: 'object.spawn', name: '가면', tags: 'mask,cracked', emoji: '🎭', count: 3 }],
]);
check(st.objects.length === 1 && st.objects[0].count === 3, '같은 key 는 덮어쓴다');
st = foldEffects(Array.from({ length: 40 }, (_, i) => [{ type: 'object.spawn', name: `o${i}`, tags: 'x' }]));
check(st.objects.length === 30, '오브젝트는 30종까지');

// ── 말 그대로: 새 필드 ──────────────────────────────────
o = normalizeObject({ name: '활', where: 'ENTRANCE', use: 'Ranged', moves: 'follow', desc: '  시위가 떨린다.  ' });
check(o.where === 'entrance' && o.use === 'ranged' && o.moves === 'follow', '대소문자 무시하고 받는다');
check(o.desc === '시위가 떨린다.', 'desc 는 다듬는다');
o = normalizeObject({ name: '활', where: 'ceiling', use: 'gun', moves: 'fly' });
check(o.where === 'anywhere' && o.use === 'none' && o.moves === 'still', '모르는 값은 기본값');
o = normalizeObject({ name: '가면', where: 'wall', use: 'melee', moves: 'wander' });
check(o.use === 'none' && o.moves === 'still', '벽에 붙은 건 줍지도 움직이지도 않는다');
check(normalizeObject({ name: 'x', desc: 'a'.repeat(300) }).desc.length === 120, 'desc 120자');
check(normalizeObject({ name: 'x' }).desc === '' && normalizeObject({ name: 'x' }).where === 'anywhere', '옛 규칙은 기본값');

st = foldEffects([[{ type: 'maze.layout', value: 'room' }]]);
check(st.layout === 'room', 'maze.layout room');
st = foldEffects([[{ type: 'maze.layout', value: 'cave' }]]);
check(st.layout === null, '모르는 레이아웃은 무시');
check(foldEffects([]).layout === null, '기본 레이아웃은 null (크기로 판단)');

st = foldEffects([[{ type: 'entity.monster_look', name: '거대한 거미', tags: 'spider, giant', emoji: '🕷️' }]]);
check(st.monsterLook?.key === '거대한 거미' && st.monsterLook.tags[0] === 'spider', '괴물 모습');
check(foldEffects([]).monsterLook === null, '기본 괴물 모습은 없음');

console.log(fail === 0 ? '\n전부 통과\n' : `\n${fail}건 실패\n`);
process.exit(fail ? 1 : 0);
