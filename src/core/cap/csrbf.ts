import { cross, dot, length, normalize, sub, vertexAt, type Vec3 } from '../geom.ts';
import type { CapContext, CapPatch } from './types.ts';
import { clampPatchSteiners } from './refine.ts';

const MAX_SAMPLES = 48;
const OFFSET_RATIO = 0.4;
const NEWTON_ITERS = 6;

/**
 * 구멍 주변 2-링에 로컬 다조화 RBF를 맞추고 Steiner 정점을 f=0 면으로 투영한다.
 *
 * Carr et al. 2001과 Branch et al. 2006의 로컬 피팅을 브라우저용으로 줄였다.
 * 전역 RBF는 쓰지 않는다. 샘플이 너무 적거나 법선이 뒤집혀 있으면 건너뛴다.
 */
export function projectCsrbf(ctx: CapContext, patch: CapPatch): CapPatch {
  if (patch.newPositions.length < 12 || patch.triangles.length < 9) return patch;

  const samples = collectRingSamples(ctx);
  if (samples.length < 8) return patch;

  const fit = fitRbf(samples);
  if (!fit) return patch;

  const newPositions = patch.newPositions.slice();
  for (let i = 0; i < newPositions.length; i += 3) {
    let p: Vec3 = [newPositions[i], newPositions[i + 1], newPositions[i + 2]];
    p = projectToZero(p, fit);
    newPositions[i] = p[0];
    newPositions[i + 1] = p[1];
    newPositions[i + 2] = p[2];
  }

  return clampPatchSteiners(ctx, { newPositions, triangles: patch.triangles });
}

interface Sample {
  point: Vec3;
  value: number;
}

interface RbfFit {
  centers: Vec3[];
  weights: Float64Array;
}

function collectRingSamples(ctx: CapContext): Sample[] {
  const ring = new Set(ctx.metrics.vertices);
  const { indices, positions } = ctx.mesh;

  for (let pass = 0; pass < 2; pass++) {
    const seed = [...ring];
    const seedSet = new Set(seed);
    for (let t = 0; t < indices.length; t += 3) {
      const a = indices[t];
      const b = indices[t + 1];
      const c = indices[t + 2];
      if (!seedSet.has(a) && !seedSet.has(b) && !seedSet.has(c)) continue;
      ring.add(a);
      ring.add(b);
      ring.add(c);
    }
  }

  const normals = new Map<number, Vec3>();
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t];
    const b = indices[t + 1];
    const c = indices[t + 2];
    if (!ring.has(a) && !ring.has(b) && !ring.has(c)) continue;
    const n = normalize(
      cross(
        sub(vertexAt(positions, b), vertexAt(positions, a)),
        sub(vertexAt(positions, c), vertexAt(positions, a)),
      ),
    );
    for (const v of [a, b, c]) {
      if (!ring.has(v)) continue;
      const prev = normals.get(v) ?? [0, 0, 0];
      normals.set(v, [prev[0] + n[0], prev[1] + n[1], prev[2] + n[2]]);
    }
  }

  const surface: { vertex: number; point: Vec3; normal: Vec3 }[] = [];
  for (const v of ring) {
    const nrm = normals.get(v);
    if (!nrm) continue;
    const n = normalize(nrm);
    if (length(n) < 1e-8) continue;
    surface.push({ vertex: v, point: vertexAt(positions, v), normal: n });
  }

  if (surface.length > MAX_SAMPLES) {
    const step = surface.length / MAX_SAMPLES;
    const picked: typeof surface = [];
    for (let i = 0; i < MAX_SAMPLES; i++) picked.push(surface[Math.floor(i * step)]);
    surface.length = 0;
    surface.push(...picked);
  }

  let meanEdge = 0;
  const loopVerts = ctx.metrics.vertices;
  for (let i = 0; i < loopVerts.length; i++) {
    meanEdge += length(
      sub(vertexAt(positions, loopVerts[i]), vertexAt(positions, loopVerts[(i + 1) % loopVerts.length])),
    );
  }
  meanEdge /= Math.max(1, loopVerts.length);
  const eps = meanEdge * OFFSET_RATIO;
  if (eps <= 0) return [];

  const samples: Sample[] = [];
  for (const s of surface) {
    samples.push({ point: s.point, value: 0 });
    samples.push({
      point: [s.point[0] + s.normal[0] * eps, s.point[1] + s.normal[1] * eps, s.point[2] + s.normal[2] * eps],
      value: eps,
    });
  }

  return samples;
}

function phi(r: number): number {
  return r * r * r;
}

function fitRbf(samples: Sample[]): RbfFit | null {
  const n = samples.length;
  const A = new Float64Array(n * n);
  const b = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    b[i] = samples[i].value;
    for (let j = 0; j < n; j++) {
      A[i * n + j] = phi(length(sub(samples[i].point, samples[j].point)));
    }
    A[i * n + i] += 1e-8;
  }
  const weights = solveDense(A, n, b);
  if (!weights) return null;
  return { centers: samples.map((s) => s.point), weights };
}

function evalRbf(p: Vec3, fit: RbfFit): { f: number; g: Vec3 } {
  let f = 0;
  const g: Vec3 = [0, 0, 0];
  for (let i = 0; i < fit.centers.length; i++) {
    const d = sub(p, fit.centers[i]);
    const r = length(d);
    const w = fit.weights[i];
    f += w * phi(r);
    if (r > 1e-12) {
      // d/dr r^3 = 3 r^2, ∇r = d/r → ∇φ = 3 r d
      const s = w * 3 * r;
      g[0] += s * d[0];
      g[1] += s * d[1];
      g[2] += s * d[2];
    }
  }
  return { f, g };
}

function projectToZero(p: Vec3, fit: RbfFit): Vec3 {
  let x: Vec3 = [p[0], p[1], p[2]];
  for (let i = 0; i < NEWTON_ITERS; i++) {
    const { f, g } = evalRbf(x, fit);
    const g2 = dot(g, g);
    if (g2 < 1e-16) break;
    const t = f / g2;
    x = [x[0] - t * g[0], x[1] - t * g[1], x[2] - t * g[2]];
  }
  return x;
}

function solveDense(A: Float64Array, n: number, b: Float64Array): Float64Array | null {
  const M = A.slice();
  const x = b.slice();
  const col = (r: number, c: number) => r * n + c;

  for (let k = 0; k < n; k++) {
    let pivot = k;
    let best = Math.abs(M[col(k, k)]);
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(M[col(i, k)]);
      if (v > best) {
        best = v;
        pivot = i;
      }
    }
    if (best < 1e-14) return null;
    if (pivot !== k) {
      for (let c = k; c < n; c++) {
        const tmp = M[col(k, c)];
        M[col(k, c)] = M[col(pivot, c)];
        M[col(pivot, c)] = tmp;
      }
      const tb = x[k];
      x[k] = x[pivot];
      x[pivot] = tb;
    }
    const akk = M[col(k, k)];
    for (let i = k + 1; i < n; i++) {
      const f = M[col(i, k)] / akk;
      x[i] -= f * x[k];
      for (let c = k; c < n; c++) M[col(i, c)] -= f * M[col(k, c)];
    }
  }

  for (let i = n - 1; i >= 0; i--) {
    let sum = x[i];
    for (let c = i + 1; c < n; c++) sum -= M[col(i, c)] * x[c];
    const diag = M[col(i, i)];
    if (Math.abs(diag) < 1e-14) return null;
    x[i] = sum / diag;
  }
  return x;
}

/** 정점 8개 이상이고 조금 휘어진 구멍에 쓴다. 바닥 받침은 제외. */
export function shouldProjectCsrbf(ctx: CapContext): boolean {
  return (
    ctx.metrics.strategy !== 'flatBase' &&
    ctx.metrics.vertices.length >= 8 &&
    ctx.metrics.planarity >= 0.04
  );
}
