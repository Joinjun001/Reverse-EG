// Ported from duplex.Sub (Rose & Camellia, Nigoro 2007).

export interface Point {
  x: number;
  y: number;
}

/** Does segment d (dx1,dy1)->(dx2,dy2) cross segment s (sx1,sy1)-(sx2,sy2)? Original: Sub.lineCrossPoint */
export function lineCrossPoint(
  sx1: number, sy1: number, sx2: number, sy2: number,
  dx1: number, dy1: number, dx2: number, dy2: number,
): boolean {
  const ddx = dx2 - dx1;
  const ddy = dy2 - dy1;
  let nx = -(sy2 - sy1);
  let ny = sx2 - sx1;
  let len = Math.sqrt(nx * nx + ny * ny);
  if (len > 0) len = 1 / len;
  nx *= len;
  ny *= len;
  const c = -(sx1 * nx + sy1 * ny);
  const t = -(nx * dx1 + ny * dy1 + c) / (nx * ddx + ny * ddy);
  const px = dx1 + ddx * t;
  const py = dy1 + ddy * t;
  // Intersection must lie strictly inside s and within (0, 1] along d
  const dot = (px - sx1) * (px - sx2) + (py - sy1) * (py - sy2);
  return dot < 0 && t > 0 && t <= 1;
}

export function pointLength(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return Math.sqrt(dx * dx + dy * dy);
}
