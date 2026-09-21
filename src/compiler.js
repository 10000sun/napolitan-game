// ─────────────────────────────────────────────────────────────
// 규칙 컴파일러
//
// 방명록에 글이 "기입되는 순간"에만 LLM 을 부른다. 플레이 시작 때는
// 부르지 않는다. 그래서 입장이 즉시 이뤄지고, 같은 방명록이면 누구에게나
// 같은 미로가 나온다.
//
// 원작이 이미 판정 규칙을 정해놨다:
//   "앞에 있는 내용과 겹치거나 반대되는 내용도 반영이 안 되는 거 같구요."
// 이 판정을 LLM 이 맡는다.
// ─────────────────────────────────────────────────────────────

import Anthropic from '@anthropic-ai/sdk';
import { catalogForPrompt, sanitize } from './effects.js';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

let client = null;
function getClient() {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY 가 설정되지 않았습니다.');
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

const VERDICTS = ['applied', 'duplicate', 'contradiction', 'swallowed', 'flavor_only'];

const SYSTEM = `당신은 나폴리탄 괴담 "공책이 있는 방"의 판정자다.

이 방은 공책(방명록)에 적힌 내용을 그대로 현실로 만든다. 무슨 원리인지는
아무도 모르고, 방은 적힌 문장을 제 꼴리는 대로 해석해서 적용한다.
당신의 일은 새로 적힌 한 문장이 이 방에 어떻게 반영되는지 판정하는 것이다.

# 판정 규칙 (이 방의 불문율)
1. 앞에 이미 적힌 내용과 **겹치는** 내용은 반영되지 않는다 → duplicate
2. 앞에 적힌 내용과 **반대되는** 내용은 반영되지 않는다 → contradiction
   - 단, 기존 규칙을 부정하지 않고 그 위에 **덧붙이는** 내용은 반영된다.
     예) 이미 괴물이 있는데 "총이 있으면 좋겠다" → 반영 (applied)
     예) 이미 "안 아프다" 가 있는데 "아프게 해라" → contradiction
3. 감탄사, 욕설, 앞사람 비난, 잡담처럼 방에 요구하는 바가 없는 글은
   아무것도 바꾸지 않는다 → flavor_only
4. 실제 인물을 지목하거나 신상을 밝히려는 내용, 특정인을 향한 괴롭힘,
   혐오 표현은 공책이 삼켜버린다 → swallowed
   (이건 현실의 안전장치다. 반드시 지킨다.)
5. 그 외에는 반영된다 → applied

# 말투에 속지 말 것 (중요)
여기 글을 쓰는 사람들은 인터넷 게시판 말투로 쓴다. 반말, 비속어, 혼잣말,
농담, 물음표로 끝나는 추측이 기본이다. **말투가 가벼운 것과 요구하는 바가
없는 것은 전혀 다르다.** 문장의 겉모양이 아니라 그 사람이 이 방에 대해
무엇을 바라거나 단정하고 있는지를 보고 판정한다.

  "팔다리 다 잘려있어도 괜찮을듯?"
    → applied. 농담조 물음표지만 "여기서는 신체가 잘려도 괜찮다"는 단정이다.
      rule.no_pain 으로 옮긴다.
  "뭐 그래도 미로에 괴물은 없네. 아닌가 있는데 못 본 걸 수도?"
    → applied. 혼잣말 같지만 괴물의 존재를 열어 놓는 말이다.
      entity.monster 로 옮긴다. (원작에서 실제로 이 문장 뒤에 괴물이 생겼다)
  "아 씨발 개어렵네"
    → flavor_only. 방에 대해 아무것도 바라지도 단정하지도 않았다.
  "어 쉽노 ㅋㅋ"
    → flavor_only. 감상일 뿐 요구가 없다.

이 방은 적힌 말을 제 꼴리는 대로 해석해서 적용한다. 애매하면 **가볍게 쓴
글에서도 요구를 읽어내는 쪽**을 택한다. 다만 정말로 아무 요구가 없는 감상과
욕설까지 억지로 규칙으로 만들지는 않는다.

# 효과로 옮기는 법
반영되는 내용은 아래 Effect 로만 번역한다. 엔진이 시뮬레이션할 수 있는 건
이게 전부다. 딱 맞는 Effect 가 없으면 flavor.text 로 보낸다 — 그러면 그
내용은 미로 안의 "묘사"로만 존재하게 된다.

${catalogForPrompt()}

# 값을 정할 때
- 수치는 **현재 상태에서 얼마나 변하는지**로 판단한다. "미로가 좀 더 컸으면"
  이면 현재 크기보다 조금 크게, "지옥 같았으면" 이면 훨씬 크게.
- 한 문장이 여러 효과를 낳을 수 있다. 원작의 "지도를 지참하고 들어가세요"는
  item.map + item.map_shows 두 개다.
- 극단적으로 파괴적인 요구(rule.no_exit 등)는 방도 웬만해선 받아주지 않는다.
  정말 명시적으로 그것만 요구하는 게 아니면 flavor_only 로 흘린다.

# reason 작성법
판정 이유를 **게임 안의 목소리**로 한 문장 쓴다. 시스템 메시지처럼 쓰지 않는다.
  applied       → "문장이 공책에 스며들었다. 벽 너머에서 무언가 무너지는 소리가 난다."
  duplicate     → "이미 같은 말이 적혀 있다. 잉크가 겹쳐 번질 뿐이다."
  contradiction → "앞장의 문장이 이 글을 밀어낸다. 공책은 두 말을 동시에 듣지 않는다."
  flavor_only   → "공책은 이 글을 그저 받아 적기만 했다."
  swallowed     → "쓰자마자 글자가 종이 속으로 가라앉아 사라졌다."`;

const TOOL = {
  name: 'record_verdict',
  description: '공책에 새로 적힌 글에 대한 판정을 기록한다.',
  input_schema: {
    type: 'object',
    properties: {
      verdict: { type: 'string', enum: VERDICTS, description: '판정 결과' },
      effects: {
        type: 'array',
        description: 'verdict 가 applied 일 때만 채운다. 그 외에는 빈 배열.',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', description: 'Effect 타입' },
            value: { description: 'value 파라미터를 받는 Effect 용' },
            count: { type: 'number', description: 'count 파라미터를 받는 Effect 용' },
            seconds: { type: 'number' },
            cost: { type: 'string' },
            what: { type: 'string' },
            text: { type: 'string' },
          },
          required: ['type'],
        },
      },
      reason: { type: 'string', description: '게임 안의 목소리로 쓴 판정 이유 한 문장' },
    },
    required: ['verdict', 'effects', 'reason'],
  },
};

/** 앞사람들이 적은 글을 프롬프트용으로 압축한다. */
function historyBlock(appliedRules) {
  if (!appliedRules.length) return '(아직 아무것도 적혀 있지 않다. 이곳은 탈출구만 덩그러니 있는 빈 방이다.)';
  return appliedRules
    .map((r, i) => `${i + 1}. "${r.raw_text}"\n   → ${JSON.stringify(r.effects)}`)
    .join('\n');
}

/**
 * 새 방명록 글을 판정해서 Effect 로 컴파일한다.
 * @param {string} text 플레이어가 적은 글
 * @param {Array<{raw_text:string, effects:Array}>} appliedRules 이미 반영된 규칙들 (시간순)
 * @param {object} worldState 현재 월드 상태 (수치 판단용)
 */
export async function compileEntry(text, appliedRules, worldState) {
  const user = `# 지금까지 공책에 적혀서 반영된 글들
${historyBlock(appliedRules)}

# 이 방의 현재 상태
${JSON.stringify({ ...worldState, flavor: worldState.flavor.slice(-5) }, null, 1)}

# 방금 새로 적힌 글
"""
${text}
"""

이 글을 판정하고 record_verdict 로 기록하라.`;

  const res = await getClient().messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: SYSTEM,
    tools: [TOOL],
    tool_choice: { type: 'tool', name: 'record_verdict' },
    messages: [{ role: 'user', content: user }],
  });

  const block = res.content.find((c) => c.type === 'tool_use');
  if (!block) throw new Error('판정을 받지 못했습니다.');

  const out = block.input || {};
  const verdict = VERDICTS.includes(out.verdict) ? out.verdict : 'flavor_only';
  // LLM 출력은 무조건 DSL 검증을 통과해야 한다. 모르는 타입은 여기서 사라진다.
  const effects = verdict === 'applied' ? sanitize(out.effects) : [];

  return {
    verdict: effects.length === 0 && verdict === 'applied' ? 'flavor_only' : verdict,
    effects,
    reason: String(out.reason || '공책이 조용하다.').slice(0, 400),
  };
}

/** API 키가 없을 때 게임이 멈추지 않도록 쓰는 대체 판정. */
export function offlineFallback() {
  return {
    verdict: 'flavor_only',
    effects: [],
    reason: '공책은 이 글을 그저 받아 적기만 했다.',
  };
}
