export type Vec3 = [number, number, number];

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function length(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export function normalize(a: Vec3): Vec3 {
  const len = length(a);
  if (len === 0) return [0, 0, 0];
  return [a[0] / len, a[1] / len, a[2] / len];
}

export function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

/** positions 배열에서 정점 i를 읽는다. */
export function vertexAt(positions: Float32Array | number[], i: number): Vec3 {
  const o = i * 3;
  return [positions[o], positions[o + 1], positions[o + 2]];
}

/** 정규화하지 않은 삼각형 법선. 길이가 넓이의 두 배다. */
export function triangleNormalRaw(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  return cross(sub(b, a), sub(c, a));
}

export function triangleArea(a: Vec3, b: Vec3, c: Vec3): number {
  return length(triangleNormalRaw(a, b, c)) / 2;
}

/**
 * Newell 방법으로 3D 다각형의 면적 가중 법선을 구한다.
 *
 * 세 점만 쓰는 방식과 달리 평면에서 벗어난 다각형에서도 안정적이고,
 * 결과 벡터의 길이가 투영 면적의 두 배라서 면적을 따로 계산할 필요가 없다.
 */
export function newellNormal(points: Vec3[]): Vec3 {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  const n = points.length;

  for (let i = 0; i < n; i++) {
    const p = points[i];
    const q = points[(i + 1) % n];
    nx += (p[1] - q[1]) * (p[2] + q[2]);
    ny += (p[2] - q[2]) * (p[0] + q[0]);
    nz += (p[0] - q[0]) * (p[1] + q[1]);
  }

  return [nx, ny, nz];
}

export function centroidOf(points: Vec3[]): Vec3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of points) {
    x += p[0];
    y += p[1];
    z += p[2];
  }
  const n = points.length || 1;
  return [x / n, y / n, z / n];
}

export interface PlaneBasis {
  origin: Vec3;
  normal: Vec3;
  u: Vec3;
  v: Vec3;
}

/** 주어진 법선에 수직인 정규직교 기저를 만든다. */
export function planeBasis(origin: Vec3, normal: Vec3): PlaneBasis {
  const n = normalize(normal);
  // 법선과 가장 덜 나란한 축을 골라야 외적이 0에 가까워지지 않는다.
  const ax = Math.abs(n[0]);
  const ay = Math.abs(n[1]);
  const az = Math.abs(n[2]);
  const helper: Vec3 = ax < ay && ax < az ? [1, 0, 0] : ay < az ? [0, 1, 0] : [0, 0, 1];

  const u = normalize(cross(n, helper));
  const v = cross(n, u);
  return { origin, normal: n, u, v };
}

export function projectToPlane(basis: PlaneBasis, p: Vec3): [number, number] {
  const d = sub(p, basis.origin);
  return [dot(d, basis.u), dot(d, basis.v)];
}

/** 두 삼각형 법선 사이의 이면각(라디안). 마주 볼수록 0에 가깝다. */
export function dihedralAngle(n1: Vec3, n2: Vec3): number {
  const a = normalize(n1);
  const b = normalize(n2);
  const d = Math.max(-1, Math.min(1, dot(a, b)));
  return Math.acos(d);
}
