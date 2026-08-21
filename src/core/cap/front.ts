import { add, cross, dot, length, normalize, scale, sub, vertexAt, type Vec3 } from '../geom.ts';
import { closesVisibleTear } from '../incidence.ts';
import type { CapContext, CapPatch } from './types.ts';
import { EMPTY_PATCH } from './types.ts';
import { capSingle } from './fan.ts';

const ANGLE_ONE = (75 * Math.PI) / 180;
const ANGLE_TWO = (135 * Math.PI) / 180;
const MAX_ITERS = 2500;
const MAX_NEW = 400;

/**
 * Zhao 2007 축소 전진 전면.
 *
 * 전면 정점의 내각을 재서 작은 귀부터 삼각형을 붙인다. 각이 크면 이등분선
 * 위에 Steiner 정점을 두고 전면을 전진한다. Liepa O(n³)이 버거운 중형 구멍과
 * 열린 사슬에 쓴다. 면이 둘인 에지를 만들 각은 건너뛰고, 더 이상 못 붙이면
 * 남은 전면을 부채꼴로 닫는다.
 */
export function capFront(ctx: CapContext): CapPatch {
  const loop = ctx.metrics.vertices;
  const n = loop.length;
  if (n < 3) return EMPTY_PATCH;
  if (n === 3) return capSingle(ctx);

  const newPositions: number[] = [];
  const triangles: number[] = [];
  let nextId = ctx.baseVertexCount;
  const front = loop.slice();
  const capN = ctx.metrics.capNormal;
  const bonus = new Map<string, number>();
  const failed = new Set<number>();

  const posOf = (id: number): Vec3 => {
    if (id >= ctx.baseVertexCount) {
      const o = (id - ctx.baseVertexCount) * 3;
      return [newPositions[o], newPositions[o + 1], newPositions[o + 2]];
    }
    return vertexAt(ctx.mesh.positions, id);
  };

  const pushNew = (p: Vec3): number => {
    newPositions.push(p[0], p[1], p[2]);
    return nextId++;
  };

  const edgeKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  const faceCount = (a: number, b: number) =>
    (ctx.edgeFaceCount?.(a, b) ?? 0) + (bonus.get(edgeKey(a, b)) ?? 0);

  const allowed = (a: number, b: number, c: number): boolean => {
    if (a === b || b === c || c === a) return false;
    if (ctx.strictManifold === true) {
      if (faceCount(a, b) >= 2 || faceCount(b, c) >= 2 || faceCount(c, a) >= 2) return false;
      return !ctx.wouldCreateNonManifold?.(a, b, c);
    }
    return closesVisibleTear(faceCount(a, b), faceCount(b, c), faceCount(c, a));
  };

  /** 루프 순서는 인접 면 방향이므로 뚜껑은 뒤집어서 감는다. */
  const addTri = (a: number, b: number, c: number): boolean => {
    if (!allowed(a, b, c)) return false;
    triangles.push(c, b, a);
    const bump = (u: number, v: number) => bonus.set(edgeKey(u, v), (bonus.get(edgeKey(u, v)) ?? 0) + 1);
    bump(a, b);
    bump(b, c);
    bump(c, a);
    return true;
  };

  const rebuildBonus = () => {
    bonus.clear();
    for (let i = 0; i < triangles.length; i += 3) {
      const a = triangles[i];
      const b = triangles[i + 1];
      const c = triangles[i + 2];
      const bump = (u: number, v: number) => bonus.set(edgeKey(u, v), (bonus.get(edgeKey(u, v)) ?? 0) + 1);
      bump(a, b);
      bump(b, c);
      bump(c, a);
    }
  };

  const interiorAngle = (i: number): number => {
    const m = front.length;
    const prev = posOf(front[(i - 1 + m) % m]);
    const curr = posOf(front[i]);
    const next = posOf(front[(i + 1) % m]);
    const u = normalize(sub(prev, curr));
    const w = normalize(sub(next, curr));
    const cr = cross(u, w);
    const sin = dot(cr, capN);
    const cos = Math.max(-1, Math.min(1, dot(u, w)));
    let angle = Math.atan2(sin, cos);
    if (angle < 0) angle += Math.PI * 2;
    return angle;
  };

  let guard = 0;
  while (front.length > 3 && guard++ < MAX_ITERS) {
    if (nextId - ctx.baseVertexCount >= MAX_NEW) break;

    let bestI = -1;
    let bestA = Infinity;
    for (let i = 0; i < front.length; i++) {
      if (failed.has(front[i])) continue;
      const a = interiorAngle(i);
      if (a < bestA) {
        bestA = a;
        bestI = i;
      }
    }
    if (bestI < 0) break;

    const m = front.length;
    const prev = front[(bestI - 1 + m) % m];
    const curr = front[bestI];
    const next = front[(bestI + 1) % m];
    const pPrev = posOf(prev);
    const pCurr = posOf(curr);
    const pNext = posOf(next);
    const len = 0.5 * (length(sub(pPrev, pCurr)) + length(sub(pNext, pCurr)));

    const triAt = triangles.length;
    const posAt = newPositions.length;
    const idAt = nextId;
    let advanced = false;

    if (bestA <= ANGLE_ONE + 1e-8) {
      if (addTri(prev, curr, next)) {
        front.splice(bestI, 1);
        advanced = true;
      }
    } else if (bestA <= ANGLE_TWO) {
      const vNew = pushNew(pointOnBisector(pPrev, pCurr, pNext, capN, len));
      if (addTri(prev, curr, vNew) && addTri(vNew, curr, next)) {
        front.splice(bestI, 1, vNew);
        advanced = true;
      }
    } else {
      const v1 = pushNew(pointOnAngle(pPrev, pCurr, pNext, capN, len, 1 / 3));
      const v2 = pushNew(pointOnAngle(pPrev, pCurr, pNext, capN, len, 2 / 3));
      if (addTri(prev, curr, v1) && addTri(v1, curr, v2) && addTri(v2, curr, next)) {
        front.splice(bestI, 1, v1, v2);
        advanced = true;
      }
    }

    if (!advanced) {
      triangles.length = triAt;
      newPositions.length = posAt;
      nextId = idAt;
      rebuildBonus();
      failed.add(curr);
      if (failed.size >= front.length) break;
    } else {
      failed.clear();
    }
  }

  if (front.length === 3) {
    addTri(front[0], front[1], front[2]);
  } else if (front.length > 3) {
    closeWithFan(front, posOf, addTri, pushNew);
  }

  if (triangles.length === 0) return EMPTY_PATCH;
  return { newPositions, triangles };
}

function pointOnBisector(prev: Vec3, curr: Vec3, next: Vec3, capN: Vec3, len: number): Vec3 {
  return pointOnAngle(prev, curr, next, capN, len, 0.5);
}

function pointOnAngle(prev: Vec3, curr: Vec3, next: Vec3, capN: Vec3, len: number, t: number): Vec3 {
  const u = normalize(sub(prev, curr));
  const w = normalize(sub(next, curr));
  let axis = cross(u, w);
  if (length(axis) < 1e-10) axis = capN;
  axis = normalize(axis);
  if (dot(axis, capN) < 0) axis = scale(axis, -1);

  const ang = Math.acos(Math.max(-1, Math.min(1, dot(u, w))));
  const dir = rotateAround(u, axis, ang * t);
  const step = len > 0 ? len : 1e-4;
  return add(curr, scale(dir, step));
}

function rotateAround(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const k = normalize(axis);
  const kv = cross(k, v);
  const d = dot(k, v);
  const omc = 1 - c;
  return [
    v[0] * c + kv[0] * s + k[0] * d * omc,
    v[1] * c + kv[1] * s + k[1] * d * omc,
    v[2] * c + kv[2] * s + k[2] * d * omc,
  ];
}

function closeWithFan(
  front: number[],
  posOf: (id: number) => Vec3,
  addTri: (a: number, b: number, c: number) => boolean,
  pushNew: (p: Vec3) => number,
): void {
  const pts = front.map(posOf);
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of pts) {
    x += p[0];
    y += p[1];
    z += p[2];
  }
  const inv = 1 / pts.length;
  const apex = pushNew([x * inv, y * inv, z * inv]);
  for (let i = 0; i < front.length; i++) {
    addTri(front[i], front[(i + 1) % front.length], apex);
  }
}
