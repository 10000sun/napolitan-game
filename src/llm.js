// ─────────────────────────────────────────────────────────────
// LLM 어댑터
//
// 판정을 맡길 곳은 언제든 갈아끼울 수 있어야 한다. 무료로 쓸 수 있는
// 곳은 자주 바뀌고, 이 게임이 부르는 건 "방명록에 글이 적힐 때" 한 번뿐이라
// 어디에 맡겨도 비용이 문제가 되지 않는다.
//
// 어느 제공자든 하는 일은 같다. 시스템 프롬프트와 사용자 글을 주고,
// JSON 객체 하나를 받아온다. 그 JSON 이 멀쩡한지는 effects.js 가 다시 본다.
// ─────────────────────────────────────────────────────────────

const PROVIDERS = {
  /* Google AI Studio — 무료 한도가 넉넉하다. aistudio.google.com/apikey */
  gemini: {
    envKey: 'GEMINI_API_KEY',
    defaultModel: 'gemini-2.0-flash',
    async call({ system, user, key, model }) {
      const base = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com';
      const res = await fetch(`${base}/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.4,
            maxOutputTokens: 2048,
          },
        }),
      });
      if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const data = await res.json();
      const parts = data?.candidates?.[0]?.content?.parts;
      if (!Array.isArray(parts)) throw new Error('gemini: 응답에 본문이 없습니다.');
      return parts.map((p) => p.text || '').join('');
    },
  },

  /* OpenAI 호환 엔드포인트 — Groq, OpenRouter, Ollama, DeepSeek 등이 전부 여기 붙는다. */
  openai: {
    envKey: 'OPENAI_API_KEY',
    defaultModel: 'llama-3.3-70b-versatile',
    keyOptional: true,                       // Ollama 처럼 키가 없는 곳도 있다
    async call({ system, user, key, model }) {
      const base = (process.env.OPENAI_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/$/, '');
      const body = {
        model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        temperature: 0.4,
        max_tokens: 2048,
      };
      const jsonMode = process.env.OPENAI_JSON_MODE !== '0';
      if (jsonMode) body.response_format = { type: 'json_object' };

      const send = (b) => fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(key ? { Authorization: `Bearer ${key}` } : {}),
        },
        body: JSON.stringify(b),
      });

      let res = await send(body);
      // response_format 을 모르는 엔드포인트가 아직 많다. 한 번만 빼고 다시 던진다.
      if (!res.ok && res.status === 400 && jsonMode) {
        const { response_format, ...rest } = body;
        res = await send(rest);
      }
      if (!res.ok) throw new Error(`openai ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content;
      if (typeof text !== 'string') throw new Error('openai: 응답에 본문이 없습니다.');
      return text;
    },
  },

  anthropic: {
    envKey: 'ANTHROPIC_API_KEY',
    defaultModel: 'claude-sonnet-5',
    async call({ system, user, key, model }) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 2048,
          system,
          messages: [{ role: 'user', content: user }],
        }),
      });
      if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const data = await res.json();
      return (data?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
    },
  },
};

/** 무엇을 쓸지 정한다. LLM_PROVIDER 가 없으면 채워진 키를 보고 고른다. */
export function resolveProvider() {
  const named = (process.env.LLM_PROVIDER || '').trim().toLowerCase();
  if (named) {
    if (!PROVIDERS[named]) throw new Error(`LLM_PROVIDER 를 알 수 없습니다: ${named}`);
    return { name: named, ...PROVIDERS[named] };
  }
  for (const name of ['gemini', 'openai', 'anthropic']) {
    if (process.env[PROVIDERS[name].envKey]) return { name, ...PROVIDERS[name] };
  }
  return null;
}

/** 판정을 맡길 곳이 준비돼 있는가. */
export function isConfigured() {
  const p = resolveProvider();
  if (!p) return false;
  return !!process.env[p.envKey] || !!p.keyOptional;
}

export function describeProvider() {
  const p = resolveProvider();
  if (!p) return '없음';
  return `${p.name} (${modelFor(p)})`;
}

function modelFor(p) {
  const perProvider = {
    gemini: process.env.GEMINI_MODEL,
    openai: process.env.OPENAI_MODEL,
    anthropic: process.env.ANTHROPIC_MODEL,
  };
  return perProvider[p.name] || p.defaultModel;
}

/** 모델이 코드블록으로 감싸거나 앞뒤에 말을 붙여도 JSON 만 건져낸다. */
function extractJson(text) {
  let t = String(text || '').trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('응답에서 JSON 을 찾지 못했습니다.');
  return JSON.parse(t.slice(a, b + 1));
}

/**
 * 판정을 받아온다.
 * @returns {Promise<object>} 모델이 뱉은 JSON 객체 (검증 전)
 */
export async function judge({ system, user }) {
  const p = resolveProvider();
  if (!p) throw new Error('LLM 제공자가 설정되지 않았습니다.');
  const key = process.env[p.envKey];
  if (!key && !p.keyOptional) throw new Error(`${p.envKey} 가 설정되지 않았습니다.`);

  const text = await p.call({ system, user, key, model: modelFor(p) });
  return extractJson(text);
}
