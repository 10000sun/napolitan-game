// ─────────────────────────────────────────────────────────────
// 조우
//
// 괴물은 덩치가 크다. 성인 남자가 맞붙어도 열에 일곱은 진다.
// 그래서 정답은 대개 피하는 쪽이다. 권총만은 예외다
// ("권총 쓴 새끼 천사인가 진짜 고맙다 덕분에 살았다").
// 확률과 문구는 설계 문서 §12·§15 의 표가 기준이다.
// ─────────────────────────────────────────────────────────────

export const COMBAT = {
  pistol: 0.8, weapon: 0.5, bare: 0.3,
  counterDamage: 25, counterPartChance: 0.3,
  dodge: 0.65, dodgeSlow: 0.35, dodgeFailDamage: 15,
};

export const SPECIAL = {
  monster: [
    { id: 'backstep', label: '뒷걸음질 친다', needs: ['!slow'],
      outcomes: [[0.6, { text: '한 걸음 물러났다. 그것의 손끝이 코앞을 스친다.', move: 'back' }],
                 [0.4, { text: '발이 걸려 넘어졌다.', damage: 15, next: 'grabbed_ankle' }]] },
    { id: 'roll', label: '옆으로 굴러서 피한다', needs: ['!slow'],
      outcomes: [[0.7, { text: '옆으로 굴렀다. 그것이 허공을 할퀸다.', move: 'side' }],
                 [0.3, { text: '구르다 벽에 부딪혔다. 그것이 팔을 물었다.', losePart: 'noGrab' }]] },
    { id: 'freeze', label: '숨을 죽이고 가만히 있는다', needs: [],
      outcomes: [[0.5, { text: '그것이 고개를 갸웃하더니 등을 돌린다.', monster: 'flee' }],
                 [0.5, { text: '그것이 얼굴을 바싹 들이댄다.', next: 'face_to_face' }]] },
    { id: 'scream', label: '소리를 질러 위협한다', needs: [],
      outcomes: [[0.4, { text: '그것이 움찔하며 어둠 속으로 물러난다.', monster: 'flee' }],
                 [0.6, { text: '그것이 더 크게 비명을 질렀다.', monster: 'enrage', damage: 20 }]] },
    { id: 'shield', label: '시체를 방패처럼 들이민다', needs: ['corpse'],
      outcomes: [[0.8, { text: '그것이 시체를 물고 늘어진다.', monster: 'stun', useCorpse: true }],
                 [0.2, { text: '시체째로 밀려 넘어졌다.', damage: 20 }]] },
  ],
  trap: [
    { id: 'wallkick', label: '벽을 박차고 뛰어넘는다', needs: ['!slow'],
      outcomes: [[0.7, { text: '벽을 차고 날아올라 틈 너머에 착지했다.', move: 'over' }],
                 [0.3, { text: '발이 미끄러졌다.', trap: 'spring' }]] },
    { id: 'crawl', label: '엎드려 기어서 지나간다', needs: [],
      outcomes: [[0.9, { text: '배를 바닥에 붙이고 틈 가장자리를 지났다.', move: 'over', turns: 2 }],
                 [0.1, { text: '손을 짚은 곳이 꺼졌다.', trap: 'spring' }]] },
    { id: 'throw', label: '시체를 던져 함정을 작동시킨다', needs: ['corpse'],
      outcomes: [[1.0, { text: '시체가 틈에 삼켜졌다. 바닥이 닫힌다.', trap: 'disarm', useCorpse: true }]] },
    { id: 'probe', label: '손으로 더듬어 틈을 살핀다', needs: ['!noGrab'],
      outcomes: [[0.6, { text: '틈의 모양을 알아냈다. 이제 밟지 않을 수 있다.', trap: 'disarm' }],
                 [0.4, { text: '틈이 손을 물었다.', losePart: 'noGrab' }]] },
  ],
};

// 후속 이벤트. 이 동안은 일반 선택지가 사라지고 이벤트 선택지만 보인다.
export const EVENTS = {
  grabbed_ankle: { text: '차가운 손이 발목을 붙잡았다.', choices: [
    { label: '다른 발로 걷어찬다', needs: [],
      outcomes: [[0.5, { text: '손아귀가 풀렸다.', monster: 'stun' }], [0.5, { text: '발목이 꺾였다.', losePart: 'slow' }]] },
    { label: '무기로 내려친다', needs: ['weapon'],
      outcomes: [[0.8, { text: '손목이 잘려 나가며 발목이 풀렸다.', monster: 'stun' }], [0.2, { text: '빗나갔다.', losePart: 'slow' }]] },
    { label: '발목을 포기한다', needs: [],
      outcomes: [[1.0, { text: '발목을 두고 기어서 빠져나왔다.', losePart: 'slow', move: 'back' }]] },
  ] },
  face_to_face: { text: '숨결이 닿는다. 그것의 눈이 당신의 눈을 들여다본다.', choices: [
    { label: '눈을 감는다', needs: [],
      outcomes: [[0.6, { text: '한참 뒤, 기척이 사라졌다.', monster: 'flee' }], [0.4, { text: '눈꺼풀 위로 무언가 파고들었다.', losePart: 'blind' }]] },
    { label: '마주 본다', needs: [],
      outcomes: [[0.3, { text: '그것이 먼저 눈을 돌렸다.', monster: 'flee' }], [0.7, { text: '그것이 웃었다.', damage: 30 }]] },
  ] },
};

export function resolve(outcomes, rng = Math.random) {
  const r = rng();
  let acc = 0;
  for (const [p, result] of outcomes) {
    acc += p;
    if (r < acc) return result;
  }
  return outcomes[outcomes.length - 1][1];
}

export function available(list, ctx) {
  return list.filter((s) => (s.needs || []).every((n) => {
    if (n.startsWith('!')) return !ctx.effects.has(n.slice(1));
    return !!ctx[n];
  }));
}

export function pickSpecial(kind, ctx, rng = Math.random) {
  const list = available(SPECIAL[kind], ctx);
  return list.length ? list[Math.floor(rng() * list.length)] : null;
}

export function attackChance(weapon, melee, effects) {
  let p = COMBAT[weapon] ?? COMBAT.bare;
  if (melee && effects.has('noGrab')) p *= 0.5;
  if (effects.has('blind')) p *= 0.5;
  return p;
}

export const dodgeChance = (effects) => (effects.has('slow') ? COMBAT.dodgeSlow : COMBAT.dodge);
export const monsterSteps = (speed = 1) => Math.max(1, Math.round(2 * speed));

/** 이번 선택이 쓰는 턴 수. 다리가 없으면 칸을 옮기는 모든 행동이 세 턴이다. */
export const turnCost = ({ moved, slow, pending = 1 }) => Math.max(pending || 1, moved && slow ? 3 : 1);

/** 공격이 먹혔는가. 확률은 attackChance, 굴림은 rng (테스트에서 주입). */
export const rollAttack = (weapon, melee, effects, rng = Math.random) => rng() < attackChance(weapon, melee, effects);
