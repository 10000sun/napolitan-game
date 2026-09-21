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

console.log(fail === 0 ? '\n전부 통과\n' : `\n${fail}건 실패\n`);
process.exit(fail ? 1 : 0);
