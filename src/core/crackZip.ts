import { mergeVertexGroups } from './compact.ts';
import { hash3, IntHashTable } from './intHash.ts';
import { buildTopology } from './halfEdge.ts';
import { EdgeIncidence } from './incidence.ts';
import { type MeshData } from './types.ts';
import { dot, length, normalize, sub, triangleNormalRaw, vertexAt, type Vec3 } from './geom.ts';

export interface CrackZipResult {
  mesh: MeshData;
  zippedCracks: number;
}

export interface LeftoverCrackStats {
  leftoverOneFace: number;
  isolatedTwoVert: number;
  meanEdge: number;
  leftoverPartner025: number;
  leftoverPartner05: number;
  onlyInteriorPartner: number;
  neitherPartner: number;
  medianLeftoverDist: number;
  leftoverDistVsMean: number;
  medianInteriorDist: number;
  interiorDistVsMean: number;
  medianNormalDot: number;
}

const LENGTH_RATIO = 2;
const NORMAL_DOT = 0.5;
const PARALLEL = 0.7;
const DIST_TIGHT = 0.25;
const DIST_WIDE = 0.5;
const MAX_CRACK_ITERS = 320;
const MAX_SPLIT_ITERS = 64;

/**
 * 같은 방향을 보는 1-face 균열끼리만 지퍼로 붙인다.
 * 구멍 입술 짝짓기 게이트는 건드리지 않는다. 면이 둘인 안쪽 에지에는 붙이지 않는다.
 */
export function zipSameOrientationCracks(mesh: MeshData): CrackZipResult {
  let working = mesh;
  let zippedCracks = 0;
  let ratio = DIST_TIGHT;

  for (let i = 0; i < MAX_CRACK_ITERS; i++) {
    const one = zipOneCrack(working, ratio);
    if (!one) {
      if (ratio < DIST_WIDE) {
        ratio = DIST_WIDE;
        continue;
      }
      break;
    }
    working = one;
    zippedCracks++;
  }

  for (let i = 0; i < MAX_SPLIT_ITERS; i++) {
    const one = splitInteriorThenZip(working);
    if (!one) break;
    working = one;
    zippedCracks++;
  }

  return { mesh: working, zippedCracks };
}

export function leftoverCrackStats(mesh: MeshData): LeftoverCrackStats {
  const topology = buildTopology(mesh);
  const leftoverOneFace = topology.fillFrom.length;
  const V = mesh.positions.length / 3;
  const valence = new Uint8Array(V);
  for (let i = 0; i < topology.fillFrom.length; i++) {
    valence[topology.fillFrom[i]]++;
    valence[topology.fillTo[i]]++;
  }
  let isolatedTwoVert = 0;
  const seen = new Set<string>();
  for (let i = 0; i < topology.fillFrom.length; i++) {
    const a = topology.fillFrom[i];
    const b = topology.fillTo[i];
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (valence[a] === 1 && valence[b] === 1) isolatedTwoVert++;
  }

  const incidence = new EdgeIncidence(mesh);
  const lips = collectLeftoverLips(mesh, topology);
  const interiors = collectInteriorEdges(mesh, incidence);
  const leftoverDists: number[] = [];
  const interiorDists: number[] = [];
  const dots: number[] = [];
  let leftoverPartner025 = 0;
  let leftoverPartner05 = 0;
  let onlyInteriorPartner = 0;
  let neitherPartner = 0;
  const cap025 = incidence.meanLength * DIST_TIGHT;
  const cap05 = incidence.meanLength * DIST_WIDE;
  const cell = Math.max(cap05, incidence.meanLength * 0.5, 1e-12);
  const hashedLips = lips.length > 0 ? hashLips(lips, cell) : null;
  const hashedSegs = interiors.length > 0 ? hashInteriorSegs(interiors, cell) : null;

  for (let i = 0; i < lips.length; i++) {
    const a = lips[i];
    let bestLip = Infinity;
    let bestLipDot = -1;
    const ix = Math.floor(a.mid[0] / cell);
    const iy = Math.floor(a.mid[1] / cell);
    const iz = Math.floor(a.mid[2] / cell);
    if (hashedLips) {
      const seen = new Set<number>();
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            for (let cand = hashedLips.table.first(hash3(ix + dx, iy + dy, iz + dz)); cand >= 0; cand = hashedLips.table.after(cand)) {
              const j = hashedLips.lipOf[cand];
              if (j === i || seen.has(j)) continue;
              seen.add(j);
              const b = lips[j];
              if (sharesVertex(a, b) || !passesCrackGates(a, b, Infinity)) continue;
              const dist = segmentDistance(a.pa, a.pb, b.pa, b.pb);
              if (dist < bestLip) {
                bestLip = dist;
                bestLipDot = dot(a.normal, b.normal);
              }
            }
          }
        }
      }
    }
    let bestInterior = Infinity;
    if (hashedSegs) {
      const seen = new Set<number>();
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            for (let cand = hashedSegs.table.first(hash3(ix + dx, iy + dy, iz + dz)); cand >= 0; cand = hashedSegs.table.after(cand)) {
              const seg = interiors[hashedSegs.segOf[cand]];
              const id = seg.u < seg.v ? seg.u * 1e9 + seg.v : seg.v * 1e9 + seg.u;
              if (seen.has(id) || seg.u === a.a || seg.v === a.a || seg.u === a.b || seg.v === a.b) continue;
              seen.add(id);
              const uv = sub(seg.pv, seg.pu);
              if (Math.abs(edgeAlign(a.dir, uv)) < PARALLEL) continue;
              const dist = segmentDistance(a.pa, a.pb, seg.pu, seg.pv);
              if (dist < bestInterior) bestInterior = dist;
            }
          }
        }
      }
    }
    if (bestLip < Infinity) {
      leftoverDists.push(bestLip);
      dots.push(bestLipDot);
    }
    if (bestInterior < Infinity) interiorDists.push(bestInterior);
    if (bestLip <= cap025) leftoverPartner025++;
    else if (bestLip <= cap05) leftoverPartner05++;
    else if (bestInterior <= cap05) onlyInteriorPartner++;
    else neitherPartner++;
  }

  return {
    leftoverOneFace,
    isolatedTwoVert,
    meanEdge: incidence.meanLength,
    leftoverPartner025,
    leftoverPartner05,
    onlyInteriorPartner,
    neitherPartner,
    medianLeftoverDist: median(leftoverDists),
    leftoverDistVsMean: incidence.meanLength > 0 ? median(leftoverDists) / incidence.meanLength : Infinity,
    medianInteriorDist: median(interiorDists),
    interiorDistVsMean: incidence.meanLength > 0 ? median(interiorDists) / incidence.meanLength : Infinity,
    medianNormalDot: median(dots),
  };
}

export interface LeftoverNeitherStats {
  neither: number;
  faces221: number;
  isolatedTwoVert: number;
  chain1: number;
  chain2: number;
  chain3plus: number;
  medianChain: number;
  medianLenVsMean: number;
  short035: number;
  medianLeftoverAny: number;
  leftoverAnyVsMean: number;
  medianInteriorAny: number;
  interiorAnyVsMean: number;
  medianCentroidFace: number;
  centroidFaceVsMean: number;
  centroidOnFace: number;
  interiorNearNotParallel: number;
  leftoverNearGateFail: number;
  leftoverOnlySameChain: number;
  bothFar: number;
}

/**
 * leftoverCrackStats의 neither 버킷을 게이트 없이 다시 잰다.
 */
export function leftoverNeitherStats(mesh: MeshData): LeftoverNeitherStats {
  const topology = buildTopology(mesh);
  const incidence = new EdgeIncidence(mesh);
  const lips = collectLeftoverLips(mesh, topology);
  const interiors = collectInteriorEdges(mesh, incidence);
  const chains = leftoverChainLengths(lips);
  const cap05 = incidence.meanLength * DIST_WIDE;
  const mean = incidence.meanLength;

  const empty: LeftoverNeitherStats = {
    neither: 0,
    faces221: 0,
    isolatedTwoVert: 0,
    chain1: 0,
    chain2: 0,
    chain3plus: 0,
    medianChain: Infinity,
    medianLenVsMean: Infinity,
    short035: 0,
    medianLeftoverAny: Infinity,
    leftoverAnyVsMean: Infinity,
    medianInteriorAny: Infinity,
    interiorAnyVsMean: Infinity,
    medianCentroidFace: Infinity,
    centroidFaceVsMean: Infinity,
    centroidOnFace: 0,
    interiorNearNotParallel: 0,
    leftoverNearGateFail: 0,
    leftoverOnlySameChain: 0,
    bothFar: 0,
  };
  if (lips.length === 0 || mean <= 0) return empty;

  const lipDists: number[] = [];
  const intDists: number[] = [];
  const faceDists: number[] = [];
  const lens: number[] = [];
  const chainVals: number[] = [];
  let neither = 0;
  let faces221 = 0;
  let isolatedTwoVert = 0;
  let chain1 = 0;
  let chain2 = 0;
  let chain3plus = 0;
  let short035 = 0;
  let centroidOnFace = 0;
  let interiorNearNotParallel = 0;
  let leftoverNearGateFail = 0;
  let leftoverOnlySameChain = 0;
  let bothFar = 0;

  for (let i = 0; i < lips.length; i++) {
    const a = lips[i];
    let bestGatedLip = Infinity;
    let bestAnyLip = Infinity;
    let bestSameChain = Infinity;
    let gateFailNear = false;
    for (let j = 0; j < lips.length; j++) {
      if (i === j) continue;
      const b = lips[j];
      const dist = segmentDistance(a.pa, a.pb, b.pa, b.pb);
      if (sharesVertex(a, b)) {
        if (dist < bestSameChain) bestSameChain = dist;
        continue;
      }
      if (dist < bestAnyLip) bestAnyLip = dist;
      if (passesCrackGates(a, b, Infinity) && dist < bestGatedLip) bestGatedLip = dist;
      else if (dist <= cap05) gateFailNear = true;
    }

    let bestParInt = Infinity;
    let bestAnyInt = Infinity;
    let nearNotParallel = false;
    for (const seg of interiors) {
      if (seg.u === a.a || seg.v === a.a || seg.u === a.b || seg.v === a.b) continue;
      const dist = segmentDistance(a.pa, a.pb, seg.pu, seg.pv);
      if (dist < bestAnyInt) bestAnyInt = dist;
      const par = Math.abs(edgeAlign(a.dir, sub(seg.pv, seg.pu)));
      if (par >= PARALLEL) {
        if (dist < bestParInt) bestParInt = dist;
      } else if (dist <= cap05) nearNotParallel = true;
    }

    const isNeither = bestGatedLip > cap05 && bestParInt > cap05;
    if (!isNeither) continue;
    neither++;

    const o = a.face * 3;
    const ia = mesh.indices[o];
    const ib = mesh.indices[o + 1];
    const ic = mesh.indices[o + 2];
    const counts = [incidence.count(ia, ib), incidence.count(ib, ic), incidence.count(ic, ia)];
    const ones = counts.filter((c) => c === 1).length;
    const twos = counts.filter((c) => c >= 2).length;
    if (ones === 1 && twos === 2) faces221++;

    const chain = chains.get(i) ?? 1;
    chainVals.push(chain);
    if (chain === 1) {
      chain1++;
      isolatedTwoVert++;
    } else if (chain === 2) chain2++;
    else chain3plus++;

    const lenVs = a.len / mean;
    lens.push(lenVs);
    if (lenVs <= 0.35) short035++;

    if (bestAnyLip < Infinity) lipDists.push(bestAnyLip);
    if (bestAnyInt < Infinity) intDists.push(bestAnyInt);

    const pa = vertexAt(mesh.positions, ia);
    const pb = vertexAt(mesh.positions, ib);
    const pc = vertexAt(mesh.positions, ic);
    const centroid: Vec3 = [(pa[0] + pb[0] + pc[0]) / 3, (pa[1] + pb[1] + pc[1]) / 3, (pa[2] + pb[2] + pc[2]) / 3];
    let bestFace = Infinity;
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const fa = mesh.indices[t];
      const fb = mesh.indices[t + 1];
      const fc = mesh.indices[t + 2];
      if (t / 3 === a.face) continue;
      if (incidence.count(fa, fb) < 2 || incidence.count(fb, fc) < 2 || incidence.count(fc, fa) < 2) continue;
      const qa = vertexAt(mesh.positions, fa);
      const qb = vertexAt(mesh.positions, fb);
      const qc = vertexAt(mesh.positions, fc);
      const hit = closestOnTriangleLocal(centroid, qa, qb, qc);
      if (hit.kind !== 'face') continue;
      const dist = Math.sqrt(hit.d2);
      if (dist < bestFace) bestFace = dist;
    }
    if (bestFace < Infinity) {
      faceDists.push(bestFace);
      if (bestFace <= mean * 0.35) centroidOnFace++;
    }

    if (nearNotParallel) interiorNearNotParallel++;
    else if (gateFailNear) leftoverNearGateFail++;
    else if (bestAnyLip > cap05 && bestSameChain < Infinity && bestAnyInt > cap05) leftoverOnlySameChain++;
    else bothFar++;
  }

  return {
    neither,
    faces221,
    isolatedTwoVert,
    chain1,
    chain2,
    chain3plus,
    medianChain: median(chainVals),
    medianLenVsMean: median(lens),
    short035,
    medianLeftoverAny: median(lipDists),
    leftoverAnyVsMean: mean > 0 ? median(lipDists) / mean : Infinity,
    medianInteriorAny: median(intDists),
    interiorAnyVsMean: mean > 0 ? median(intDists) / mean : Infinity,
    medianCentroidFace: median(faceDists),
    centroidFaceVsMean: mean > 0 ? median(faceDists) / mean : Infinity,
    centroidOnFace,
    interiorNearNotParallel,
    leftoverNearGateFail,
    leftoverOnlySameChain,
    bothFar,
  };
}

function leftoverChainLengths(lips: Lip[]): Map<number, number> {
  const adj = new Map<number, number[]>();
  for (let i = 0; i < lips.length; i++) adj.set(i, []);
  for (let i = 0; i < lips.length; i++) {
    for (let j = i + 1; j < lips.length; j++) {
      if (!sharesVertex(lips[i], lips[j])) continue;
      adj.get(i)!.push(j);
      adj.get(j)!.push(i);
    }
  }
  const out = new Map<number, number>();
  const seen = new Uint8Array(lips.length);
  for (let i = 0; i < lips.length; i++) {
    if (seen[i]) continue;
    const stack = [i];
    const comp: number[] = [];
    seen[i] = 1;
    while (stack.length > 0) {
      const v = stack.pop()!;
      comp.push(v);
      for (const n of adj.get(v) ?? []) {
        if (seen[n]) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
    for (const v of comp) out.set(v, comp.length);
  }
  return out;
}

function closestOnTriangleLocal(
  p: Vec3,
  a: Vec3,
  b: Vec3,
  c: Vec3,
): { d2: number; kind: 'vertex' | 'edge' | 'face' } {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return { d2: dist2(p, a), kind: 'vertex' };
  const bp = sub(p, b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return { d2: dist2(p, b), kind: 'vertex' };
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const t = d1 / (d1 - d3);
    const q: Vec3 = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
    return { d2: dist2(p, q), kind: 'edge' };
  }
  const cp = sub(p, c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return { d2: dist2(p, c), kind: 'vertex' };
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const t = d2 / (d2 - d6);
    const q: Vec3 = [a[0] + ac[0] * t, a[1] + ac[1] * t, a[2] + ac[2] * t];
    return { d2: dist2(p, q), kind: 'edge' };
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const t = (d4 - d3) / (d4 - d3 + d5 - d6);
    const bc = sub(c, b);
    const q: Vec3 = [b[0] + bc[0] * t, b[1] + bc[1] * t, b[2] + bc[2] * t];
    return { d2: dist2(p, q), kind: 'edge' };
  }
  const q: Vec3 = [
    a[0] + ab[0] * (vb / (va + vb + vc)) + ac[0] * (vc / (va + vb + vc)),
    a[1] + ab[1] * (vb / (va + vb + vc)) + ac[1] * (vc / (va + vb + vc)),
    a[2] + ab[2] * (vb / (va + vb + vc)) + ac[2] * (vc / (va + vb + vc)),
  ];
  return { d2: dist2(p, q), kind: 'face' };
}

function zipOneCrack(mesh: MeshData, distRatio: number): MeshData | null {
  const topology = buildTopology(mesh);
  if (topology.fillFrom.length < 2) return null;
  const incidence = new EdgeIncidence(mesh);
  const cap = incidence.meanLength * distRatio;
  if (cap <= 0) return null;
  const lips = collectLeftoverLips(mesh, topology);
  if (lips.length < 2) return null;

  const cell = Math.max(cap, incidence.meanLength * 0.5, 1e-12);
  const hashed = hashLips(lips, cell);
  const reach = 1;
  const candidates: { pairs: number[][]; d2: number }[] = [];

  for (let i = 0; i < lips.length; i++) {
    const a = lips[i];
    const ix = Math.floor(a.mid[0] / cell);
    const iy = Math.floor(a.mid[1] / cell);
    const iz = Math.floor(a.mid[2] / cell);
    const seen = new Set<number>();
    for (let dx = -reach; dx <= reach; dx++) {
      for (let dy = -reach; dy <= reach; dy++) {
        for (let dz = -reach; dz <= reach; dz++) {
          for (let cand = hashed.table.first(hash3(ix + dx, iy + dy, iz + dz)); cand >= 0; cand = hashed.table.after(cand)) {
            const j = hashed.lipOf[cand];
            if (j <= i || seen.has(j)) continue;
            seen.add(j);
            const b = lips[j];
            if (sharesVertex(a, b) || !passesCrackGates(a, b, cap)) continue;
            candidates.push(bestAssignment(a, b));
          }
        }
      }
    }
  }

  candidates.sort((x, y) => x.d2 - y.d2);
  const limit = Math.min(candidates.length, 12);
  for (let k = 0; k < limit; k++) {
    const next = mergeVertexGroups(mesh, candidates[k].pairs);
    if (isSafer(mesh, next)) return next;
  }
  return null;
}

/**
 * 짝이 1-face가 아니고 안쪽 2-face만 있을 때, 그 에지를 정점 분할해
 * 입술을 둘로 나눈 뒤 1-face끼리 지퍼한다. 안쪽 에지에 세 번째 면은 붙이지 않는다.
 */
function splitInteriorThenZip(mesh: MeshData): MeshData | null {
  const topology = buildTopology(mesh);
  if (topology.fillFrom.length === 0) return null;
  const incidence = new EdgeIncidence(mesh);
  const cap = incidence.meanLength * DIST_WIDE;
  if (cap <= 0) return null;
  const lips = collectLeftoverLips(mesh, topology);
  const interiors = collectInteriorEdges(mesh, incidence);
  if (lips.length === 0 || interiors.length === 0) return null;

  const cell = Math.max(cap, incidence.meanLength * 0.5, 1e-12);
  const hashed = hashInteriorSegs(interiors, cell);
  const reach = 1;
  const candidates: { lip: Lip; u: number; v: number; face: number; d2: number }[] = [];

  for (const lip of lips) {
    const ix = Math.floor(lip.mid[0] / cell);
    const iy = Math.floor(lip.mid[1] / cell);
    const iz = Math.floor(lip.mid[2] / cell);
    const seen = new Set<number>();
    for (let dx = -reach; dx <= reach; dx++) {
      for (let dy = -reach; dy <= reach; dy++) {
        for (let dz = -reach; dz <= reach; dz++) {
          for (let cand = hashed.table.first(hash3(ix + dx, iy + dy, iz + dz)); cand >= 0; cand = hashed.table.after(cand)) {
            const seg = interiors[hashed.segOf[cand]];
            const id = seg.u * (mesh.positions.length / 3) + seg.v;
            if (seen.has(id) || seg.u === lip.a || seg.v === lip.a || seg.u === lip.b || seg.v === lip.b) continue;
            seen.add(id);
            const uv = sub(seg.pv, seg.pu);
            if (Math.abs(edgeAlign(lip.dir, uv)) < PARALLEL) continue;
            const dist = segmentDistance(lip.pa, lip.pb, seg.pu, seg.pv);
            if (dist > cap) continue;
            const face = closerFaceOnEdge(mesh, seg.u, seg.v, lip);
            if (face < 0) continue;
            candidates.push({ lip, u: seg.u, v: seg.v, face, d2: dist * dist });
          }
        }
      }
    }
  }

  candidates.sort((x, y) => x.d2 - y.d2);
  const limit = Math.min(candidates.length, 8);
  for (let k = 0; k < limit; k++) {
    const hit = candidates[k];
    const split = vertexSplitEdgeFace(mesh, hit.u, hit.v, hit.face);
    if (!split) continue;
    const neuU = split.map.get(hit.u);
    const neuV = split.map.get(hit.v);
    if (neuU === undefined || neuV === undefined) continue;
    const pu = vertexAt(split.mesh.positions, neuU);
    const pv = vertexAt(split.mesh.positions, neuV);
    const anti = dist2(hit.lip.pa, pv) + dist2(hit.lip.pb, pu);
    const other = dist2(hit.lip.pa, pu) + dist2(hit.lip.pb, pv);
    const pairs = anti <= other ? [[hit.lip.a, neuV], [hit.lip.b, neuU]] : [[hit.lip.a, neuU], [hit.lip.b, neuV]];
    const next = mergeVertexGroups(split.mesh, pairs);
    if (isSafer(mesh, next)) return next;
  }
  return null;
}

type Lip = {
  a: number;
  b: number;
  pa: Vec3;
  pb: Vec3;
  mid: Vec3;
  dir: Vec3;
  len: number;
  normal: Vec3;
  face: number;
};

function collectLeftoverLips(mesh: MeshData, topology: ReturnType<typeof buildTopology>): Lip[] {
  const out: Lip[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < topology.fillFrom.length; i++) {
    const a = topology.fillFrom[i];
    const b = topology.fillTo[i];
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const pa = vertexAt(mesh.positions, a);
    const pb = vertexAt(mesh.positions, b);
    const d = sub(pb, pa);
    const len = length(d);
    if (len < 1e-18) continue;
    out.push({
      a,
      b,
      pa,
      pb,
      mid: [(pa[0] + pb[0]) * 0.5, (pa[1] + pb[1]) * 0.5, (pa[2] + pb[2]) * 0.5],
      dir: [d[0] / len, d[1] / len, d[2] / len],
      len,
      normal: faceNormal(mesh, topology.fillFace[i]),
      face: topology.fillFace[i],
    });
  }
  return out;
}

function collectInteriorEdges(
  mesh: MeshData,
  incidence: EdgeIncidence,
): { u: number; v: number; pu: Vec3; pv: Vec3 }[] {
  const { indices, positions } = mesh;
  const seen = new Set<string>();
  const out: { u: number; v: number; pu: Vec3; pv: Vec3 }[] = [];
  for (let t = 0; t < indices.length; t += 3) {
    const vs = [indices[t], indices[t + 1], indices[t + 2]];
    for (let k = 0; k < 3; k++) {
      const u = vs[k];
      const v = vs[(k + 1) % 3];
      if (incidence.count(u, v) !== 2) continue;
      const key = u < v ? `${u}:${v}` : `${v}:${u}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const lo = u < v ? u : v;
      const hi = u < v ? v : u;
      out.push({ u: lo, v: hi, pu: vertexAt(positions, lo), pv: vertexAt(positions, hi) });
    }
  }
  return out;
}

function hashLips(lips: Lip[], cell: number): { table: IntHashTable; lipOf: Int32Array } {
  const keys: number[] = [];
  const ids: number[] = [];
  const push = (p: Vec3, i: number) => {
    keys.push(hash3(Math.floor(p[0] / cell), Math.floor(p[1] / cell), Math.floor(p[2] / cell)));
    ids.push(i);
  };
  for (let i = 0; i < lips.length; i++) {
    push(lips[i].mid, i);
    push(lips[i].pa, i);
    push(lips[i].pb, i);
  }
  const table = new IntHashTable(ids.length);
  const lipOf = new Int32Array(ids.length);
  for (let i = 0; i < ids.length; i++) {
    lipOf[i] = ids[i];
    table.insert(keys[i], i);
  }
  return { table, lipOf };
}

function hashInteriorSegs(
  segs: { pu: Vec3; pv: Vec3 }[],
  cell: number,
): { table: IntHashTable; segOf: Int32Array } {
  const keys: number[] = [];
  const ids: number[] = [];
  const push = (p: Vec3, i: number) => {
    keys.push(hash3(Math.floor(p[0] / cell), Math.floor(p[1] / cell), Math.floor(p[2] / cell)));
    ids.push(i);
  };
  for (let i = 0; i < segs.length; i++) {
    const a = segs[i].pu;
    const b = segs[i].pv;
    push([(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5, (a[2] + b[2]) * 0.5], i);
    push(a, i);
    push(b, i);
  }
  const table = new IntHashTable(ids.length);
  const segOf = new Int32Array(ids.length);
  for (let i = 0; i < ids.length; i++) {
    segOf[i] = ids[i];
    table.insert(keys[i], i);
  }
  return { table, segOf };
}

function passesCrackGates(a: Lip, b: Lip, cap: number): boolean {
  const short = Math.min(a.len, b.len);
  const long = Math.max(a.len, b.len);
  if (short < 1e-18 || long / short > LENGTH_RATIO) return false;
  if (dot(a.normal, b.normal) < NORMAL_DOT) return false;
  if (Math.abs(dot(a.dir, b.dir)) < PARALLEL) return false;
  if (cap < Infinity && segmentDistance(a.pa, a.pb, b.pa, b.pb) > cap) return false;
  return true;
}

function sharesVertex(a: Lip, b: Lip): boolean {
  return a.a === b.a || a.a === b.b || a.b === b.a || a.b === b.b;
}

function bestAssignment(a: Lip, b: Lip): { pairs: number[][]; d2: number } {
  const anti = dist2(a.pa, b.pb) + dist2(a.pb, b.pa);
  const other = dist2(a.pa, b.pa) + dist2(a.pb, b.pb);
  return anti <= other
    ? { pairs: [[a.a, b.b], [a.b, b.a]], d2: anti }
    : { pairs: [[a.a, b.a], [a.b, b.b]], d2: other };
}

function isSafer(before: MeshData, after: MeshData): boolean {
  const a = buildTopology(before);
  const b = buildTopology(after);
  if (b.boundaryEdgeCount >= a.boundaryEdgeCount) return false;
  if (b.nonManifoldEdgeCount > a.nonManifoldEdgeCount) return false;
  return true;
}

function closerFaceOnEdge(mesh: MeshData, u: number, v: number, lip: Lip): number {
  const { indices } = mesh;
  let best = -1;
  let bestD = Infinity;
  for (let t = 0; t < indices.length; t += 3) {
    const ia = indices[t];
    const ib = indices[t + 1];
    const ic = indices[t + 2];
    const hasU = ia === u || ib === u || ic === u;
    const hasV = ia === v || ib === v || ic === v;
    if (!hasU || !hasV) continue;
    const pa = vertexAt(mesh.positions, ia);
    const pb = vertexAt(mesh.positions, ib);
    const pc = vertexAt(mesh.positions, ic);
    const n = normalize(triangleNormalRaw(pa, pb, pc));
    if (dot(n, lip.normal) < NORMAL_DOT) continue;
    const c: Vec3 = [(pa[0] + pb[0] + pc[0]) / 3, (pa[1] + pb[1] + pc[1]) / 3, (pa[2] + pb[2] + pc[2]) / 3];
    const d = dist2(c, lip.mid);
    if (d < bestD) {
      bestD = d;
      best = t / 3;
    }
  }
  return best;
}

function vertexSplitEdgeFace(
  mesh: MeshData,
  u: number,
  v: number,
  face: number,
): { mesh: MeshData; map: Map<number, number> } | null {
  const { indices, positions } = mesh;
  const o = face * 3;
  const tri = [indices[o], indices[o + 1], indices[o + 2]];
  if (!tri.includes(u) || !tri.includes(v)) return null;

  const map = new Map<number, number>();
  const grown = new Float32Array(positions.length + 6);
  grown.set(positions);
  let next = positions.length / 3;
  for (const src of [u, v]) {
    grown[next * 3] = positions[src * 3];
    grown[next * 3 + 1] = positions[src * 3 + 1];
    grown[next * 3 + 2] = positions[src * 3 + 2];
    map.set(src, next);
    next++;
  }

  const out = new Uint32Array(indices);
  for (let k = 0; k < 3; k++) {
    const src = out[o + k];
    const neu = map.get(src);
    if (neu !== undefined) out[o + k] = neu;
  }
  return { mesh: { positions: grown, indices: out }, map };
}

function faceNormal(mesh: MeshData, face: number): Vec3 {
  const o = face * 3;
  return normalize(
    triangleNormalRaw(
      vertexAt(mesh.positions, mesh.indices[o]),
      vertexAt(mesh.positions, mesh.indices[o + 1]),
      vertexAt(mesh.positions, mesh.indices[o + 2]),
    ),
  );
}

function segmentDistance(a: Vec3, b: Vec3, c: Vec3, d: Vec3): number {
  const d1 = sub(b, a);
  const d2 = sub(d, c);
  const r = sub(a, c);
  const aa = dot(d1, d1);
  const ee = dot(d2, d2);
  const ff = dot(d2, r);
  let s: number;
  let t: number;
  if (aa <= 1e-18 && ee <= 1e-18) return Math.sqrt(dist2(a, c));
  if (aa <= 1e-18) {
    s = 0;
    t = clamp01(ff / ee);
  } else {
    const c1 = dot(d1, r);
    if (ee <= 1e-18) {
      t = 0;
      s = clamp01(-c1 / aa);
    } else {
      const b1 = dot(d1, d2);
      const denom = aa * ee - b1 * b1;
      s = denom !== 0 ? clamp01((b1 * ff - c1 * ee) / denom) : 0;
      t = (b1 * s + ff) / ee;
      if (t < 0) {
        t = 0;
        s = clamp01(-c1 / aa);
      } else if (t > 1) {
        t = 1;
        s = clamp01((b1 - c1) / aa);
      }
    }
  }
  const p: Vec3 = [a[0] + d1[0] * s, a[1] + d1[1] * s, a[2] + d1[2] * s];
  const q: Vec3 = [c[0] + d2[0] * t, c[1] + d2[1] * t, c[2] + d2[2] * t];
  return Math.sqrt(dist2(p, q));
}

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

function edgeAlign(a: Vec3, b: Vec3): number {
  const lb = length(b);
  if (lb < 1e-18) return 0;
  return dot(a, [b[0] / lb, b[1] / lb, b[2] / lb]);
}

function median(values: number[]): number {
  if (values.length === 0) return Infinity;
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function dist2(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}
