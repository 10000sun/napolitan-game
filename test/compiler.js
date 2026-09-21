// 컴파일러의 파싱·검증 경로를 가짜 응답으로 확인한다.
// (실제 API 호출은 하지 않는다. fetch 를 가로챈다.)
process.env.ANTHROPIC_API_KEY = 'sk-ant-test';

let lastBody = null;
globalThis.fetch = async (url, opts) => {
  lastBody = JSON.parse(opts.body);
  return new Response(JSON.stringify({
    id: 'msg_test', type: 'message', role: 'assistant', model: 'test',
    content: [{ type: 'tool_use', id: 'tu_1', name: 'record_verdict', input: FAKE }],
    stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
};

const { compileEntry } = await import('../src/compiler.js');
const { initialState } = await import('../src/effects.js');

let FAKE = null;
let fail = 0;
const check = (c, label) => { console.log(`  ${c ? '✓' : '✗'} ${label}`); if (!c) fail++; };

// 1. 정상 반영
FAKE = {
  verdict: 'applied',
  effects: [{ type: 'maze.size', value: 21 }, { type: 'entity.monster', count: 5 }],
  reason: '문장이 공책에 스며들었다.',
};
let r = await compileEntry('미로를 더 크게, 괴물도 풀어라', [], initialState());
check(r.verdict === 'applied', 'applied 판정이 통과한다');
check(r.effects.length === 2, 'Effect 2개가 살아남는다');

// 2. 엔진이 모르는 Effect 는 사라진다
FAKE = {
  verdict: 'applied',
  effects: [{ type: 'rule.grant_wish' }, { type: 'player.teleport' }],
  reason: '스며들었다.',
};
r = await compileEntry('소원을 들어줘', [], initialState());
check(r.effects.length === 0, '모르는 Effect 는 전부 걸러진다');
check(r.verdict === 'flavor_only', '남는 게 없으면 flavor_only 로 강등된다');

// 3. 기각 판정은 Effect 를 못 남긴다
FAKE = { verdict: 'contradiction', effects: [{ type: 'maze.size', value: 39 }], reason: '밀려났다.' };
r = await compileEntry('미로를 없애라', [], initialState());
check(r.effects.length === 0, '기각된 글은 세계를 바꾸지 못한다');

// 4. 이상한 verdict 는 안전한 쪽으로
FAKE = { verdict: 'GRANT_EVERYTHING', effects: [{ type: 'rule.no_exit', value: true }], reason: 'x' };
r = await compileEntry('???', [], initialState());
check(r.verdict === 'flavor_only', '알 수 없는 판정은 flavor_only 로 떨어진다');
check(r.effects.length === 0, '그때 Effect 도 함께 버려진다');

// 5. 프롬프트에 앞사람 글이 실리는가
FAKE = { verdict: 'applied', effects: [{ type: 'item.map', value: true }], reason: 'ok' };
await compileEntry('지도를 지참하세요', [{ raw_text: '미로 같기도 하고', effects: [{ type: 'maze.size', value: 15 }] }], initialState());
const sent = lastBody.messages[0].content;
check(sent.includes('미로 같기도 하고'), '앞사람이 적은 글이 프롬프트에 실린다');
check(lastBody.tool_choice?.name === 'record_verdict', '판정 도구가 강제된다');
check(lastBody.system.includes('겹치는'), '판정 규칙이 시스템 프롬프트에 있다');

console.log(fail === 0 ? '\n전부 통과\n' : `\n${fail}건 실패\n`);
process.exit(fail ? 1 : 0);
