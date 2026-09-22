// ─────────────────────────────────────────────────────────────
// Effect DSL
//
// 방명록에 적힌 자유 텍스트는 LLM 을 거쳐 여기 정의된 Effect 로만 번역된다.
// 엔진이 모르는 소원은 flavor 로 떨어져서 "묘사"로만 존재한다.
// (원작의 "TV에 매드무비가 틀어져 있다" 같은 것들)
// ─────────────────────────────────────────────────────────────

/**
 * 각 항목: 엔진이 실제로 시뮬레이션하는 효과.
 *   apply(state, effect) 가 누적 월드 상태를 직접 수정한다.
 *   desc 는 LLM 프롬프트에 그대로 들어가는 설명이라 한국어로 적는다.
 */
export const EFFECTS = {
  'maze.size': {
    desc: '공간의 크기. 넓게·좁게는 이것. 5~41 사이의 홀수. 모양(방인지 미로인지)은 maze.layout 이 정한다.',
    params: { value: 'number' },
    apply: (s, e) => { s.mazeSize = clampOdd(e.value, 5, 41); },
  },
  'maze.layout': {
    desc: "공간의 모양. 'room' 은 내부 벽 없이 탁 트인 공간, 'maze' 는 미로. 넓히기만 바라면 room.",
    params: { value: 'string' },
    apply: (s, e) => {
      const v = String(e.value ?? '').toLowerCase();
      if (v === 'room' || v === 'maze') s.layout = v;
    },
  },
  'maze.traps': {
    desc: '미로에 설치되는 함정의 개수. 밟으면 큰 피해를 입는다. 0~40.',
    params: { count: 'number' },
    apply: (s, e) => { s.traps = clamp(e.count, 0, 40); },
  },
  'maze.shifting': {
    desc: '미로 구조가 플레이 도중에도 계속 변하는지 여부. 매우 어려워진다.',
    params: { value: 'boolean' },
    apply: (s, e) => { s.shifting = !!e.value; },
  },
  'entity.monster': {
    desc: '미로를 배회하는 괴물의 수. 0~20. 0 이면 괴물이 전혀 없다.',
    params: { count: 'number' },
    apply: (s, e) => { s.monsters = clamp(e.count, 0, 20); },
  },
  'entity.monster_speed': {
    desc: '괴물의 이동 속도 배율. 0.3~3.0. 1.0 이 기본.',
    params: { value: 'number' },
    apply: (s, e) => { s.monsterSpeed = clampF(e.value, 0.3, 3); },
  },
  'entity.monster_look': {
    desc: '괴물의 생김새. 적대적인 생물이 적히면 entity.monster 와 함께 낸다. 행동은 바뀌지 않고 모습만 바뀐다.',
    params: { name: 'string', tags: 'string', emoji: 'string' },
    apply: (s, e) => {
      const o = normalizeObject(e);
      if (o) s.monsterLook = { key: o.key, name: o.name, tags: o.tags, emoji: o.emoji };
    },
  },
  'entity.corpses': {
    desc: '바닥에 널린 시체의 수. 미끼로 던져 괴물의 주의를 끌 수 있다. 0~60.',
    params: { count: 'number' },
    apply: (s, e) => { s.corpses = clamp(e.count, 0, 60); },
  },
  'item.pistol': {
    desc: '입구에 권총이 놓인다. 괴물을 원거리에서 견제할 수 있다.',
    params: { value: 'boolean' },
    apply: (s, e) => { s.pistol = !!e.value; },
  },
  'item.knife': {
    desc: '입구에 칼이 놓인다. 근접 공격이 강해진다.',
    params: { value: 'boolean' },
    apply: (s, e) => { s.knife = !!e.value; },
  },
  'item.ammo': {
    desc: '주어지는 총알 수. 0~200.',
    params: { count: 'number' },
    apply: (s, e) => { s.ammo = clamp(e.count, 0, 200); },
  },
  'item.map': {
    desc: '미로의 전체 구조가 그려진 지도를 지참하고 들어간다. 미니맵이 전부 밝혀진다.',
    params: { value: 'boolean' },
    apply: (s, e) => { s.map = !!e.value; },
  },
  'item.map_shows': {
    desc: "지도에 추가로 표시되는 것. 'traps' 함정 위치, 'monsters' 괴물 위치.",
    params: { what: 'string' },
    apply: (s, e) => {
      if (e.what === 'traps') s.mapTraps = true;
      if (e.what === 'monsters') s.mapMonsters = true;
    },
  },
  'rule.no_pain': {
    desc: '이 안에서는 신체가 잘려도 아프지 않고 죽지도 않으며 곧 재생된다. 사실상 무적.',
    params: { value: 'boolean' },
    apply: (s, e) => { s.noPain = !!e.value; },
  },
  'rule.exit_cost': {
    desc: "출구를 열기 위해 치러야 하는 대가. 'none' 없음, 'random_body_part' 무작위 신체 부위를 두고 나가야 함.",
    params: { cost: 'string' },
    apply: (s, e) => { s.exitCost = e.cost === 'random_body_part' ? 'random_body_part' : 'none'; },
  },
  'rule.exit_cost_known': {
    desc: '출구가 요구하는 신체 부위가 무엇인지 미리 알 수 있는지 여부.',
    params: { value: 'boolean' },
    apply: (s, e) => { s.exitCostKnown = !!e.value; },
  },
  'rule.heal_on_exit': {
    desc: '출구 밖으로 나오면 이곳에서 잃은 모든 신체 부위가 완전하게 돌아온다.',
    params: { value: 'boolean' },
    apply: (s, e) => { s.healOnExit = !!e.value; },
  },
  'rule.no_exit': {
    desc: '출구가 사라진다. 아무도 나갈 수 없게 된다. 극단적인 효과라 거의 반영되지 않는다.',
    params: { value: 'boolean' },
    apply: (s, e) => { s.noExit = !!e.value; },
  },
  'object.spawn': {
    desc: '물건·생물·현상이 방 안에 말 그대로 나타난다. 엔진 규칙이 모르는 것은 전부 이것으로 옮긴다. '
      + '위의 Effect 로 옮겨지는 것(권총·칼·지도·시체·괴물)은 여기 쓰지 않는다. '
      + "name: 적힌 그대로의 짧은 한국어 이름. tags: 생김새를 설명하는 영어 단어 3~6개(쉼표). emoji: 가장 가까운 이모지 1개. count: 1~5. "
      + "where: 'anywhere' | 'entrance'(앞에·입구에) | 'exit'(출구에·문 앞에) | 'wall'(벽에·걸려·붙어). "
      + "use: 'none' | 'ranged'(쏘거나 던지는 도구) | 'melee'(휘두르는 도구). "
      + "moves: 'still' | 'wander'(돌아다닌다) | 'follow'(따라온다). "
      + 'desc: 가까이 가면 보이는 한 문장. 현상·규칙은 여기에 말 그대로 쓴다. '
      + "pose: 'stand' | 'lie'(바닥에 놓인·떨어진·깔린·누운).",
    params: { name: 'string', tags: 'string', emoji: 'string', count: 'number', where: 'string', use: 'string', moves: 'string', desc: 'string', pose: 'string' },
    apply: (s, e) => {
      const o = normalizeObject(e);
      if (!o) return;
      const i = s.objects.findIndex((x) => x.key === o.key);
      if (i >= 0) s.objects[i] = o;
      else if (s.objects.length < 30) s.objects.push(o);
    },
  },
  'surface.look': {
    desc: "벽·바닥·천장·문의 질감이 바뀌기를 바랄 때. surface: 'wall' | 'floor' | 'ceil' | 'door'. "
      + 'name: 짧은 한국어 이름. tags: 질감을 설명하는 영어 단어 3~6개. color: 그 질감의 대표색 #rrggbb.',
    params: { surface: 'string', name: 'string', tags: 'string', color: 'string' },
    apply: (s, e) => {
      const sf = normalizeSurface(e);
      if (!sf) return;
      const { surface, ...look } = sf;
      s.surfaces[surface] = look;
    },
  },
  'rule.when': {
    desc: '"~하면 ~된다" 형태의 소원. 조건(on)과 행동(do)의 조합. '
      + "on: 'act'(대상에 새 버튼, verb 는 버튼 동사) | 'enter'(대상 칸에 들어감) | 'near'(대상 1칸 안) | 'every'(n턴마다) "
      + "| 'see_monster' | 'pickup'(대상을 주움) | 'hurt'(체력 n 이하) | 'start'(들어오자마자) | 'door'(출구 앞) "
      + "| 'flicker'(형광등이 깜빡일 때. 주기를 '가끔·때때로'처럼 뭉뚱그린 소원은 전부 이것). "
      + 'target: 대상 물체 이름(act·enter·near·pickup 에 필수, 권총·칼·지도도 된다). chance: 0.05~1. once: 한 판에 한 번. '
      + "do: 최대 4개 — { act:'say', text } | { act:'hp', amount:-50~50 } | { act:'lose_part', effect } "
      + "| { act:'teleport', to:'random'|'start'|'exit' } | { act:'monster', do:'flee'|'stun'|'enrage'|'spawn', count:1~3 } "
      + "| { act:'dark', turns:1~5 } | { act:'give', item:'ammo'|'pistol'|'knife'|'map', count } "
      + "| { act:'object', do:'vanish'|'follow'|'wander'|'come' } | { act:'sound', kind:'scream'|'whisper'|'knock' } "
      + "| { act:'reveal', turns:1~10 } | { act:'scare' } | { act:'random' }(무엇이 일어날지 모름). "
      + '방 전체에 규칙은 20개까지.',
    params: { on: 'string', target: 'string', verb: 'string', n: 'number', chance: 'number', once: 'boolean', do: 'array' },
    apply: (s, e) => {
      const r = normalizeRule(e);
      if (r && s.rules.length < 20) s.rules.push(r);
    },
  },
  'rule.lock': {
    desc: '출구가 번호를 묻는다. 숫자는 1~9 만 쓴다. digits 는 자릿수로 기본 3, 범위 3~6. '
      + '"비밀번호가 더 길었으면" 같은 글이면 digits 를 올리고, "짧았으면" 이면 내린다. '
      + '번호는 미로 안 어딘가에 한 자리씩 흩어져 있고, 방명록이 바뀌어도 그대로다.',
    params: { digits: 'number' },
    apply: (s, e) => { s.lock = { digits: clamp(e.digits ?? 3, 3, 6) }; },
  },
  'lock.shuffle': {
    desc: '출구 번호를 다시 섞는다. 누군가 방명록에 번호를 적거나 "그 번호 아니다"라고 '
      + '부정했을 때만 쓴다. 방은 제 번호가 불리는 걸 싫어한다.',
    params: {},
    // 섞는 일은 글이 적히는 순간 서버가 한 번 한다 (src/app.js).
    // 여기서는 아무것도 하지 않는다 — 판을 만들 때마다 다시 섞이면 안 된다.
    apply: () => {},
  },
  'flavor.text': {
    desc: '장소도 대상도 없는 순수한 분위기. 입장할 때 한 줄로만 나온다. 물건·생물·현상은 여기 말고 object.spawn 으로.',
    params: { text: 'string' },
    apply: (s, e) => { if (e.text) s.flavor.push(String(e.text).slice(0, 300)); },
  },
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));
const clampF = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || lo));
const clampOdd = (v, lo, hi) => { const n = clamp(v, lo, hi); return n % 2 === 0 ? n + 1 : n; };

/** 같은 물건이면 같은 key. 대소문자·공백 차이는 무시한다. */
export function objectKey(name) {
  return String(name).trim().toLowerCase().replace(/\s+/g, ' ');
}

/** 영어 태그만 남긴다. 라이브러리 파일명과 이미지 생성 프롬프트가 영어라서. */
export function normalizeTags(tags) {
  const list = Array.isArray(tags) ? tags : String(tags ?? '').split(',');
  const out = [];
  for (const t of list) {
    const v = String(t).toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/\s+/g, ' ').trim();
    if (v && !out.includes(v)) out.push(v);
    if (out.length === 6) break;
  }
  return out;
}

const segmenter = new Intl.Segmenter();

const pick = (v, allowed) => {
  const s = String(v ?? '').trim().toLowerCase();
  return allowed.includes(s) ? s : allowed[0];
};

/** LLM 이 낸 object.spawn 을 엔진이 믿을 수 있는 모양으로. 이름이 없으면 null. 모르는 값은 기본값. */
export function normalizeObject(e) {
  const name = String(e?.name ?? '').trim().slice(0, 40);
  if (!name) return null;
  let tags = normalizeTags(e.tags);
  if (!tags.length) tags = normalizeTags(name);   // 이름이 영어면 그대로 태그가 된다
  const first = [...segmenter.segment(String(e.emoji ?? '').trim())][0]?.segment || '';
  const emoji = /\p{Extended_Pictographic}/u.test(first) ? first : '❔';
  const where = pick(e.where, ['anywhere', 'entrance', 'exit', 'wall']);
  const wall = where === 'wall';
  return {
    key: objectKey(name), name, tags, emoji, count: clamp(e.count ?? 1, 1, 5),
    where,
    use: wall ? 'none' : pick(e.use, ['none', 'ranged', 'melee']),
    moves: wall ? 'still' : pick(e.moves, ['still', 'wander', 'follow']),
    desc: String(e.desc ?? '').trim().slice(0, 120),
    pose: (wall || pick(e.moves, ['still', 'wander', 'follow']) !== 'still') ? 'stand' : pick(e.pose, ['stand', 'lie']),
  };
}

/** 표면 질감. 모르는 표면이면 null, 색 형식이 틀리면 색만 버린다. */
export function normalizeSurface(e) {
  const surface = String(e?.surface ?? '').trim().toLowerCase();
  if (!['wall', 'floor', 'ceil', 'door'].includes(surface)) return null;
  const name = String(e?.name ?? '').trim().slice(0, 40);
  if (!name) return null;
  const color = /^#[0-9a-f]{6}$/i.test(String(e.color ?? '').trim()) ? String(e.color).trim().toLowerCase() : null;
  let tags = normalizeTags(e.tags);
  if (!tags.length) tags = normalizeTags(name);
  return { surface, key: `tex:${surface}:${objectKey(name)}`, name, tags, color };
}

/** 최초의 방. 아무것도 없는 빈 공간에 탈출구만 덩그러니. */
export function initialState() {
  return {
    lock: null,                 // { digits } — 출구가 번호를 묻는다
    mazeSize: 5,
    traps: 0,
    shifting: false,
    monsters: 0,
    monsterSpeed: 1,
    corpses: 0,
    pistol: false,
    knife: false,
    ammo: 0,
    map: false,
    mapTraps: false,
    mapMonsters: false,
    noPain: false,
    exitCost: 'none',
    exitCostKnown: false,
    healOnExit: false,
    noExit: false,
    layout: null,
    monsterLook: null,
    surfaces: {},
    rules: [],
    objects: [],
    flavor: [],
  };
}

/** 모르는 타입·망가진 파라미터를 걸러낸다. LLM 출력은 항상 이걸 통과해야 한다. */
export function sanitize(effects) {
  if (!Array.isArray(effects)) return [];
  return effects.filter((e) => e && typeof e === 'object' && EFFECTS[e.type]).slice(0, 8);
}

/** 반영된 규칙들을 시간순으로 접어서 현재 월드 상태를 만든다. */
export function foldEffects(effectLists) {
  const s = initialState();
  for (const list of effectLists) {
    for (const e of sanitize(list)) {
      try { EFFECTS[e.type].apply(s, e); } catch { /* 망가진 규칙은 조용히 무시 */ }
    }
  }
  return s;
}

/** LLM 프롬프트에 넣을 DSL 카탈로그. */
export function catalogForPrompt() {
  return Object.entries(EFFECTS)
    .map(([type, d]) => {
      const params = Object.entries(d.params).map(([k, t]) => `${k}: ${t}`).join(', ');
      return `- ${type} { ${params} } — ${d.desc}`;
    })
    .join('\n');
}

const ONS = ['act', 'enter', 'near', 'every', 'see_monster', 'pickup', 'hurt', 'start', 'door', 'flicker'];
const NEEDS_TARGET = ['act', 'enter', 'near', 'pickup'];
const EFFECT_KEYS = ['deaf', 'noTrigger', 'noGrab', 'slow', 'blind'];
const oneOf = (v, allowed) => {
  const s = String(v ?? '').trim().toLowerCase();
  return allowed.includes(s) ? s : null;
};

/** 규칙의 행동 하나. 모르는 행동이면 null, 값은 범위로 자른다. */
export function normalizeAction(a) {
  switch (oneOf(a?.act, ['say', 'hp', 'lose_part', 'teleport', 'monster', 'dark', 'give', 'object', 'sound', 'reveal', 'scare', 'random'])) {
    case 'say': {
      if (typeof a.text !== 'string' && typeof a.text !== 'number') return null;
      const text = String(a.text).trim().slice(0, 120);
      return text ? { act: 'say', text } : null;
    }
    case 'hp': {
      const amount = Math.max(-50, Math.min(50, Math.round(Number(a.amount) || 0)));
      return amount ? { act: 'hp', amount } : null;
    }
    case 'lose_part': {
      const want = String(a.effect ?? '').trim().toLowerCase();
      return { act: 'lose_part', effect: EFFECT_KEYS.find((x) => x.toLowerCase() === want) || 'random' };
    }
    case 'teleport': return { act: 'teleport', to: pick(a.to, ['random', 'start', 'exit']) };
    case 'monster': {
      const d = pick(a.do, ['flee', 'stun', 'enrage', 'spawn']);
      return d === 'spawn' ? { act: 'monster', do: d, count: clamp(a.count ?? 1, 1, 3) } : { act: 'monster', do: d };
    }
    case 'dark': return { act: 'dark', turns: clamp(a.turns ?? 2, 1, 5) };
    case 'give': {
      const item = pick(a.item, ['ammo', 'pistol', 'knife', 'map']);
      return item === 'ammo' ? { act: 'give', item, count: clamp(a.count ?? 6, 1, 30) } : { act: 'give', item };
    }
    case 'object': return { act: 'object', do: pick(a.do, ['vanish', 'follow', 'wander', 'come']) };
    case 'sound': return { act: 'sound', kind: pick(a.kind, ['scream', 'whisper', 'knock']) };
    case 'reveal': return { act: 'reveal', turns: clamp(a.turns ?? 3, 1, 10) };
    // 어떤 식으로 놀래킬지는 엔진이 그때그때 고른다. 적은 사람도 무엇이 올지 모른다.
    case 'scare': return { act: 'scare' };
    // 무엇이 일어날지 아무도 모른다. 이스터에그처럼 눌러 보는 것에 쓴다.
    case 'random': return { act: 'random' };
    default: return null;
  }
}

/** "~하면 ~된다". 조건을 모르거나, 대상이 필요한데 없거나, 행동이 하나도 안 남으면 null. */
export function normalizeRule(e) {
  const on = oneOf(e?.on, ONS);
  if (!on) return null;
  const needs = NEEDS_TARGET.includes(on);
  const target = needs ? objectKey(e.target ?? '') : null;
  if (needs && !target) return null;
  const actions = (Array.isArray(e.do) ? e.do : []).map(normalizeAction).filter(Boolean).slice(0, 4);
  if (!actions.length) return null;
  return {
    on,
    target,
    verb: on === 'act' ? (String(e.verb ?? '').trim().slice(0, 20) || '만진다') : null,
    n: on === 'every' ? clamp(e.n ?? 5, 1, 50) : on === 'hurt' ? clamp(e.n ?? 30, 1, 99) : null,
    chance: Math.max(0.05, Math.min(1, Number(e.chance ?? 1) || 0)),
    once: e.once === true || String(e.once).toLowerCase() === 'true',
    do: actions,
  };
}
