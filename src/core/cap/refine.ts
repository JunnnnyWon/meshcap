import { centroidOf, cross, dot, length, normalize, planeBasis, projectToPlane, sub, triangleNormalRaw, vertexAt, type Vec3 } from '../geom.ts';
import type { CapContext, CapPatch } from './types.ts';

const ALPHA = 2;
const MAX_STEINER = 400;
const MAX_REFINE_ITERS = 6;
const MAX_SWAP_PASSES = 8;
const FAIR_ITERS = 24;

/**
 * Liepa 2003의 나머지 절반. 거친 삼각화 위에 Steiner 정점을 넣어 주변 밀도를
 * 맞추고, 내부 정점을 코탄젠트 라플라시안으로 풀어 드럼 가죽처럼 납작한 뚜껑을
 * 곡면에 붙인다. 전진 전면이 이미 넣은 Steiner도 같은 페어링을 탄다.
 */
export function refineAndFair(ctx: CapContext, patch: CapPatch): CapPatch {
  const loop = ctx.metrics.vertices;
  const n = loop.length;
  if (n < 4 || patch.triangles.length < 9) return patch;

  const positions: Vec3[] = loop.map((v) => vertexAt(ctx.mesh.positions, v));
  const sigma: number[] = loop.map((v) => {
    const s = ctx.vertexMeanEdge?.[v] ?? 0;
    return s > 0 ? s : ctx.metrics.perimeter / n;
  });

  const localOf = new Map<number, number>();
  for (let i = 0; i < n; i++) localOf.set(loop[i], i);

  const extra = patch.newPositions.length / 3;
  for (let i = 0; i < extra; i++) {
    localOf.set(ctx.baseVertexCount + i, n + i);
    positions.push([
      patch.newPositions[i * 3],
      patch.newPositions[i * 3 + 1],
      patch.newPositions[i * 3 + 2],
    ]);
    sigma.push(ctx.metrics.perimeter / n);
  }

  const triangles: number[] = [];
  for (let i = 0; i < patch.triangles.length; i += 3) {
    const a = localOf.get(patch.triangles[i]);
    const b = localOf.get(patch.triangles[i + 1]);
    const c = localOf.get(patch.triangles[i + 2]);
    if (a === undefined || b === undefined || c === undefined) return patch;
    triangles.push(a, b, c);
  }

  const boundaryCount = n;
  refine(positions, triangles, sigma, boundaryCount);

  const bbox = holeBounds(positions, n);
  const ring = collectRingFaces(ctx);
  fair(positions, triangles, n, bbox);
  for (let i = n; i < positions.length; i++) {
    positions[i] = clampToSurface(positions[i], ring, bbox);
  }

  const newPositions: number[] = [];
  for (let i = n; i < positions.length; i++) {
    const p = positions[i];
    newPositions.push(p[0], p[1], p[2]);
  }

  const base = ctx.baseVertexCount;
  const out: number[] = [];
  for (let i = 0; i < triangles.length; i += 3) {
    const map = (local: number) => (local < n ? loop[local] : base + (local - n));
    out.push(map(triangles[i]), map(triangles[i + 1]), map(triangles[i + 2]));
  }

  return { newPositions, triangles: out };
}

function refine(positions: Vec3[], triangles: number[], sigma: number[], boundaryCount: number): void {
  const meanSigma = sigma.reduce((s, v) => s + v, 0) / Math.max(1, sigma.length);

  for (let iter = 0; iter < MAX_REFINE_ITERS; iter++) {
    if (positions.length - boundaryCount >= MAX_STEINER) break;

    const splits: number[] = [];
    for (let t = 0; t < triangles.length; t += 3) {
      const a = triangles[t];
      const b = triangles[t + 1];
      const c = triangles[t + 2];
      const pa = positions[a];
      const pb = positions[b];
      const pc = positions[c];
      const bary = centroidOf([pa, pb, pc]);
      const sa = sigma[a] || meanSigma;
      const sb = sigma[b] || meanSigma;
      const sc = sigma[c] || meanSigma;
      const limit = ALPHA * ((sa + sb + sc) / 3);
      if (
        length(sub(bary, pa)) > limit ||
        length(sub(bary, pb)) > limit ||
        length(sub(bary, pc)) > limit
      ) {
        splits.push(t);
      }
    }

    if (splits.length === 0) break;

    const remove = new Set(splits);
    const next: number[] = [];
    for (let t = 0; t < triangles.length; t += 3) {
      if (!remove.has(t)) {
        next.push(triangles[t], triangles[t + 1], triangles[t + 2]);
        continue;
      }
      if (positions.length - boundaryCount >= MAX_STEINER) {
        next.push(triangles[t], triangles[t + 1], triangles[t + 2]);
        continue;
      }
      const a = triangles[t];
      const b = triangles[t + 1];
      const c = triangles[t + 2];
      const bary = centroidOf([positions[a], positions[b], positions[c]]);
      const id = positions.length;
      positions.push(bary);
      sigma.push(((sigma[a] || meanSigma) + (sigma[b] || meanSigma) + (sigma[c] || meanSigma)) / 3);
      next.push(a, b, id, b, c, id, c, a, id);
    }

    triangles.length = 0;
    triangles.push(...next);
    swapDelaunay(positions, triangles, boundaryCount);
  }
}

function swapDelaunay(positions: Vec3[], triangles: number[], boundaryCount: number): void {
  const origin = positions[0];
  const normal = estimateNormal(positions, triangles);
  const basis = planeBasis(origin, normal);

  for (let pass = 0; pass < MAX_SWAP_PASSES; pass++) {
    const opp = oppositeMap(triangles);
    let swapped = false;

    for (let t = 0; t < triangles.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const a = triangles[t + e];
        const b = triangles[t + ((e + 1) % 3)];
        const c = triangles[t + ((e + 2) % 3)];
        if (isBoundaryEdge(a, b, boundaryCount)) continue;
        const other = opp.get(edgeKey(b, a));
        if (other === undefined) continue;
        const d = other.apex;
        if (d === c) continue;

        const pa = projectToPlane(basis, positions[a]);
        const pb = projectToPlane(basis, positions[b]);
        const pc = projectToPlane(basis, positions[c]);
        const pd = projectToPlane(basis, positions[d]);
        if (!inCircle(pa, pb, pc, pd)) continue;

        triangles[t] = a;
        triangles[t + 1] = d;
        triangles[t + 2] = c;
        triangles[other.tri] = a;
        triangles[other.tri + 1] = b;
        triangles[other.tri + 2] = d;
        swapped = true;
        // 한 패스에서 같은 면을 두 번 건드리지 않는다.
        e = 3;
      }
    }
    if (!swapped) break;
  }
}

function oppositeMap(triangles: number[]): Map<number, { apex: number; tri: number }> {
  const map = new Map<number, { apex: number; tri: number }>();
  for (let t = 0; t < triangles.length; t += 3) {
    const a = triangles[t];
    const b = triangles[t + 1];
    const c = triangles[t + 2];
    map.set(edgeKey(a, b), { apex: c, tri: t });
    map.set(edgeKey(b, c), { apex: a, tri: t });
    map.set(edgeKey(c, a), { apex: b, tri: t });
  }
  return map;
}

function edgeKey(a: number, b: number): number {
  return a * 1048576 + b;
}

function isBoundaryEdge(a: number, b: number, boundaryCount: number): boolean {
  if (a >= boundaryCount || b >= boundaryCount) return false;
  return Math.abs(a - b) === 1 || (a === 0 && b === boundaryCount - 1) || (b === 0 && a === boundaryCount - 1);
}

function inCircle(a: [number, number], b: [number, number], c: [number, number], d: [number, number]): boolean {
  const adx = a[0] - d[0];
  const ady = a[1] - d[1];
  const bdx = b[0] - d[0];
  const bdy = b[1] - d[1];
  const cdx = c[0] - d[0];
  const cdy = c[1] - d[1];
  const det =
    (adx * adx + ady * ady) * (bdx * cdy - cdx * bdy) -
    (bdx * bdx + bdy * bdy) * (adx * cdy - cdx * ady) +
    (cdx * cdx + cdy * cdy) * (adx * bdy - bdx * ady);
  const orient = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  return orient > 0 ? det > 0 : det < 0;
}

function estimateNormal(positions: Vec3[], triangles: number[]): Vec3 {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  const limit = Math.min(triangles.length, 36);
  for (let t = 0; t < limit; t += 3) {
    const n = cross(
      sub(positions[triangles[t + 1]], positions[triangles[t]]),
      sub(positions[triangles[t + 2]], positions[triangles[t]]),
    );
    nx += n[0];
    ny += n[1];
    nz += n[2];
  }
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

function fair(positions: Vec3[], triangles: number[], boundaryCount: number, bbox: Bounds3): void {
  const { nbrs, weights } = cotangentWeights(positions, triangles);
  const interior: number[] = [];
  for (let i = boundaryCount; i < positions.length; i++) interior.push(i);
  if (interior.length === 0) return;

  for (let iter = 0; iter < FAIR_ITERS; iter++) {
    const lap: Vec3[] = positions.map(() => [0, 0, 0]);
    for (let v = 0; v < positions.length; v++) {
      const adj = nbrs[v];
      const wts = weights[v];
      if (adj.length === 0) continue;
      let x = 0;
      let y = 0;
      let z = 0;
      let wsum = 0;
      for (let k = 0; k < adj.length; k++) {
        const w = Math.max(wts[k], 1e-4);
        const n = adj[k];
        x += (positions[n][0] - positions[v][0]) * w;
        y += (positions[n][1] - positions[v][1]) * w;
        z += (positions[n][2] - positions[v][2]) * w;
        wsum += w;
      }
      const inv = 1 / wsum;
      lap[v] = [x * inv, y * inv, z * inv];
    }

    // Δ²v ≈ 0 이 되도록 라플라시안의 라플라시안을 한 번 더 뺀다. 경계는 고정.
    for (const v of interior) {
      const adj = nbrs[v];
      const wts = weights[v];
      if (adj.length === 0) continue;
      let x = 0;
      let y = 0;
      let z = 0;
      let wsum = 0;
      for (let k = 0; k < adj.length; k++) {
        const w = Math.max(wts[k], 1e-4);
        const n = adj[k];
        x += (lap[n][0] - lap[v][0]) * w;
        y += (lap[n][1] - lap[v][1]) * w;
        z += (lap[n][2] - lap[v][2]) * w;
        wsum += w;
      }
      const inv = 1 / wsum;
      const ll: Vec3 = [x * inv, y * inv, z * inv];
      const next: Vec3 = [
        positions[v][0] + lap[v][0] - 0.35 * ll[0],
        positions[v][1] + lap[v][1] - 0.35 * ll[1],
        positions[v][2] + lap[v][2] - 0.35 * ll[2],
      ];
      positions[v] = clampToBox(next, bbox);
    }
  }
}

interface RingFace {
  a: Vec3;
  b: Vec3;
  c: Vec3;
  n: Vec3;
}

function collectRingFaces(ctx: CapContext): RingFace[] {
  const ring = new Set(ctx.metrics.vertices);
  const faces: RingFace[] = [];
  const { indices, positions } = ctx.mesh;
  for (let t = 0; t < indices.length; t += 3) {
    const ia = indices[t];
    const ib = indices[t + 1];
    const ic = indices[t + 2];
    if (!ring.has(ia) && !ring.has(ib) && !ring.has(ic)) continue;
    const a = vertexAt(positions, ia);
    const b = vertexAt(positions, ib);
    const c = vertexAt(positions, ic);
    const n = normalize(triangleNormalRaw(a, b, c));
    if (length(n) < 1e-8) continue;
    faces.push({ a, b, c, n });
    if (faces.length >= 96) break;
  }
  return faces;
}

/**
 * Steiner가 기존 1-링 면을 뚫고 들어가면 그 평면 바깥으로 밀어 낸다.
 */
function clampToSurface(p: Vec3, faces: RingFace[], bbox: Bounds3): Vec3 {
  let q = clampToBox(p, bbox);
  for (const f of faces) {
    const d = dot(sub(q, f.a), f.n);
    if (d >= -1e-5) continue;
    if (!projectsInsideTri(q, f)) continue;
    q = [q[0] - f.n[0] * d, q[1] - f.n[1] * d, q[2] - f.n[2] * d];
  }
  return clampToBox(q, bbox);
}

function projectsInsideTri(p: Vec3, f: RingFace): boolean {
  const ab = sub(f.b, f.a);
  const ac = sub(f.c, f.a);
  const ap = sub(p, f.a);
  const n2 = dot(f.n, f.n) || 1;
  const q: Vec3 = [
    p[0] - f.n[0] * dot(ap, f.n) / n2,
    p[1] - f.n[1] * dot(ap, f.n) / n2,
    p[2] - f.n[2] * dot(ap, f.n) / n2,
  ];
  const v0 = ab;
  const v1 = ac;
  const v2 = sub(q, f.a);
  const d00 = dot(v0, v0);
  const d01 = dot(v0, v1);
  const d11 = dot(v1, v1);
  const d20 = dot(v2, v0);
  const d21 = dot(v2, v1);
  const denom = d00 * d11 - d01 * d01;
  if (Math.abs(denom) < 1e-20) return false;
  const v = (d11 * d20 - d01 * d21) / denom;
  const w = (d00 * d21 - d01 * d20) / denom;
  const u = 1 - v - w;
  return u >= -1e-4 && v >= -1e-4 && w >= -1e-4;
}

function cotangentWeights(
  positions: Vec3[],
  triangles: number[],
): { nbrs: number[][]; weights: number[][] } {
  const vertexCount = positions.length;
  const nbrs: number[][] = Array.from({ length: vertexCount }, () => []);
  const weights: number[][] = Array.from({ length: vertexCount }, () => []);
  const idxOf = (a: number, b: number) => nbrs[a].indexOf(b);

  const addW = (a: number, b: number, w: number) => {
    if (a === b) return;
    let i = idxOf(a, b);
    if (i < 0) {
      nbrs[a].push(b);
      weights[a].push(w);
    } else {
      weights[a][i] += w;
    }
    i = idxOf(b, a);
    if (i < 0) {
      nbrs[b].push(a);
      weights[b].push(w);
    } else {
      weights[b][i] += w;
    }
  };

  for (let t = 0; t < triangles.length; t += 3) {
    const i = triangles[t];
    const j = triangles[t + 1];
    const k = triangles[t + 2];
    const pi = positions[i];
    const pj = positions[j];
    const pk = positions[k];
    addW(i, j, cotOpposite(pk, pi, pj));
    addW(j, k, cotOpposite(pi, pj, pk));
    addW(k, i, cotOpposite(pj, pk, pi));
  }

  return { nbrs, weights };
}

/** 점 opp에서 에지 ab를 바라보는 각의 코탄젠트. */
function cotOpposite(opp: Vec3, a: Vec3, b: Vec3): number {
  const u = sub(a, opp);
  const v = sub(b, opp);
  const cr = length(cross(u, v));
  if (cr < 1e-18) return 0;
  return dot(u, v) / cr;
}

interface Bounds3 {
  min: Vec3;
  max: Vec3;
}

function holeBounds(positions: Vec3[], boundaryCount: number): Bounds3 {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < boundaryCount; i++) {
    const p = positions[i];
    for (let k = 0; k < 3; k++) {
      if (p[k] < min[k]) min[k] = p[k];
      if (p[k] > max[k]) max[k] = p[k];
    }
  }
  const pad = Math.max(length(sub(max, min)) * 0.08, 1e-6);
  return {
    min: [min[0] - pad, min[1] - pad, min[2] - pad],
    max: [max[0] + pad, max[1] + pad, max[2] + pad],
  };
}

function clampToBox(p: Vec3, bbox: Bounds3): Vec3 {
  return [
    Math.max(bbox.min[0], Math.min(bbox.max[0], p[0])),
    Math.max(bbox.min[1], Math.min(bbox.max[1], p[1])),
    Math.max(bbox.min[2], Math.min(bbox.max[2], p[2])),
  ];
}

/** CSRBF 투영 뒤 Steiner가 기존 표면을 뚫으면 다시 클램프한다. */
export function clampPatchSteiners(ctx: CapContext, patch: CapPatch): CapPatch {
  if (patch.newPositions.length === 0) return patch;
  const loopPts = ctx.metrics.vertices.map((v) => vertexAt(ctx.mesh.positions, v));
  const bbox = holeBounds(loopPts, loopPts.length);
  const ring = collectRingFaces(ctx);
  const newPositions = patch.newPositions.slice();
  for (let i = 0; i < newPositions.length; i += 3) {
    const q = clampToSurface([newPositions[i], newPositions[i + 1], newPositions[i + 2]], ring, bbox);
    newPositions[i] = q[0];
    newPositions[i + 1] = q[1];
    newPositions[i + 2] = q[2];
  }
  return { newPositions, triangles: patch.triangles };
}
