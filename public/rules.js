// ─────────────────────────────────────────────────────────────
// 방명록 규칙: "~하면 ~된다"
//
// 서버가 정리해 내려준 규칙을 한 판 동안 돌린다. 이 모듈은 무엇을 할지만
// 정하고, 실제로 하는 것은 game.js 다. DOM 을 쓰지 않아 node 에서 테스트한다.
// ─────────────────────────────────────────────────────────────

const EDGE = { enter: 1, near: 1, see_monster: 1, hurt: 1, door: 1 };

export class RuleEngine {
  constructor(rules = [], rng = Math.random) {
    this.rules = rules;
    this.rng = rng;
    this.spent = new Set();     // once 로 써 버린 규칙
    this.was = new Map();       // 새로 참이 될 때를 알기 위한 지난 값 (every 는 마지막으로 발동한 turn)
  }

  roll(i) {
    const r = this.rules[i];
    if (!r || this.spent.has(i)) return [];
    if (r.once) this.spent.add(i);
    return this.rng() < r.chance ? r.do : [];
  }

  /** 지금 누를 수 있는 버튼. keys: 발밑·바로 앞에 있는 물체 key */
  buttons(keys) {
    return this.rules.map((rule, i) => ({ rule, i }))
      .filter(({ rule, i }) => rule.on === 'act' && keys.has(rule.target) && !this.spent.has(i));
  }

  act(i) { return this.rules[i]?.on === 'act' ? this.roll(i) : []; }

  pickup(key) {
    return this.rules.flatMap((r, i) => (r.on === 'pickup' && r.target === key ? this.roll(i) : []));
  }

  /** 상태를 보고 새로 참이 된 조건의 행동을 모은다. */
  update(s) {
    const out = [];
    this.rules.forEach((r, i) => {
      if (r.on === 'every') {
        if (s.turn > 0 && s.turn % r.n === 0 && this.was.get(i) !== s.turn) {
          this.was.set(i, s.turn);
          out.push(...this.roll(i));
        }
        return;
      }
      if (r.on === 'start') {
        if (!this.was.get(i)) { this.was.set(i, true); out.push(...this.roll(i)); }
        return;
      }
      if (!EDGE[r.on]) return;
      const now = r.on === 'enter' ? s.here.has(r.target)
        : r.on === 'near' ? s.near.has(r.target)
        : r.on === 'see_monster' ? !!s.seeMonster
        : r.on === 'hurt' ? s.hp <= r.n
        : !!s.atDoor;
      if (now && !this.was.get(i)) out.push(...this.roll(i));
      this.was.set(i, now);
    });
    return out;
  }
}
