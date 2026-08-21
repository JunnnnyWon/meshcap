import { traceOpenChains } from './boundary.ts';
import { mergeVertexGroups } from './compact.ts';
import { hash3, IntHashTable } from './intHash.ts';
import { buildTopology } from './halfEdge.ts';
import { EdgeIncidence } from './incidence.ts';
import { dot, length, normalize, sub, triangleNormalRaw, vertexAt, type Vec3 } from './geom.ts';
import { computeBounds, type MeshData } from './types.ts';
import { UnionFind } from './unionFind.ts';

export interface GapCloseResult {
  mesh: MeshData;
  /** 끝점끼리 붙인 횟수. */
  mergedPairs: number;
  /** 끝점을 맞은편 에지에 스냅한 횟수. */
  snappedToEdge: number;
}

const DEFAULT_EDGE_MULTIPLE = 4;
const DEFAULT_DIAGONAL_CAP = 0.01;
/** 비다양체 분리로 복제한 정점은 좌표가 완전히 같다. 그 쌍은 다시 붙이지 않는다. */
const COINCIDENT_EPS = 1e-18;

const MAX_CYCLES = 8;
const SNAPS_PER_CYCLE = 2;

/**
 * 열린 테두리 끝점을 가까운 끝점·에지에 붙여 닫힌 루프로 승격한다.
 *
 * Borodin et al. 2002의 점진 갭 클로징을 브라우저용으로 줄인 것이다. 끝점-끝점
 * 병합, 마주 보는 경계 에지 지퍼, 끝점-에지 스냅을 이 순서로 반복한다. 평균
 * 법선이 반대인 쌍과 비다양체를 만드는 쌍은 건너뛴다.
 */
export function closeGaps(mesh: MeshData): GapCloseResult {
  let working = mesh;
  let mergedPairs = 0;
  let snappedToEdge = 0;

  for (let cycle = 0; cycle < MAX_CYCLES; cycle++) {
    const topology = buildTopology(working);
    if (topology.boundaryEdgeCount === 0) break;

    const incidence = new EdgeIncidence(working);
    const epsilon = gapEpsilon(working, incidence.meanLength);
    if (epsilon <= 0) break;

    const chains = traceOpenChains(topology);
    if (chains.length > 0) {
      const endpoints = collectEndpoints(working, chains, topology);
      const pairs = matchEndpointPairs(working, endpoints, epsilon, incidence);
      if (pairs.length > 0) {
        working = mergeVertexGroups(working, groupsFromPairs(pairs, working.positions.length / 3));
        mergedPairs += pairs.length;
        continue;
      }
    }

    const zipped = zipOverlappingEdges(working, epsilon, incidence, {});
    if (zipped.count > 0) {
      working = zipped.mesh;
      mergedPairs += zipped.count;
      continue;
    }

    const snap = snapEndpointsToEdges(working, epsilon, SNAPS_PER_CYCLE);
    if (snap.count > 0) {
      working = snap.mesh;
      snappedToEdge += snap.count;
      continue;
    }

    break;
  }

  return { mesh: working, mergedPairs, snappedToEdge };
}

function gapEpsilon(mesh: MeshData, meanEdge: number): number {
  const diagonal = computeBounds(mesh.positions).diagonal;
  const fromEdge = meanEdge * DEFAULT_EDGE_MULTIPLE;
  const fromBox = diagonal * DEFAULT_DIAGONAL_CAP;
  if (fromEdge <= 0) return fromBox;
  if (fromBox <= 0) return fromEdge;
  return Math.min(fromEdge, fromBox);
}

interface Endpoint {
  vertex: number;
  chain: number;
  normal: Vec3;
}

function collectEndpoints(
  mesh: MeshData,
  chains: { vertices: number[] }[],
  topology: ReturnType<typeof buildTopology>,
): Endpoint[] {
  const faceNormal = (face: number): Vec3 => {
    const o = face * 3;
    const a = vertexAt(mesh.positions, mesh.indices[o]);
    const b = vertexAt(mesh.positions, mesh.indices[o + 1]);
    const c = vertexAt(mesh.positions, mesh.indices[o + 2]);
    return normalize(triangleNormalRaw(a, b, c));
  };

  const endpoints: Endpoint[] = [];
  for (let c = 0; c < chains.length; c++) {
    const verts = chains[c].vertices;
    const ends = verts.length === 1 ? [verts[0]] : [verts[0], verts[verts.length - 1]];
    for (const vertex of ends) {
      let nx = 0;
      let ny = 0;
      let nz = 0;
      let found = 0;
      for (let i = 0; i < topology.boundaryFrom.length; i++) {
        if (topology.boundaryFrom[i] !== vertex && topology.boundaryTo[i] !== vertex) continue;
        const n = faceNormal(topology.boundaryFace[i]);
        nx += n[0];
        ny += n[1];
        nz += n[2];
        found++;
      }
      endpoints.push({
        vertex,
        chain: c,
        normal: found > 0 ? normalize([nx, ny, nz]) : [0, 0, 0],
      });
    }
  }
  return endpoints;
}

function matchEndpointPairs(
  mesh: MeshData,
  endpoints: Endpoint[],
  epsilon: number,
  incidence: EdgeIncidence,
): [number, number][] {
  const n = endpoints.length;
  if (n < 2) return [];

  const used = new Uint8Array(n);
  const cell = Math.max(epsilon, 1e-12);
  const table = new IntHashTable(n);
  const positions = mesh.positions;

  for (let i = 0; i < n; i++) {
    const o = endpoints[i].vertex * 3;
    const ix = Math.floor(positions[o] / cell);
    const iy = Math.floor(positions[o + 1] / cell);
    const iz = Math.floor(positions[o + 2] / cell);
    table.insert(hash3(ix, iy, iz), i);
  }

  const neighbors = buildNeighbors(mesh);
  const pairs: [number, number][] = [];
  const eps2 = epsilon * epsilon;

  for (let i = 0; i < n; i++) {
    if (used[i]) continue;
    const a = endpoints[i];
    const ao = a.vertex * 3;
    const ax = positions[ao];
    const ay = positions[ao + 1];
    const az = positions[ao + 2];
    const ix = Math.floor(ax / cell);
    const iy = Math.floor(ay / cell);
    const iz = Math.floor(az / cell);

    let best = -1;
    let bestD2 = eps2;

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (let cand = table.first(hash3(ix + dx, iy + dy, iz + dz)); cand >= 0; cand = table.after(cand)) {
            if (cand === i || used[cand]) continue;
            const b = endpoints[cand];
            if (b.vertex === a.vertex) continue;
            const bo = b.vertex * 3;
            const ddx = positions[bo] - ax;
            const ddy = positions[bo + 1] - ay;
            const ddz = positions[bo + 2] - az;
            const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
            if (d2 < COINCIDENT_EPS || d2 > bestD2) continue;
            if (dot(a.normal, b.normal) < -0.1) continue;
            if (mergeWouldStack(a.vertex, b.vertex, neighbors, incidence)) continue;
            bestD2 = d2;
            best = cand;
          }
        }
      }
    }

    if (best < 0) continue;
    used[i] = 1;
    used[best] = 1;
    pairs.push([a.vertex, endpoints[best].vertex]);
  }

  return pairs;
}

function groupsFromPairs(pairs: [number, number][], vertexCount: number): number[][] {
  const uf = new UnionFind(vertexCount);
  for (const [a, b] of pairs) uf.union(a, b);
  const buckets = new Map<number, number[]>();
  const seen = new Set<number>();
  for (const [a, b] of pairs) {
    for (const v of [a, b]) {
      if (seen.has(v)) continue;
      seen.add(v);
      const root = uf.find(v);
      const list = buckets.get(root);
      if (list) list.push(v);
      else buckets.set(root, [v]);
    }
  }
  return [...buckets.values()].filter((g) => g.length >= 2);
}

function buildNeighbors(mesh: MeshData): Set<number>[] {
  const V = mesh.positions.length / 3;
  const neighbors: Set<number>[] = Array.from({ length: V }, () => new Set());
  const { indices } = mesh;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t];
    const b = indices[t + 1];
    const c = indices[t + 2];
    neighbors[a].add(b);
    neighbors[a].add(c);
    neighbors[b].add(a);
    neighbors[b].add(c);
    neighbors[c].add(a);
    neighbors[c].add(b);
  }
  return neighbors;
}

function mergeWouldStack(
  a: number,
  b: number,
  neighbors: Set<number>[],
  incidence: EdgeIncidence,
): boolean {
  for (const n of neighbors[a]) {
    if (n === b) continue;
    const stacked = incidence.count(a, n) + (neighbors[b].has(n) ? incidence.count(b, n) : 0);
    if (stacked > 2) return true;
  }
  return false;
}

/**
 * 마주 보고 거의 겹친 경계 에지 쌍을 지퍼로 붙인다.
 * 단순화로 생긴 긴 찢어짐은 끝점만으로는 안 닫히고, 변의 중간이 맞닿아 있다.
 */
export function zipLeftoverSlits(mesh: MeshData): { mesh: MeshData; count: number } {
  const incidence = new EdgeIncidence(mesh);
  const diagonal = computeBounds(mesh.positions).diagonal;
  const epsilon = Math.min(incidence.meanLength * 4, diagonal * 0.04);
  if (epsilon <= 0) return { mesh, count: 0 };
  return zipOverlappingEdges(mesh, epsilon, incidence, {
    midMultiple: 2.4,
    lengthRatio: 2.2,
    parallelDot: 0.88,
    inPlaneSlit: true,
  });
}

function zipOverlappingEdges(
  mesh: MeshData,
  epsilon: number,
  incidence: EdgeIncidence,
  opts: { midMultiple?: number; lengthRatio?: number; parallelDot?: number; inPlaneSlit?: boolean },
): { mesh: MeshData; count: number } {
  const topology = buildTopology(mesh);
  const n = topology.fillFrom.length;
  if (n < 2) return { mesh, count: 0 };

  const eps2 = epsilon * epsilon;
  const cell = Math.max(epsilon, 1e-12);
  const positions = mesh.positions;
  const V = positions.length / 3;
  const table = new IntHashTable(n);
  const segs: { a: number; b: number; face: number }[] = [];
  const seen = new Set<number>();

  for (let i = 0; i < n; i++) {
    const a = topology.fillFrom[i];
    const b = topology.fillTo[i];
    const key = a < b ? a * V + b : b * V + a;
    if (seen.has(key)) continue;
    seen.add(key);
    const id = segs.length;
    segs.push({ a, b, face: topology.fillFace[i] });
    const ao = a * 3;
    const bo = b * 3;
    const mx = (positions[ao] + positions[bo]) * 0.5;
    const my = (positions[ao + 1] + positions[bo + 1]) * 0.5;
    const mz = (positions[ao + 2] + positions[bo + 2]) * 0.5;
    table.insert(hash3(Math.floor(mx / cell), Math.floor(my / cell), Math.floor(mz / cell)), id);
  }

  const used = new Uint8Array(segs.length);
  const neighbors = buildNeighbors(mesh);
  const pairs: [number, number][] = [];

  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    const s = segs[i];
    const pa = vertexAt(positions, s.a);
    const pb = vertexAt(positions, s.b);
    const mx = (pa[0] + pb[0]) * 0.5;
    const my = (pa[1] + pb[1]) * 0.5;
    const mz = (pa[2] + pb[2]) * 0.5;
    const ix = Math.floor(mx / cell);
    const iy = Math.floor(my / cell);
    const iz = Math.floor(mz / cell);

    let best = -1;
    let bestD2 = eps2 * 4;
    let bestPairs: [number, number][] = [];

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (let cand = table.first(hash3(ix + dx, iy + dy, iz + dz)); cand >= 0; cand = table.after(cand)) {
            if (cand === i || used[cand]) continue;
            const o = segs[cand];
            if (o.a === s.a || o.a === s.b || o.b === s.a || o.b === s.b) continue;
            const pc = vertexAt(positions, o.a);
            const pd = vertexAt(positions, o.b);
            const t1 = sub(pb, pa);
            const t2 = sub(pd, pc);
            const len1 = Math.hypot(t1[0], t1[1], t1[2]);
            const len2 = Math.hypot(t2[0], t2[1], t2[2]);
            if (len1 < 1e-18 || len2 < 1e-18) continue;
            const long = Math.max(len1, len2);
            const short = Math.min(len1, len2);
            if (long / short > (opts.lengthRatio ?? 2.0)) continue;
            const n1 = [t1[0] / len1, t1[1] / len1, t1[2] / len1] as Vec3;
            const n2 = [t2[0] / len2, t2[1] / len2, t2[2] / len2] as Vec3;
            if (Math.abs(dot(n1, n2)) < (opts.parallelDot ?? 0.85)) continue;
            const mq: Vec3 = [(pc[0] + pd[0]) * 0.5, (pc[1] + pd[1]) * 0.5, (pc[2] + pd[2]) * 0.5];
            const midLimit = short * (opts.midMultiple ?? 0.5);
            if (dist2([mx, my, mz], mq) > midLimit * midLimit) continue;
            if (opts.inPlaneSlit) {
              const fn1 = faceNormalAt(mesh, s.face);
              const fn2 = faceNormalAt(mesh, o.face);
              if (dot(fn1, fn2) < 0.3) continue;
              const gap = normalize(sub(mq, [mx, my, mz]));
              if (length(gap) < 1e-18) continue;
              if (Math.abs(dot(gap, fn1)) > 0.5 || Math.abs(dot(gap, fn2)) > 0.5) continue;
            }
            const dAd = dist2(pa, pd);
            const dBc = dist2(pb, pc);
            const dAc = dist2(pa, pc);
            const dBd = dist2(pb, pd);
            const anti = dAd + dBc;
            const other = dAc + dBd;
            if (anti <= other) {
              if (dAd > eps2 || dBc > eps2) continue;
              if (dAd < COINCIDENT_EPS && dBc < COINCIDENT_EPS) continue;
              if (mergeWouldStack(s.a, o.b, neighbors, incidence)) continue;
              if (mergeWouldStack(s.b, o.a, neighbors, incidence)) continue;
              if (anti >= bestD2) continue;
              bestD2 = anti;
              best = cand;
              bestPairs = [
                [s.a, o.b],
                [s.b, o.a],
              ];
            } else {
              if (dAc > eps2 || dBd > eps2) continue;
              if (dAc < COINCIDENT_EPS && dBd < COINCIDENT_EPS) continue;
              if (mergeWouldStack(s.a, o.a, neighbors, incidence)) continue;
              if (mergeWouldStack(s.b, o.b, neighbors, incidence)) continue;
              if (other >= bestD2) continue;
              bestD2 = other;
              best = cand;
              bestPairs = [
                [s.a, o.a],
                [s.b, o.b],
              ];
            }
          }
        }
      }
    }

    if (best < 0) continue;
    used[i] = 1;
    used[best] = 1;
    for (const pair of bestPairs) pairs.push(pair);
  }

  if (pairs.length === 0) return { mesh, count: 0 };
  return {
    mesh: mergeVertexGroups(mesh, groupsFromPairs(pairs, V)),
    count: pairs.length,
  };
}

function faceNormalAt(mesh: MeshData, face: number): Vec3 {
  const o = face * 3;
  return normalize(
    triangleNormalRaw(
      vertexAt(mesh.positions, mesh.indices[o]),
      vertexAt(mesh.positions, mesh.indices[o + 1]),
      vertexAt(mesh.positions, mesh.indices[o + 2]),
    ),
  );
}

function dist2(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

/**
 * 남은 열린 끝점을 다른 경계 에지의 가장 가까운 지점에 붙인다.
 * 에지를 끝점으로 분할한 뒤 두 정점을 병합한다.
 */
function snapEndpointsToEdges(mesh: MeshData, epsilon: number, maxSnaps: number): { mesh: MeshData; count: number } {
  let working = mesh;
  let count = 0;

  for (let iter = 0; iter < maxSnaps; iter++) {
    const hit = findBestSnap(working, epsilon);
    if (!hit) break;
    const split = splitBoundaryEdge(working, hit.from, hit.to, hit.t);
    if (!split) break;
    const newVertex = split.positions.length / 3 - 1;
    working = mergeVertexGroups(split, [[hit.vertex, newVertex]]);
    count++;
  }

  return { mesh: working, count };
}

function findBestSnap(
  mesh: MeshData,
  epsilon: number,
): { vertex: number; from: number; to: number; t: number } | null {
  const topology = buildTopology(mesh);
  const chains = traceOpenChains(topology);
  if (chains.length === 0) return null;

  const ends: number[] = [];
  const seen = new Set<number>();
  for (const chain of chains) {
    const verts = chain.vertices;
    for (const v of [verts[0], verts[verts.length - 1]]) {
      if (seen.has(v)) continue;
      seen.add(v);
      ends.push(v);
    }
  }

  const segments: { from: number; to: number }[] = [];
  const segSeen = new Set<number>();
  const V = mesh.positions.length / 3;
  for (let i = 0; i < topology.fillFrom.length; i++) {
    const a = topology.fillFrom[i];
    const b = topology.fillTo[i];
    const key = a < b ? a * V + b : b * V + a;
    if (segSeen.has(key)) continue;
    segSeen.add(key);
    segments.push({ from: a, to: b });
  }
  if (segments.length === 0 || ends.length === 0) return null;

  const eps2 = epsilon * epsilon;
  const cell = Math.max(epsilon, 1e-12);
  const table = new IntHashTable(segments.length);
  for (let s = 0; s < segments.length; s++) {
    const a = vertexAt(mesh.positions, segments[s].from);
    const b = vertexAt(mesh.positions, segments[s].to);
    table.insert(
      hash3(
        Math.floor((a[0] + b[0]) * 0.5 / cell),
        Math.floor((a[1] + b[1]) * 0.5 / cell),
        Math.floor((a[2] + b[2]) * 0.5 / cell),
      ),
      s,
    );
  }

  let bestP = -1;
  let bestSeg = -1;
  let bestT = 0;
  let bestD2 = eps2;

  for (const p of ends) {
    const pp = vertexAt(mesh.positions, p);
    const ix = Math.floor(pp[0] / cell);
    const iy = Math.floor(pp[1] / cell);
    const iz = Math.floor(pp[2] / cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (let cand = table.first(hash3(ix + dx, iy + dy, iz + dz)); cand >= 0; cand = table.after(cand)) {
            const seg = segments[cand];
            if (seg.from === p || seg.to === p) continue;
            const a = vertexAt(mesh.positions, seg.from);
            const b = vertexAt(mesh.positions, seg.to);
            const { t, d2 } = projectToSegment(pp, a, b);
            if (d2 < COINCIDENT_EPS || d2 >= bestD2) continue;
            if (t < 0.05 || t > 0.95) continue;
            bestD2 = d2;
            bestP = p;
            bestSeg = cand;
            bestT = t;
          }
        }
      }
    }
  }

  if (bestP < 0 || bestSeg < 0) return null;
  const seg = segments[bestSeg];
  return { vertex: bestP, from: seg.from, to: seg.to, t: bestT };
}

function projectToSegment(p: Vec3, a: Vec3, b: Vec3): { t: number; d2: number } {
  const ab = sub(b, a);
  const ap = sub(p, a);
  const denom = dot(ab, ab);
  const t = denom > 0 ? Math.max(0, Math.min(1, dot(ap, ab) / denom)) : 0;
  const q: Vec3 = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
  const d = sub(p, q);
  return { t, d2: d[0] * d[0] + d[1] * d[1] + d[2] * d[2] };
}

/**
 * 경계 에지 (u,v)를 비율 t 지점에서 나눠 새 정점을 넣고, 그 에지를 쓰던 면을
 * 두 삼각형으로 바꾼다. 새 정점은 항상 배열 끝에 붙는다.
 */
function splitBoundaryEdge(mesh: MeshData, u: number, v: number, t: number): MeshData | null {
  const a = vertexAt(mesh.positions, u);
  const b = vertexAt(mesh.positions, v);
  const p: Vec3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const newIndex = mesh.positions.length / 3;
  const positions = new Float32Array(mesh.positions.length + 3);
  positions.set(mesh.positions);
  positions[newIndex * 3] = p[0];
  positions[newIndex * 3 + 1] = p[1];
  positions[newIndex * 3 + 2] = p[2];

  const faces: number[] = [];
  const { indices } = mesh;
  for (let t0 = 0; t0 < indices.length; t0 += 3) {
    const ia = indices[t0];
    const ib = indices[t0 + 1];
    const ic = indices[t0 + 2];
    const hasU = ia === u || ib === u || ic === u;
    const hasV = ia === v || ib === v || ic === v;
    if (hasU && hasV) faces.push(t0 / 3);
  }
  if (faces.length === 0) return null;

  const out: number[] = [];
  const skip = new Set(faces);
  for (let t0 = 0; t0 < indices.length; t0 += 3) {
    if (skip.has(t0 / 3)) continue;
    out.push(indices[t0], indices[t0 + 1], indices[t0 + 2]);
  }

  for (const face of faces) {
    const o = face * 3;
    const tri = [indices[o], indices[o + 1], indices[o + 2]];
    const w = tri.find((x) => x !== u && x !== v);
    if (w === undefined) continue;
    // 원래 감는 방향을 유지한 채 (u,v) 자리에 새 정점을 끼운다.
    for (let k = 0; k < 3; k++) {
      const x = tri[k];
      const y = tri[(k + 1) % 3];
      if ((x === u && y === v) || (x === v && y === u)) {
        const z = tri[(k + 2) % 3];
        out.push(x, newIndex, z);
        out.push(newIndex, y, z);
        break;
      }
    }
  }

  return { positions, indices: new Uint32Array(out) };
}
