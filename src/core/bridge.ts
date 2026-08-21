import { hash3, IntHashTable } from './intHash.ts';
import { buildTopology } from './halfEdge.ts';
import { closesVisibleTear, EdgeIncidence } from './incidence.ts';
import { computeBounds, type MeshData } from './types.ts';
import { dot, length, normalize, sub, triangleNormalRaw, vertexAt, type Vec3 } from './geom.ts';

export interface BridgeResult {
  mesh: MeshData;
  addedTriangles: number;
}

const LENGTH_RATIO = 3;
const LOCAL_MULTIPLE = 8;
const DIAGONAL_CAP = 0.04;
const LIP_PARALLEL = 0.7;
const LIP_NORMAL = 0.25;
const LIP_INPLANE = 0.55;
const LIP_LOCAL = 24;
const LIP_DIAGONAL = 0.14;
const VERT_LOCAL = 16;

/**
 * 루프로 안 잡히는 1-face 에지를 가까운 짝과 이어 찢김을 메운다.
 *
 * 방향 있는 테두리 순회는 정점을 공유해도 사슬을 놓치고, 한 변만 남은
 * 균열은 minLength=3 구멍 목록에 아예 안 오른다. 같은 정점을 쓰는 두 변은
 * 삼각형으로, 가까이 마주 보는 두 변은 사각형으로 잇는다.
 */
export function bridgeLeftoverTears(mesh: MeshData): BridgeResult {
  const topology = buildTopology(mesh);
  if (topology.fillFrom.length === 0) return { mesh, addedTriangles: 0 };

  const incidence = new EdgeIncidence(mesh);
  const bounds = computeBounds(mesh.positions);
  const maxDistCap = bounds.diagonal * DIAGONAL_CAP;
  if (maxDistCap <= 0) return { mesh, addedTriangles: 0 };

  const segs = uniqueFillEdges(topology.fillFrom, topology.fillTo);
  if (segs.length === 0) return { mesh, addedTriangles: 0 };

  const used = new Uint8Array(segs.length);
  const added: number[] = [];
  const faceOf = edgeFaceLookup(mesh, segs);

  pairSharedVertices(mesh, segs, used, incidence, faceOf, added);
  pairNearbyEdges(mesh, segs, used, incidence, faceOf, added, maxDistCap);
  pairParallelLips(mesh, segs, used, incidence, faceOf, added, bounds.diagonal * LIP_DIAGONAL);
  pairNearestVertex(mesh, segs, used, incidence, faceOf, added, bounds.diagonal * LIP_DIAGONAL);

  if (added.length === 0) return { mesh, addedTriangles: 0 };
  const indices = new Uint32Array(mesh.indices.length + added.length);
  indices.set(mesh.indices);
  indices.set(added, mesh.indices.length);
  return { mesh: { positions: mesh.positions, indices }, addedTriangles: added.length / 3 };
}

function uniqueFillEdges(from: Uint32Array, to: Uint32Array): [number, number][] {
  const segs: [number, number][] = [];
  const seen = new Set<string>();
  for (let i = 0; i < from.length; i++) {
    const a = from[i];
    const b = to[i];
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    segs.push([a, b]);
  }
  return segs;
}

function edgeFaceLookup(mesh: MeshData, segs: [number, number][]): Map<string, Vec3> {
  const need = new Set<string>();
  for (const [a, b] of segs) need.add(a < b ? `${a}:${b}` : `${b}:${a}`);
  const out = new Map<string, Vec3>();
  const { indices, positions } = mesh;
  for (let t = 0; t < indices.length; t += 3) {
    const vs = [indices[t], indices[t + 1], indices[t + 2]];
    const pts = [vertexAt(positions, vs[0]), vertexAt(positions, vs[1]), vertexAt(positions, vs[2])];
    const n = normalize(triangleNormalRaw(pts[0], pts[1], pts[2]));
    for (let k = 0; k < 3; k++) {
      const a = vs[k];
      const b = vs[(k + 1) % 3];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (!need.has(key) || out.has(key)) continue;
      out.set(key, n);
    }
  }
  return out;
}

function keyOf(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function tryAdd(
  a: number,
  b: number,
  c: number,
  incidence: EdgeIncidence,
  added: number[],
): boolean {
  if (a === b || b === c || c === a) return false;
  if (!closesVisibleTear(incidence.count(a, b), incidence.count(b, c), incidence.count(c, a))) return false;
  added.push(a, b, c);
  incidence.addTriangle(a, b, c);
  return true;
}

function winding(a: number, b: number, c: number, faceOf: Map<string, Vec3>, mesh: MeshData): [number, number, number] {
  const n = triangleNormalRaw(vertexAt(mesh.positions, a), vertexAt(mesh.positions, b), vertexAt(mesh.positions, c));
  const ref = faceOf.get(keyOf(a, b));
  if (ref && dot(n, ref) > 0) return [a, c, b];
  return [a, b, c];
}

function pairSharedVertices(
  mesh: MeshData,
  segs: [number, number][],
  used: Uint8Array,
  incidence: EdgeIncidence,
  faceOf: Map<string, Vec3>,
  added: number[],
): void {
  const at = new Map<number, number[]>();
  for (let i = 0; i < segs.length; i++) {
    const [a, b] = segs[i];
    let la = at.get(a);
    if (!la) {
      la = [];
      at.set(a, la);
    }
    la.push(i);
    let lb = at.get(b);
    if (!lb) {
      lb = [];
      at.set(b, lb);
    }
    lb.push(i);
  }

  for (const ids of at.values()) {
    if (ids.length < 2) continue;
    for (let i = 0; i < ids.length; i++) {
      const s = ids[i];
      if (used[s]) continue;
      let best = -1;
      let bestD = Infinity;
      const [sa, sb] = segs[s];
      const midS = midpoint(mesh, sa, sb);
      for (let j = 0; j < ids.length; j++) {
        const o = ids[j];
        if (o === s || used[o]) continue;
        const [oa, ob] = segs[o];
        const verts = new Set([sa, sb, oa, ob]);
        if (verts.size !== 3) continue;
        const midO = midpoint(mesh, oa, ob);
        const d = length(sub(midS, midO));
        if (d < bestD) {
          bestD = d;
          best = o;
        }
      }
      if (best < 0) continue;
      const verts = [...new Set([sa, sb, segs[best][0], segs[best][1]])];
      const [a, b, c] = winding(verts[0], verts[1], verts[2], faceOf, mesh);
      if (!tryAdd(a, b, c, incidence, added)) continue;
      used[s] = 1;
      used[best] = 1;
    }
  }
}

function pairNearbyEdges(
  mesh: MeshData,
  segs: [number, number][],
  used: Uint8Array,
  incidence: EdgeIncidence,
  faceOf: Map<string, Vec3>,
  added: number[],
  maxDistCap: number,
): void {
  const n = segs.length;
  const mids: Vec3[] = [];
  const lens: number[] = [];
  const cell = Math.max(maxDistCap, 1e-12);
  const table = new IntHashTable(n);
  for (let i = 0; i < n; i++) {
    const [a, b] = segs[i];
    const pa = vertexAt(mesh.positions, a);
    const pb = vertexAt(mesh.positions, b);
    const mid: Vec3 = [(pa[0] + pb[0]) * 0.5, (pa[1] + pb[1]) * 0.5, (pa[2] + pb[2]) * 0.5];
    mids.push(mid);
    lens.push(length(sub(pb, pa)));
    table.insert(hash3(Math.floor(mid[0] / cell), Math.floor(mid[1] / cell), Math.floor(mid[2] / cell)), i);
  }

  for (let i = 0; i < n; i++) {
    if (used[i]) continue;
    const [ia, ib] = segs[i];
    const mid = mids[i];
    const ix = Math.floor(mid[0] / cell);
    const iy = Math.floor(mid[1] / cell);
    const iz = Math.floor(mid[2] / cell);
    let best = -1;
    let bestD = maxDistCap * maxDistCap;

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (let cand = table.first(hash3(ix + dx, iy + dy, iz + dz)); cand >= 0; cand = table.after(cand)) {
            if (cand === i || used[cand]) continue;
            const [ca, cb] = segs[cand];
            if (ca === ia || ca === ib || cb === ia || cb === ib) continue;
            const long = Math.max(lens[i], lens[cand]);
            const short = Math.min(lens[i], lens[cand]);
            if (short < 1e-18 || long / short > LENGTH_RATIO) continue;
            const d2 = dist2(mid, mids[cand]);
            const limit = Math.min(maxDistCap, LOCAL_MULTIPLE * Math.max(lens[i], lens[cand]));
            if (d2 > limit * limit || d2 >= bestD) continue;
            const n1 = faceOf.get(keyOf(ia, ib));
            const n2 = faceOf.get(keyOf(ca, cb));
            if (n1 && n2 && dot(n1, n2) < -0.25) continue;
            bestD = d2;
            best = cand;
          }
        }
      }
    }

    if (best < 0) continue;
    const [ja, jb] = segs[best];
    const pa = vertexAt(mesh.positions, ia);
    const pb = vertexAt(mesh.positions, ib);
    const pc = vertexAt(mesh.positions, ja);
    const pd = vertexAt(mesh.positions, jb);
    const anti = dist2(pa, pd) + dist2(pb, pc);
    const same = dist2(pa, pc) + dist2(pb, pd);
    const pairs: [number, number, number][] =
      anti <= same
        ? [winding(ia, ib, jb, faceOf, mesh), winding(ia, jb, ja, faceOf, mesh)]
        : [winding(ia, ib, ja, faceOf, mesh), winding(ib, jb, ja, faceOf, mesh)];

    let kept = 0;
    for (const [a, b, c] of pairs) {
      if (tryAdd(a, b, c, incidence, added)) kept++;
    }
    if (kept === 0) continue;
    used[i] = 1;
    used[best] = 1;
  }
}

/**
 * 멀리 떨어진 평행 입술. 같은 곡면 위의 찢김은 간격이 면에 거의 눕고,
 * 머리카락처럼 다른 부피는 간격이 법선 쪽이라 건너뛴다.
 */
function pairParallelLips(
  mesh: MeshData,
  segs: [number, number][],
  used: Uint8Array,
  incidence: EdgeIncidence,
  faceOf: Map<string, Vec3>,
  added: number[],
  maxDistCap: number,
): void {
  if (maxDistCap <= 0) return;
  const n = segs.length;
  const mids: Vec3[] = [];
  const dirs: Vec3[] = [];
  const lens: number[] = [];
  const cell = Math.max(maxDistCap, 1e-12);
  const table = new IntHashTable(n);

  for (let i = 0; i < n; i++) {
    const [a, b] = segs[i];
    const pa = vertexAt(mesh.positions, a);
    const pb = vertexAt(mesh.positions, b);
    const mid: Vec3 = [(pa[0] + pb[0]) * 0.5, (pa[1] + pb[1]) * 0.5, (pa[2] + pb[2]) * 0.5];
    const d = sub(pb, pa);
    const len = length(d);
    mids.push(mid);
    dirs.push(len > 1e-18 ? [d[0] / len, d[1] / len, d[2] / len] : [1, 0, 0]);
    lens.push(len);
    table.insert(hash3(Math.floor(mid[0] / cell), Math.floor(mid[1] / cell), Math.floor(mid[2] / cell)), i);
  }

  for (let i = 0; i < n; i++) {
    if (used[i]) continue;
    const [ia, ib] = segs[i];
    const n1 = faceOf.get(keyOf(ia, ib));
    if (!n1) continue;
    const mid = mids[i];
    const ix = Math.floor(mid[0] / cell);
    const iy = Math.floor(mid[1] / cell);
    const iz = Math.floor(mid[2] / cell);
    let best = -1;
    let bestD = maxDistCap * maxDistCap;

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (let cand = table.first(hash3(ix + dx, iy + dy, iz + dz)); cand >= 0; cand = table.after(cand)) {
            if (cand === i || used[cand]) continue;
            const [ca, cb] = segs[cand];
            if (ca === ia || ca === ib || cb === ia || cb === ib) continue;
            const n2 = faceOf.get(keyOf(ca, cb));
            if (!n2 || dot(n1, n2) < LIP_NORMAL) continue;
            const long = Math.max(lens[i], lens[cand]);
            const short = Math.min(lens[i], lens[cand]);
            if (short < 1e-18 || long / short > 2.2) continue;
            if (Math.abs(dot(dirs[i], dirs[cand])) < LIP_PARALLEL) continue;
            const d2 = dist2(mid, mids[cand]);
            const limit = Math.min(maxDistCap, LIP_LOCAL * long);
            if (d2 > limit * limit || d2 >= bestD) continue;
            const gap = normalize(sub(mids[cand], mid));
            if (length(gap) < 1e-18) continue;
            if (Math.abs(dot(gap, dirs[i])) > 0.45) continue;
            if (Math.abs(dot(gap, n1)) > LIP_INPLANE) continue;
            if (Math.abs(dot(gap, n2)) > LIP_INPLANE) continue;
            bestD = d2;
            best = cand;
          }
        }
      }
    }

    if (best < 0) continue;
    const [ja, jb] = segs[best];
    const pa = vertexAt(mesh.positions, ia);
    const pb = vertexAt(mesh.positions, ib);
    const pc = vertexAt(mesh.positions, ja);
    const pd = vertexAt(mesh.positions, jb);
    const anti = dist2(pa, pd) + dist2(pb, pc);
    const same = dist2(pa, pc) + dist2(pb, pd);
    const tris: [number, number, number][] =
      anti <= same
        ? [winding(ia, ib, jb, faceOf, mesh), winding(ia, jb, ja, faceOf, mesh)]
        : [winding(ia, ib, ja, faceOf, mesh), winding(ib, jb, ja, faceOf, mesh)];
    let kept = 0;
    for (const [a, b, c] of tris) {
      if (tryAdd(a, b, c, incidence, added)) kept++;
    }
    if (kept === 0) continue;
    used[i] = 1;
    used[best] = 1;
  }
}

function pairNearestVertex(
  mesh: MeshData,
  segs: [number, number][],
  used: Uint8Array,
  incidence: EdgeIncidence,
  faceOf: Map<string, Vec3>,
  added: number[],
  maxDistCap: number,
): void {
  const verts: { v: number; mid: Vec3; n: Vec3 }[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < segs.length; i++) {
    const n = faceOf.get(keyOf(segs[i][0], segs[i][1]));
    if (!n) continue;
    for (const v of segs[i]) {
      if (seen.has(v)) continue;
      seen.add(v);
      verts.push({ v, mid: vertexAt(mesh.positions, v), n });
    }
  }

  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    const [a, b] = segs[i];
    const n1 = faceOf.get(keyOf(a, b));
    if (!n1) continue;
    const mid = midpoint(mesh, a, b);
    const len = length(sub(vertexAt(mesh.positions, b), vertexAt(mesh.positions, a)));
    const limit = Math.min(maxDistCap, VERT_LOCAL * Math.max(len, 1e-12));
    let best = -1;
    let bestD = limit * limit;
    for (const cand of verts) {
      if (cand.v === a || cand.v === b) continue;
      if (dot(n1, cand.n) < LIP_NORMAL) continue;
      const d2 = dist2(mid, cand.mid);
      if (d2 >= bestD) continue;
      const gap = normalize(sub(cand.mid, mid));
      if (Math.abs(dot(gap, n1)) > LIP_INPLANE) continue;
      bestD = d2;
      best = cand.v;
    }
    if (best < 0) continue;
    const [ta, tb, tc] = winding(a, b, best, faceOf, mesh);
    if (!tryAdd(ta, tb, tc, incidence, added)) continue;
    used[i] = 1;
  }
}

function midpoint(mesh: MeshData, a: number, b: number): Vec3 {
  const pa = vertexAt(mesh.positions, a);
  const pb = vertexAt(mesh.positions, b);
  return [(pa[0] + pb[0]) * 0.5, (pa[1] + pb[1]) * 0.5, (pa[2] + pb[2]) * 0.5];
}

function dist2(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}
