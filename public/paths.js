// 칸 단위 길찾기. DOM 을 쓰지 않아 node 에서도 테스트할 수 있다.
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

/** to 쪽으로 가는 최단 경로의 첫 칸. to 칸에는 들어가지 않는다. 길이 없으면 null. */
export function nextStep(isFloor, from, to, blocked = () => false) {
  const key = (x, y) => `${x},${y}`;
  const prev = new Map([[key(from.x, from.y), null]]);
  const q = [from];
  for (let i = 0; i < q.length; i++) {
    const c = q[i];
    for (const [dx, dy] of DIRS) {
      const n = { x: c.x + dx, y: c.y + dy };
      const k = key(n.x, n.y);
      if (prev.has(k) || !isFloor(n.x, n.y)) continue;
      if (n.x === to.x && n.y === to.y) {
        if (c === from) return null;                  // 이미 붙어 있다
        let step = c;
        while (prev.get(key(step.x, step.y)) !== from) step = prev.get(key(step.x, step.y));
        return { x: step.x, y: step.y };
      }
      if (blocked(n.x, n.y)) continue;
      prev.set(k, c);
      q.push(n);
    }
  }
  return null;
}

/** 절반은 제자리, 나머지는 인접한 바닥 중 하나. */
export function wanderStep(isFloor, from, rng = Math.random) {
  if (rng() < 0.5) return { x: from.x, y: from.y };
  const opts = DIRS.map(([dx, dy]) => ({ x: from.x + dx, y: from.y + dy })).filter((c) => isFloor(c.x, c.y));
  if (!opts.length) return { x: from.x, y: from.y };
  return opts[Math.floor(rng() * opts.length)];
}
