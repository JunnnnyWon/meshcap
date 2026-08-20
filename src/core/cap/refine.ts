import { centroidOf, cross, length, planeBasis, projectToPlane, sub, vertexAt, type Vec3 } from '../geom.ts';
import type { CapContext, CapPatch } from './types.ts';

const ALPHA = 2;
const MAX_STEINER = 200;
const MAX_REFINE_ITERS = 6;
const MAX_SWAP_PASSES = 8;
const FAIR_ITERS = 24;

/**
 * Liepa 2003의 나머지 절반. 거친 삼각화 위에 Steiner 정점을 넣어 주변 밀도를
 * 맞추고, 내부 정점을 라플라시안으로 풀어 드럼 가죽처럼 납작한 뚜껑을 곡면에 붙인다.
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

  const triangles: number[] = [];
  for (let i = 0; i < patch.triangles.length; i += 3) {
    const a = localOf.get(patch.triangles[i]);
    const b = localOf.get(patch.triangles[i + 1]);
    const c = localOf.get(patch.triangles[i + 2]);
    if (a === undefined || b === undefined || c === undefined) return patch;
    triangles.push(a, b, c);
  }

  let boundaryCount = n;
  refine(positions, triangles, sigma, boundaryCount);

  const bbox = holeBounds(positions, n);
  fair(positions, triangles, n, bbox);

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
  const adj = adjacency(positions.length, triangles);
  const interior: number[] = [];
  for (let i = boundaryCount; i < positions.length; i++) interior.push(i);
  if (interior.length === 0) return;

  for (let iter = 0; iter < FAIR_ITERS; iter++) {
    const lap: Vec3[] = positions.map(() => [0, 0, 0]);
    for (const v of interior) {
      const nbrs = adj[v];
      if (nbrs.length === 0) continue;
      let x = 0;
      let y = 0;
      let z = 0;
      for (const n of nbrs) {
        x += positions[n][0];
        y += positions[n][1];
        z += positions[n][2];
      }
      const inv = 1 / nbrs.length;
      lap[v] = [x * inv - positions[v][0], y * inv - positions[v][1], z * inv - positions[v][2]];
    }

    // Δ²v ≈ 0 이 되도록 라플라시안의 라플라시안을 한 번 더 뺀다.
    for (const v of interior) {
      const nbrs = adj[v];
      if (nbrs.length === 0) continue;
      let x = 0;
      let y = 0;
      let z = 0;
      for (const n of nbrs) {
        x += lap[n][0];
        y += lap[n][1];
        z += lap[n][2];
      }
      const inv = 1 / nbrs.length;
      const ll: Vec3 = [x * inv - lap[v][0], y * inv - lap[v][1], z * inv - lap[v][2]];
      const next: Vec3 = [
        positions[v][0] + lap[v][0] - 0.35 * ll[0],
        positions[v][1] + lap[v][1] - 0.35 * ll[1],
        positions[v][2] + lap[v][2] - 0.35 * ll[2],
      ];
      positions[v] = clampToBox(next, bbox);
    }
  }
}

function adjacency(vertexCount: number, triangles: number[]): number[][] {
  const adj: number[][] = Array.from({ length: vertexCount }, () => []);
  const add = (a: number, b: number) => {
    if (!adj[a].includes(b)) adj[a].push(b);
    if (!adj[b].includes(a)) adj[b].push(a);
  };
  for (let t = 0; t < triangles.length; t += 3) {
    add(triangles[t], triangles[t + 1]);
    add(triangles[t + 1], triangles[t + 2]);
    add(triangles[t + 2], triangles[t]);
  }
  return adj;
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
