// 레이캐스터의 작은 기하. DOM 없이 테스트한다.

/** 광선이 닿은 벽면이 바라보는 방향(벽 → 바닥). 0 동 1 남 2 서 3 북 */
export function faceOf(side, stepX, stepY) {
  if (side === 0) return stepX > 0 ? 2 : 0;
  return stepY > 0 ? 3 : 1;
}

/** 광선 P + t·R (t > 0) 과 선분 A→B 의 교점. 없으면 null. */
export function raySegment(px, py, rdx, rdy, ax, ay, bx, by) {
  const ex = bx - ax, ey = by - ay;
  const den = rdx * ey - rdy * ex;
  if (Math.abs(den) < 1e-12) return null;
  const qx = ax - px, qy = ay - py;
  const t = (qx * ey - qy * ex) / den;
  const s = (qx * rdy - qy * rdx) / den;
  if (t <= 0 || s < 0 || s > 1) return null;
  return { t, s };
}
