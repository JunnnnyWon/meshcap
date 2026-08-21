import { centroidOf, cross, dot, length, planeBasis, projectToPlane, sub, triangleNormalRaw, vertexAt, type Vec3 } from '../geom.ts';
import { buildTopology } from '../halfEdge.ts';
import { closesVisibleTear, EdgeIncidence } from '../incidence.ts';
import type { LoopMetrics } from '../classify.ts';
import { computeBounds, type MeshData } from '../types.ts';
import type { CapContext, CapPatch } from './types.ts';
import { EMPTY_PATCH } from './types.ts';

export const BROWSER_WRAP_RESOLUTION = 96;
export const SERVER_WRAP_RESOLUTION = 160;

const MAX_NEARBY_TRIS = 480;
const MAX_WRAP_TRIS = 12_000;

const CORNER: Vec3[] = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [1, 1, 1],
  [0, 1, 1],
];

/** 큐브를 공간 대각선 0–6 기준으로 나눈 여섯 테트라헤드론. */
const TETS: [number, number, number, number][] = [
  [0, 1, 2, 6],
  [0, 2, 3, 6],
  [0, 3, 7, 6],
  [0, 7, 4, 6],
  [0, 4, 5, 6],
  [0, 5, 1, 6],
];

/**
 * 남은 테두리 AABB에만 occupancy를 만들고, 팽창으로 찢김을 봉한 뒤
 * 마칭 테트라헤드론으로 뚜껑을 뽑는다. 원본 표면에 달라붙은 면은 버리고
 * 구멍 안쪽에 생긴 막만 남긴다. 전 모델 복셀은 하지 않는다.
 */
export function capVoxelWrap(ctx: CapContext): CapPatch {
  return wrapLoops(
    ctx.mesh,
    [ctx.metrics],
    ctx.wrapResolution ?? BROWSER_WRAP_RESOLUTION,
    ctx.baseVertexCount,
    ctx.edgeFaceCount,
    ctx.strictManifold === true ? ctx.wouldCreateNonManifold : undefined,
  );
}

export function wrapLoops(
  mesh: MeshData,
  loops: LoopMetrics[],
  resolution: number,
  baseVertexCount: number,
  edgeFaceCount?: (a: number, b: number) => number,
  wouldCreateNonManifold?: (a: number, b: number, c: number) => boolean,
  commitTriangle?: (a: number, b: number, c: number) => void,
): CapPatch {
  const extra: number[] = [];
  const triangles: number[] = [];
  let base = baseVertexCount;

  for (const loop of loops) {
    if (loop.vertices.length < 3) continue;
    const patch = wrapOne(mesh, loop, resolution, base, edgeFaceCount, wouldCreateNonManifold);
    const localBase = base;
    for (let i = 0; i < patch.newPositions.length; i++) extra.push(patch.newPositions[i]);
    for (let i = 0; i < patch.triangles.length; i++) {
      const id = patch.triangles[i];
      triangles.push(id >= localBase ? base + (id - localBase) : id);
    }
    for (let i = 0; i < patch.triangles.length; i += 3) {
      const a = patch.triangles[i];
      const b = patch.triangles[i + 1];
      const c = patch.triangles[i + 2];
      commitTriangle?.(
        a >= localBase ? base + (a - localBase) : a,
        b >= localBase ? base + (b - localBase) : b,
        c >= localBase ? base + (c - localBase) : c,
      );
    }
    base += patch.newPositions.length / 3;
  }

  if (triangles.length === 0) return EMPTY_PATCH;
  return { newPositions: extra, triangles };
}

const CLUSTER_CELL_DIAG = 0.06;
const CLUSTER_MAX_DIAG = 0.16;
const CLUSTER_LIMIT = 24;

/**
 * 남은 1-face 에지를 로컬 격자로 묶어 AABB만 감싼다. 모델 전체 복셀은 하지 않는다.
 */
export function wrapBoundaryClusters(
  mesh: MeshData,
  resolution: number,
  strictManifold = false,
): { mesh: MeshData; addedTriangles: number } {
  const topology = buildTopology(mesh);
  if (topology.fillFrom.length < 1) return { mesh, addedTriangles: 0 };

  const incidence = new EdgeIncidence(mesh);
  const bounds = computeBounds(mesh.positions);
  const cell = Math.max(incidence.meanLength * 5, bounds.diagonal * CLUSTER_CELL_DIAG, 1e-12);
  const buckets = new Map<string, { verts: number[]; edges: [number, number][] }>();
  const seen = new Set<string>();

  for (let i = 0; i < topology.fillFrom.length; i++) {
    const a = topology.fillFrom[i];
    const b = topology.fillTo[i];
    const ek = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (seen.has(ek)) continue;
    seen.add(ek);
    const pa = vertexAt(mesh.positions, a);
    const pb = vertexAt(mesh.positions, b);
    const mx = (pa[0] + pb[0]) * 0.5;
    const my = (pa[1] + pb[1]) * 0.5;
    const mz = (pa[2] + pb[2]) * 0.5;
    const key = `${Math.floor(mx / cell)}:${Math.floor(my / cell)}:${Math.floor(mz / cell)}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { verts: [], edges: [] };
      buckets.set(key, bucket);
    }
    bucket.verts.push(a, b);
    bucket.edges.push([a, b]);
  }

  const clusters = [...buckets.values()]
    .filter((b) => b.edges.length >= 3)
    .sort((a, b) => b.edges.length - a.edges.length)
    .slice(0, CLUSTER_LIMIT);

  if (clusters.length === 0) return { mesh, addedTriangles: 0 };

  let working = mesh;
  let addedTriangles = 0;
  let base = working.positions.length / 3;
  let runningBoundary = topology.boundaryEdgeCount;

  for (const cluster of clusters) {
    const verts = uniqueOrdered(cluster.verts, cluster.edges);
    if (verts.length < 2) continue;
    const pts = verts.map((v) => vertexAt(working.positions, v));
    let min: Vec3 = [Infinity, Infinity, Infinity];
    let max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const p of pts) {
      for (let k = 0; k < 3; k++) {
        if (p[k] < min[k]) min[k] = p[k];
        if (p[k] > max[k]) max[k] = p[k];
      }
    }
    if (length(sub(max, min)) > bounds.diagonal * CLUSTER_MAX_DIAG) continue;

    const centroid = centroidOf(pts);
    let peri = 0;
    for (let i = 0; i < pts.length; i++) peri += length(sub(pts[(i + 1) % pts.length], pts[i]));
    const metrics: LoopMetrics = {
      id: 0,
      vertices: verts,
      closed: false,
      perimeter: peri,
      area: 0,
      capNormal: estimateNormal(pts, centroid),
      centroid,
      planarity: 1,
      relativeSize: peri / (bounds.diagonal || 1),
      bottomFacing: false,
      strategy: 'wrap',
    };

    const live = new EdgeIncidence(working);
    const patch = wrapOne(
      working,
      metrics,
      resolution,
      base,
      (a, b) => live.count(a, b),
      strictManifold ? (a, b, c) => live.wouldCreateNonManifold(a, b, c) : undefined,
      cluster.edges,
    );
    if (patch.triangles.length === 0) continue;
    const covered = countCoveredEdges(cluster.edges, patch.triangles);
    if (covered < 1) continue;

    const next: MeshData = {
      positions: concatPositions(working.positions, patch.newPositions),
      indices: concatIndices(working.indices, patch.triangles),
    };
    const oneFaceAfter = buildTopology(next).boundaryEdgeCount;
    // 덮인 1-face가 있으면 닫힌 국소 껍질을 받아들인다. 짝 못 맞춘 half-edge가
    // 조금 늘어도 되고, 테두리가 폭주할 때만 버린다.
    if (oneFaceAfter > runningBoundary + Math.max(2, covered)) continue;
    working = next;
    base = working.positions.length / 3;
    addedTriangles += patch.triangles.length / 3;
    runningBoundary = oneFaceAfter;
  }

  return { mesh: working, addedTriangles };
}

const LEFTOVER_WRAP_RES = 32;
const LEFTOVER_WRAP_PAD = 0.35;
const LEFTOVER_WRAP_LIMIT = 48;
const LEFTOVER_WRAP_FAILS = 16;

/**
 * 구멍 루프가 아닌 남은 1-face 에지 하나(고립 2-vert 포함)의 AABB만 감싼다.
 * 클러스터 랩은 변 3개 이상을 요구해서 이런 균열을 건너뛴다.
 */
export function wrapLeftoverEdgeAabbs(
  mesh: MeshData,
  resolution = LEFTOVER_WRAP_RES,
  strictManifold = false,
): { mesh: MeshData; addedTriangles: number } {
  const topology = buildTopology(mesh);
  if (topology.fillFrom.length === 0) return { mesh, addedTriangles: 0 };

  const incidence = new EdgeIncidence(mesh);
  const mean = incidence.meanLength;
  if (mean <= 0) return { mesh, addedTriangles: 0 };

  const valence = new Uint8Array(mesh.positions.length / 3);
  for (let i = 0; i < topology.fillFrom.length; i++) {
    valence[topology.fillFrom[i]]++;
    valence[topology.fillTo[i]]++;
  }
  const candidates: { a: number; b: number; face: number; isolated: boolean }[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < topology.fillFrom.length; i++) {
    const a = topology.fillFrom[i];
    const b = topology.fillTo[i];
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ a, b, face: topology.fillFace[i], isolated: valence[a] === 1 && valence[b] === 1 });
  }
  candidates.sort((x, y) => Number(y.isolated) - Number(x.isolated));

  let working = mesh;
  let addedTriangles = 0;
  let fails = 0;
  const limit = Math.min(candidates.length, LEFTOVER_WRAP_LIMIT);
  let runningBoundary = topology.boundaryEdgeCount;
  let runningNm = topology.nonManifoldEdgeCount;

  for (let i = 0; i < limit; i++) {
    const cand = candidates[i];
    const ia = working.indices[cand.face * 3];
    const ib = working.indices[cand.face * 3 + 1];
    const ic = working.indices[cand.face * 3 + 2];
    const verts = uniqueOrdered([ia, ib, ic], [[cand.a, cand.b]]);
    const pts = verts.map((v) => vertexAt(working.positions, v));
    const centroid = centroidOf(pts);
    let peri = 0;
    for (let k = 0; k < pts.length; k++) peri += length(sub(pts[(k + 1) % pts.length], pts[k]));
    const metrics: LoopMetrics = {
      id: 0,
      vertices: verts,
      closed: verts.length >= 3,
      perimeter: peri,
      area: 0,
      capNormal: estimateNormal(pts, centroid),
      centroid,
      planarity: 1,
      relativeSize: 0,
      bottomFacing: false,
      strategy: 'wrap',
    };
    const live = new EdgeIncidence(working);
    const near = nearestInteriorEdge(working, live, cand.a, cand.b, mean);
    const extra: [number, number][] = [[cand.a, cand.b]];
    if (near) extra.push(near);
    const base = working.positions.length / 3;
    const patch = wrapOne(
      working,
      metrics,
      resolution,
      base,
      (u, v) => live.count(u, v),
      strictManifold ? (u, v, w) => live.wouldCreateNonManifold(u, v, w) : undefined,
      extra,
      mean * LEFTOVER_WRAP_PAD,
      1,
    );
    if (patch.triangles.length === 0) {
      fails++;
      if (fails >= LEFTOVER_WRAP_FAILS) break;
      continue;
    }
    const next: MeshData = {
      positions: concatPositions(working.positions, patch.newPositions),
      indices: concatIndices(working.indices, patch.triangles),
    };
    const after = buildTopology(next);
    if (after.boundaryEdgeCount >= runningBoundary) {
      fails++;
      if (fails >= LEFTOVER_WRAP_FAILS) break;
      continue;
    }
    if (after.nonManifoldEdgeCount > runningNm) {
      fails++;
      if (fails >= LEFTOVER_WRAP_FAILS) break;
      continue;
    }
    working = next;
    addedTriangles += patch.triangles.length / 3;
    runningBoundary = after.boundaryEdgeCount;
    runningNm = after.nonManifoldEdgeCount;
    fails = 0;
  }

  return { mesh: working, addedTriangles };
}

function nearestInteriorEdge(
  mesh: MeshData,
  incidence: EdgeIncidence,
  a: number,
  b: number,
  mean: number,
): [number, number] | null {
  const pa = vertexAt(mesh.positions, a);
  const pb = vertexAt(mesh.positions, b);
  const ab = sub(pb, pa);
  const abLen = length(ab);
  if (abLen < 1e-18) return null;
  const dir: Vec3 = [ab[0] / abLen, ab[1] / abLen, ab[2] / abLen];
  const cap = mean * 0.5;
  const { indices, positions } = mesh;
  let best: [number, number] | null = null;
  let bestDist = cap;
  const seen = new Set<string>();
  for (let t = 0; t < indices.length; t += 3) {
    const vs = [indices[t], indices[t + 1], indices[t + 2]];
    for (let k = 0; k < 3; k++) {
      const u = vs[k];
      const v = vs[(k + 1) % 3];
      if (incidence.count(u, v) < 2) continue;
      const key = u < v ? `${u}:${v}` : `${v}:${u}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const pu = vertexAt(positions, u);
      const pv = vertexAt(positions, v);
      const uv = sub(pv, pu);
      const uvLen = length(uv);
      if (uvLen < 1e-18) continue;
      const parallel = Math.abs((uv[0] * dir[0] + uv[1] * dir[1] + uv[2] * dir[2]) / uvLen);
      if (parallel < 0.7) continue;
      const mid: Vec3 = [(pu[0] + pv[0]) * 0.5, (pu[1] + pv[1]) * 0.5, (pu[2] + pv[2]) * 0.5];
      const abMid: Vec3 = [(pa[0] + pb[0]) * 0.5, (pa[1] + pb[1]) * 0.5, (pa[2] + pb[2]) * 0.5];
      const dist = length(sub(mid, abMid));
      if (dist < bestDist) {
        bestDist = dist;
        best = [u, v];
      }
    }
  }
  return best;
}

function countCoveredEdges(edges: [number, number][], triangles: number[]): number {
  const need = new Set(edges.map(([a, b]) => (a < b ? `${a}:${b}` : `${b}:${a}`)));
  const seen = new Set<string>();
  for (let i = 0; i < triangles.length; i += 3) {
    const tri = [triangles[i], triangles[i + 1], triangles[i + 2]];
    for (let k = 0; k < 3; k++) {
      const a = tri[k];
      const b = tri[(k + 1) % 3];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (need.has(key)) seen.add(key);
    }
  }
  return seen.size;
}

function uniqueOrdered(verts: number[], edges: [number, number][]): number[] {
  const adj = new Map<number, number[]>();
  for (const [a, b] of edges) {
    const la = adj.get(a);
    if (la) la.push(b);
    else adj.set(a, [b]);
    const lb = adj.get(b);
    if (lb) lb.push(a);
    else adj.set(b, [a]);
  }
  let start = verts[0];
  for (const [v, ns] of adj) {
    if (ns.length === 1) {
      start = v;
      break;
    }
  }
  const out: number[] = [];
  const seen = new Set<number>();
  let cur: number | undefined = start;
  while (cur !== undefined && !seen.has(cur)) {
    seen.add(cur);
    out.push(cur);
    cur = (adj.get(cur) ?? []).find((n) => !seen.has(n));
  }
  for (const v of adj.keys()) {
    if (!seen.has(v)) out.push(v);
  }
  return out;
}

function estimateNormal(pts: Vec3[], centroid: Vec3): Vec3 {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = sub(pts[i], centroid);
    const b = sub(pts[(i + 1) % pts.length], centroid);
    nx += a[1] * b[2] - a[2] * b[1];
    ny += a[2] * b[0] - a[0] * b[2];
    nz += a[0] * b[1] - a[1] * b[0];
  }
  const n: Vec3 = [nx, ny, nz];
  return length(n) > 1e-20 ? [nx / length(n), ny / length(n), nz / length(n)] : [0, 1, 0];
}

function concatPositions(base: Float32Array, extra: number[]): Float32Array {
  if (extra.length === 0) return base;
  const out = new Float32Array(base.length + extra.length);
  out.set(base);
  out.set(extra, base.length);
  return out;
}

function concatIndices(base: Uint32Array, extra: number[]): Uint32Array {
  if (extra.length === 0) return base;
  const out = new Uint32Array(base.length + extra.length);
  out.set(base);
  out.set(extra, base.length);
  return out;
}

function wrapOne(
  mesh: MeshData,
  metrics: LoopMetrics,
  resolution: number,
  baseVertexCount: number,
  edgeFaceCount?: (a: number, b: number) => number,
  wouldCreateNonManifold?: (a: number, b: number, c: number) => boolean,
  extraSegments?: [number, number][],
  aabbPad?: number,
  dilateRadius?: number,
): CapPatch {
  const loop = metrics.vertices;
  const pts = loop.map((v) => vertexAt(mesh.positions, v));
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) {
    for (let k = 0; k < 3; k++) {
      if (p[k] < min[k]) min[k] = p[k];
      if (p[k] > max[k]) max[k] = p[k];
    }
  }
  const diag = length(sub(max, min)) || 1;
  const pad = Math.max(diag * 0.14, aabbPad ?? 0, 1e-5);
  const origin: Vec3 = [min[0] - pad, min[1] - pad, min[2] - pad];
  const extent: Vec3 = [max[0] - min[0] + pad * 2, max[1] - min[1] + pad * 2, max[2] - min[2] + pad * 2];
  const longest = Math.max(extent[0], extent[1], extent[2], 1e-8);
  const res = Math.max(8, Math.min(resolution, 160));
  const voxel = longest / Math.max(1, res - 1);
  const nx = clampi(Math.ceil(extent[0] / voxel) + 1, 8, res);
  const ny = clampi(Math.ceil(extent[1] / voxel) + 1, 8, res);
  const nz = clampi(Math.ceil(extent[2] / voxel) + 1, 8, res);

  const occ = new Uint8Array(nx * ny * nz);
  const nearby = gatherNearby(mesh, origin, [origin[0] + nx * voxel, origin[1] + ny * voxel, origin[2] + nz * voxel], metrics.centroid);
  for (const tri of nearby) {
    rasterizeTri(occ, nx, ny, nz, origin, voxel, tri[0], tri[1], tri[2]);
  }

  const center = centroidOf(pts);
  for (let i = 0; i < pts.length; i++) {
    rasterizeTri(occ, nx, ny, nz, origin, voxel, center, pts[i], pts[(i + 1) % pts.length]);
  }
  if (extraSegments) {
    const off = voxel * 1.6;
    const n = metrics.capNormal;
    const lifted: Vec3 = [center[0] + n[0] * off, center[1] + n[1] * off, center[2] + n[2] * off];
    const dropped: Vec3 = [center[0] - n[0] * off, center[1] - n[1] * off, center[2] - n[2] * off];
    for (const [a, b] of extraSegments) {
      const pa = vertexAt(mesh.positions, a);
      const pb = vertexAt(mesh.positions, b);
      rasterizeTri(occ, nx, ny, nz, origin, voxel, center, pa, pb);
      rasterizeTri(occ, nx, ny, nz, origin, voxel, lifted, pa, pb);
      rasterizeTri(occ, nx, ny, nz, origin, voxel, dropped, pa, pb);
    }
  }

  const radius = dilateRadius ?? Math.max(1, Math.min(5, Math.floor(Math.min(nx, ny, nz) / 8)));
  let solid: Uint8Array = occ;
  for (let i = 0; i < radius; i++) solid = dilate26(solid, nx, ny, nz);

  const outside = floodOutside(solid, nx, ny, nz);
  const closed = new Uint8Array(solid.length);
  for (let i = 0; i < solid.length; i++) closed[i] = outside[i] ? 0 : 1;

  const iso = marchingTets(closed, nx, ny, nz, origin, voxel);
  if (iso.indices.length === 0) return EMPTY_PATCH;

  return stitch(
    iso,
    mesh,
    loop,
    pts,
    metrics.capNormal,
    nearby,
    voxel,
    baseVertexCount,
    edgeFaceCount,
    wouldCreateNonManifold,
  );
}

function gatherNearby(mesh: MeshData, min: Vec3, max: Vec3, centroid: Vec3): Vec3[][] {
  const hits: { d2: number; tri: Vec3[] }[] = [];
  const { indices, positions } = mesh;
  for (let t = 0; t < indices.length; t += 3) {
    const a = vertexAt(positions, indices[t]);
    const b = vertexAt(positions, indices[t + 1]);
    const c = vertexAt(positions, indices[t + 2]);
    const tmin: Vec3 = [
      Math.min(a[0], b[0], c[0]),
      Math.min(a[1], b[1], c[1]),
      Math.min(a[2], b[2], c[2]),
    ];
    const tmax: Vec3 = [
      Math.max(a[0], b[0], c[0]),
      Math.max(a[1], b[1], c[1]),
      Math.max(a[2], b[2], c[2]),
    ];
    if (tmax[0] < min[0] || tmin[0] > max[0]) continue;
    if (tmax[1] < min[1] || tmin[1] > max[1]) continue;
    if (tmax[2] < min[2] || tmin[2] > max[2]) continue;
    const g: Vec3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    const d = sub(g, centroid);
    hits.push({ d2: d[0] * d[0] + d[1] * d[1] + d[2] * d[2], tri: [a, b, c] });
  }
  hits.sort((a, b) => a.d2 - b.d2);
  return hits.slice(0, MAX_NEARBY_TRIS).map((h) => h.tri);
}

function rasterizeTri(
  grid: Uint8Array,
  nx: number,
  ny: number,
  nz: number,
  origin: Vec3,
  h: number,
  a: Vec3,
  b: Vec3,
  c: Vec3,
): void {
  const toG = (p: Vec3): Vec3 => [(p[0] - origin[0]) / h, (p[1] - origin[1]) / h, (p[2] - origin[2]) / h];
  const ga = toG(a);
  const gb = toG(b);
  const gc = toG(c);
  const minx = Math.max(0, Math.floor(Math.min(ga[0], gb[0], gc[0]) - 1));
  const miny = Math.max(0, Math.floor(Math.min(ga[1], gb[1], gc[1]) - 1));
  const minz = Math.max(0, Math.floor(Math.min(ga[2], gb[2], gc[2]) - 1));
  const maxx = Math.min(nx - 1, Math.ceil(Math.max(ga[0], gb[0], gc[0]) + 1));
  const maxy = Math.min(ny - 1, Math.ceil(Math.max(ga[1], gb[1], gc[1]) + 1));
  const maxz = Math.min(nz - 1, Math.ceil(Math.max(ga[2], gb[2], gc[2]) + 1));
  const limit = h * 0.92;

  for (let z = minz; z <= maxz; z++) {
    for (let y = miny; y <= maxy; y++) {
      for (let x = minx; x <= maxx; x++) {
        const p: Vec3 = [origin[0] + (x + 0.5) * h, origin[1] + (y + 0.5) * h, origin[2] + (z + 0.5) * h];
        if (pointTriangleDist(p, a, b, c) <= limit) {
          grid[x + nx * (y + ny * z)] = 1;
        }
      }
    }
  }
}

function pointTriangleDist(p: Vec3, a: Vec3, b: Vec3, c: Vec3): number {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  const n = cross(ab, ac);
  const n2 = dot(n, n);
  if (n2 < 1e-24) {
    return Math.min(distSeg(p, a, b), distSeg(p, b, c), distSeg(p, c, a));
  }
  const signed = dot(ap, n);
  const inv = 1 / n2;
  const q: Vec3 = [p[0] - n[0] * signed * inv, p[1] - n[1] * signed * inv, p[2] - n[2] * signed * inv];
  const v0 = ab;
  const v1 = ac;
  const v2 = sub(q, a);
  const d00 = dot(v0, v0);
  const d01 = dot(v0, v1);
  const d11 = dot(v1, v1);
  const d20 = dot(v2, v0);
  const d21 = dot(v2, v1);
  const denom = d00 * d11 - d01 * d01;
  if (Math.abs(denom) < 1e-24) {
    return Math.min(distSeg(p, a, b), distSeg(p, b, c), distSeg(p, c, a));
  }
  const v = (d11 * d20 - d01 * d21) / denom;
  const w = (d00 * d21 - d01 * d20) / denom;
  const u = 1 - v - w;
  if (u >= 0 && v >= 0 && w >= 0) return Math.abs(signed) / Math.sqrt(n2);
  return Math.min(distSeg(p, a, b), distSeg(p, b, c), distSeg(p, c, a));
}

function distSeg(p: Vec3, a: Vec3, b: Vec3): number {
  const ab = sub(b, a);
  const denom = dot(ab, ab);
  const t = denom > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / denom)) : 0;
  const q: Vec3 = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
  return length(sub(p, q));
}

function dilate26(src: Uint8Array, nx: number, ny: number, nz: number): Uint8Array<ArrayBuffer> {
  const dst = new Uint8Array(src.length);
  dst.set(src);
  const idx = (x: number, y: number, z: number) => x + nx * (y + ny * z);
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        if (src[idx(x, y, z)]) continue;
        let hit = false;
        for (let dz = -1; dz <= 1 && !hit; dz++) {
          const zz = z + dz;
          if (zz < 0 || zz >= nz) continue;
          for (let dy = -1; dy <= 1 && !hit; dy++) {
            const yy = y + dy;
            if (yy < 0 || yy >= ny) continue;
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0 && dz === 0) continue;
              const xx = x + dx;
              if (xx < 0 || xx >= nx) continue;
              if (src[idx(xx, yy, zz)]) {
                hit = true;
                break;
              }
            }
          }
        }
        if (hit) dst[idx(x, y, z)] = 1;
      }
    }
  }
  return dst;
}

function floodOutside(solid: Uint8Array, nx: number, ny: number, nz: number): Uint8Array {
  const outside = new Uint8Array(solid.length);
  const idx = (x: number, y: number, z: number) => x + nx * (y + ny * z);
  const qx: number[] = [];
  const qy: number[] = [];
  const qz: number[] = [];

  const tryPush = (x: number, y: number, z: number) => {
    if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) return;
    const i = idx(x, y, z);
    if (solid[i] || outside[i]) return;
    outside[i] = 1;
    qx.push(x);
    qy.push(y);
    qz.push(z);
  };

  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      tryPush(x, y, 0);
      tryPush(x, y, nz - 1);
    }
  }
  for (let z = 0; z < nz; z++) {
    for (let x = 0; x < nx; x++) {
      tryPush(x, 0, z);
      tryPush(x, ny - 1, z);
    }
    for (let y = 0; y < ny; y++) {
      tryPush(0, y, z);
      tryPush(nx - 1, y, z);
    }
  }

  for (let q = 0; q < qx.length; q++) {
    const x = qx[q];
    const y = qy[q];
    const z = qz[q];
    tryPush(x - 1, y, z);
    tryPush(x + 1, y, z);
    tryPush(x, y - 1, z);
    tryPush(x, y + 1, z);
    tryPush(x, y, z - 1);
    tryPush(x, y, z + 1);
  }
  return outside;
}

function marchingTets(
  solid: Uint8Array,
  nx: number,
  ny: number,
  nz: number,
  origin: Vec3,
  h: number,
): { positions: Vec3[]; indices: number[] } {
  const positions: Vec3[] = [];
  const indices: number[] = [];
  const hash = new Map<number, number>();
  const at = (x: number, y: number, z: number) => x + nx * (y + ny * z);
  const occupied = (x: number, y: number, z: number) =>
    x >= 0 && y >= 0 && z >= 0 && x < nx && y < ny && z < nz && solid[at(x, y, z)] !== 0;

  const cornerKey = (x: number, y: number, z: number) => x + (nx + 1) * (y + (ny + 1) * z);
  const edgeId = (a: number, b: number) => {
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    return lo * 1_000_000_003 + hi;
  };

  const vertOn = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number => {
    const k = edgeId(cornerKey(x0, y0, z0), cornerKey(x1, y1, z1));
    const existing = hash.get(k);
    if (existing !== undefined) return existing;
    const id = positions.length;
    positions.push([
      origin[0] + (x0 + x1) * 0.5 * h,
      origin[1] + (y0 + y1) * 0.5 * h,
      origin[2] + (z0 + z1) * 0.5 * h,
    ]);
    hash.set(k, id);
    return id;
  };

  for (let z = 0; z < nz - 1; z++) {
    for (let y = 0; y < ny - 1; y++) {
      for (let x = 0; x < nx - 1; x++) {
        const bits: boolean[] = [];
        const coords: [number, number, number][] = [];
        for (const c of CORNER) {
          const cx = x + c[0];
          const cy = y + c[1];
          const cz = z + c[2];
          coords.push([cx, cy, cz]);
          bits.push(occupied(cx, cy, cz));
        }
        for (const tet of TETS) {
          emitTet(tet, bits, coords, vertOn, indices);
        }
      }
    }
  }

  return { positions, indices };
}

function emitTet(
  tet: [number, number, number, number],
  bits: boolean[],
  coords: [number, number, number][],
  vertOn: (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => number,
  indices: number[],
): void {
  const s = [bits[tet[0]], bits[tet[1]], bits[tet[2]], bits[tet[3]]];
  let nSolid = 0;
  for (const v of s) if (v) nSolid++;
  if (nSolid === 0 || nSolid === 4) return;

  const edges: [number, number][] = [
    [0, 1],
    [0, 2],
    [0, 3],
    [1, 2],
    [1, 3],
    [2, 3],
  ];
  const cuts: { i: number; j: number; id: number }[] = [];
  for (const [i, j] of edges) {
    if (s[i] === s[j]) continue;
    const a = coords[tet[i]];
    const b = coords[tet[j]];
    cuts.push({ i, j, id: vertOn(a[0], a[1], a[2], b[0], b[1], b[2]) });
  }

  if (cuts.length === 3) {
    const empty = s[0] ? (s[1] ? (s[2] ? 3 : 2) : 1) : 0;
    pushOriented(cuts[0].id, cuts[1].id, cuts[2].id, coords[tet[empty]], false, indices);
    return;
  }

  if (cuts.length !== 4) return;

  const solidIdx: number[] = [];
  const emptyIdx: number[] = [];
  for (let i = 0; i < 4; i++) (s[i] ? solidIdx : emptyIdx).push(i);
  const [a, b] = solidIdx;
  const [c, d] = emptyIdx;
  const find = (i: number, j: number) => {
    for (const cut of cuts) {
      if ((cut.i === i && cut.j === j) || (cut.i === j && cut.j === i)) return cut.id;
    }
    return -1;
  };
  const ac = find(a, c);
  const ad = find(a, d);
  const bc = find(b, c);
  const bd = find(b, d);
  if (ac < 0 || ad < 0 || bc < 0 || bd < 0) return;
  pushOriented(ac, bc, bd, coords[tet[c]], true, indices);
  pushOriented(ac, bd, ad, coords[tet[c]], true, indices);
}

function pushOriented(
  a: number,
  b: number,
  c: number,
  emptyCorner: [number, number, number],
  towardEmpty: boolean,
  indices: number[],
): void {
  void emptyCorner;
  void towardEmpty;
  indices.push(a, b, c);
}

function stitch(
  iso: { positions: Vec3[]; indices: number[] },
  mesh: MeshData,
  loop: number[],
  pts: Vec3[],
  capNormal: Vec3,
  original: Vec3[][],
  voxel: number,
  baseVertexCount: number,
  edgeFaceCount?: (a: number, b: number) => number,
  wouldCreateNonManifold?: (a: number, b: number, c: number) => boolean,
): CapPatch {
  const snapDist = voxel * 1.7;
  const snapOf: number[] = [];
  const newPositions: number[] = [];
  const newIndexOf: number[] = [];

  for (let i = 0; i < iso.positions.length; i++) {
    const p = iso.positions[i];
    let best = -1;
    let bestD = snapDist;
    for (let k = 0; k < pts.length; k++) {
      const d = length(sub(p, pts[k]));
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    if (best >= 0) {
      snapOf[i] = loop[best];
    } else {
      snapOf[i] = -1;
      newIndexOf[i] = baseVertexCount + newPositions.length / 3;
      newPositions.push(p[0], p[1], p[2]);
    }
  }

  const snapped = snapOf.filter((id) => id >= 0).length;
  if (snapped < Math.min(3, pts.length)) return EMPTY_PATCH;
  const map = (i: number) => (snapOf[i] >= 0 ? snapOf[i] : newIndexOf[i]);
  const raw: number[] = [];

  for (let t = 0; t < iso.indices.length; t += 3) {
    const a = map(iso.indices[t]);
    const b = map(iso.indices[t + 1]);
    const c = map(iso.indices[t + 2]);
    if (a === b || b === c || c === a) continue;
    const pa = iso.positions[iso.indices[t]];
    const pb = iso.positions[iso.indices[t + 1]];
    const pc = iso.positions[iso.indices[t + 2]];
    const g: Vec3 = [(pa[0] + pb[0] + pc[0]) / 3, (pa[1] + pb[1] + pc[1]) / 3, (pa[2] + pb[2] + pc[2]) / 3];
    if (!keepFillTriangle(g, pts, capNormal, original, voxel)) continue;
    if (edgeFaceCount) {
      const ab = edgeFaceCount(a, b);
      const bc = edgeFaceCount(b, c);
      const ca = edgeFaceCount(c, a);
      if (wouldCreateNonManifold) {
        if (ab >= 2 || bc >= 2 || ca >= 2) continue;
        if (wouldCreateNonManifold(a, b, c)) continue;
      } else if (!closesVisibleTear(ab, bc, ca)) {
        continue;
      }
    } else if (wouldCreateNonManifold?.(a, b, c)) {
      continue;
    }
    raw.push(a, b, c);
    if (raw.length / 3 >= MAX_WRAP_TRIS) break;
  }

  if (raw.length === 0) return EMPTY_PATCH;

  let flip = false;
  let votes = 0;
  for (let i = 0; i < raw.length; i += 3) {
    const n = triangleNormalRaw(
      vertexOf(mesh, newPositions, baseVertexCount, raw[i]),
      vertexOf(mesh, newPositions, baseVertexCount, raw[i + 1]),
      vertexOf(mesh, newPositions, baseVertexCount, raw[i + 2]),
    );
    const d = dot(n, capNormal);
    if (Math.abs(d) < 1e-20) continue;
    votes += d < 0 ? 1 : -1;
  }
  flip = votes > 0;

  const triangles: number[] = [];
  for (let i = 0; i < raw.length; i += 3) {
    if (flip) triangles.push(raw[i], raw[i + 2], raw[i + 1]);
    else triangles.push(raw[i], raw[i + 1], raw[i + 2]);
  }

  return pruneUnused(baseVertexCount, newPositions, triangles);
}

function keepFillTriangle(g: Vec3, pts: Vec3[], capNormal: Vec3, original: Vec3[][], voxel: number): boolean {
  let distOrig = Infinity;
  for (const tri of original) {
    const d = pointTriangleDist(g, tri[0], tri[1], tri[2]);
    if (d < distOrig) distOrig = d;
  }
  const inside = pointInLoop(g, pts, capNormal);
  if (inside && distOrig > voxel * 0.22) return true;
  if (distOrig > voxel * 0.7) return true;
  return false;
}

function pointInLoop(p: Vec3, pts: Vec3[], normal: Vec3): boolean {
  const basis = planeBasis(pts[0], normal);
  const q = projectToPlane(basis, p);
  const poly = pts.map((pt) => projectToPlane(basis, pt));
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const yi = poly[i][1];
    const yj = poly[j][1];
    if (yi > q[1] !== yj > q[1]) {
      const x = ((poly[j][0] - poly[i][0]) * (q[1] - yi)) / (yj - yi + 1e-30) + poly[i][0];
      if (q[0] < x) inside = !inside;
    }
  }
  return inside;
}

function vertexOf(mesh: MeshData, extra: number[], base: number, id: number): Vec3 {
  if (id < base) return vertexAt(mesh.positions, id);
  const o = (id - base) * 3;
  return [extra[o], extra[o + 1], extra[o + 2]];
}

function pruneUnused(base: number, newPositions: number[], triangles: number[]): CapPatch {
  const used = new Set<number>();
  for (const id of triangles) used.add(id);
  const remap = new Map<number, number>();
  const compact: number[] = [];
  const extra = newPositions.length / 3;
  for (let i = 0; i < extra; i++) {
    const global = base + i;
    if (!used.has(global)) continue;
    remap.set(global, base + compact.length / 3);
    compact.push(newPositions[i * 3], newPositions[i * 3 + 1], newPositions[i * 3 + 2]);
  }
  const out: number[] = [];
  for (const id of triangles) out.push(remap.get(id) ?? id);
  return { newPositions: compact, triangles: out };
}

function clampi(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v | 0));
}
