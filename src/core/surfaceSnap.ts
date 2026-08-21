import { mergeVertexGroups } from './compact.ts';
import { zipSameOrientationCracks } from './crackZip.ts';
import { applyLeftoverSurgeries } from './leftoverSurgery.ts';
import { hash3, IntHashTable } from './intHash.ts';
import { buildTopology } from './halfEdge.ts';
import { computeVertexMeanEdge, EdgeIncidence } from './incidence.ts';
import { computeBounds, type MeshData } from './types.ts';
import { UnionFind } from './unionFind.ts';
import { dot, length, normalize, sub, triangleNormalRaw, vertexAt, type Vec3 } from './geom.ts';

export interface SurfaceAttachResult {
  mesh: MeshData;
  collapsedSlits: number;
  snappedToInterior: number;
  deletedFlaps: number;
  snappedTJunctions: number;
  zippedCracks: number;
  collapsedShort: number;
  overlapReplaces: number;
  cavityCommits: number;
  spatialZipCommits: number;
  subsegmentZipCommits: number;
  polylineZipCommits: number;
  sliverCutCommits: number;
  insertCommits: number;
  stripCommits: number;
  stripMultiCommits: number;
  stripFarCommits: number;
  leftoverZipCommits: number;
  sheetSplitCommits: number;
  stripBowCommits: number;
  chainRecapCommits: number;
  stripBudgetHit: boolean;
  wrappedTriangles: number;
}

export interface LeftoverSnapStats {
  leftoverOneFace: number;
  isolatedTwoVert: number;
  meanEdge: number;
  medianUngatedDist: number;
  medianGatedDist: number;
  ungatedVsMean: number;
  gatedVsMean: number;
  gatedCount: number;
}

export interface LeftoverFlapStats {
  leftoverOneFace: number;
  isolatedTwoVert: number;
  meanEdge: number;
  overlappingAndSafe: number;
  overlappingWouldTear: number;
  notOverlapping: number;
  medianOverlapDist: number;
  medianNormalDot: number;
  overlapDistVsMean: number;
}

export interface LeftoverTJunctionStats {
  leftoverOneFace: number;
  leftoverVerts: number;
  meanEdge: number;
  projectToInteriorEdge: number;
  trueTSpoke: number;
  edgeOnInteriorEdge: number;
  nearbyOnly: number;
  projectToInteriorFace: number;
  projectNeither: number;
  faces221: number;
  centroidOnEdge: number;
  centroidOnVertex: number;
  centroidOnFace: number;
  onEdge02: number;
  onEdge05: number;
  onEdge10: number;
  medianEdgeDist: number;
  edgeDistVsMean: number;
}

const COLLAPSE_RATIO = 0.4;
const SNAP_LOCAL = 3.5;
const SNAP_DIAG = 0.025;
const INPLANE = 0.55;
const NORMAL_ALIGN = 0.25;
const NEAR_VERTEX = 0.25;
const SURFACE_MOVE = 0.45;
const MAX_FLAP_ITERS = 8;
const MAX_EDGE_ITERS = 24;
const OVERLAP_DIST = 0.35;
const OVERLAP_NORMAL = 0.5;
const MAX_FLAP_TRIS = 8;
const T_DIST = 0.35;
const T_ONEDGE = 0.05;
const T_TMIN = 0.08;
const T_TMAX = 0.92;
const MAX_T_ITERS = 12;
const T_BATCH = 24;

/**
 * 짝을 못 찾는 1-face 에지를 기존 안쪽 표면에 붙인다.
 *
 * 짧은 핀 슬릿은 양 끝점을 한 점으로 모은다. 나머지는 면이 둘인 안쪽
 * 삼각형 위로 투영해 분할한 뒤 용접한다. 다른 테두리와는 짝을 짓지 않는다.
 */
export function attachToExistingSurface(mesh: MeshData): SurfaceAttachResult {
  let working = mesh;
  let collapsedSlits = 0;
  let snapped = 0;
  let deletedFlaps = 0;
  let snappedTJunctions = 0;
  let zippedCracks = 0;
  let collapsedShort = 0;
  let overlapReplaces = 0;
  let cavityCommits = 0;
  let spatialZipCommits = 0;
  let subsegmentZipCommits = 0;
  let polylineZipCommits = 0;
  let sliverCutCommits = 0;
  let insertCommits = 0;
  let stripCommits = 0;
  let stripMultiCommits = 0;
  let stripFarCommits = 0;
  let leftoverZipCommits = 0;
  let sheetSplitCommits = 0;
  let stripBowCommits = 0;
  let chainRecapCommits = 0;
  let stripBudgetHit = false;
  let wrappedTriangles = 0;

  const dropped = dropOverlappingFlaps(working);
  if (dropped.count > 0 && oneFaceCount(dropped.mesh) < oneFaceCount(working)) {
    working = dropped.mesh;
    deletedFlaps += dropped.count;
  }

  const first = collapseIsolatedSlits(working);
  if (first.count > 0 && oneFaceCount(first.mesh) < oneFaceCount(working)) {
    working = first.mesh;
    collapsedSlits += first.count;
  }

  for (let i = 0; i < MAX_T_ITERS; i++) {
    const before = oneFaceCount(working);
    const one = snapTJunctions(working, T_BATCH);
    if (one.count === 0 || oneFaceCount(one.mesh) >= before) break;
    working = one.mesh;
    snappedTJunctions += one.count;
    const afterT = dropOverlappingFlaps(working);
    if (afterT.count > 0 && oneFaceCount(afterT.mesh) < oneFaceCount(working)) {
      working = afterT.mesh;
      deletedFlaps += afterT.count;
    }
  }

  const cracks = zipSameOrientationCracks(working);
  if (cracks.zippedCracks > 0 && oneFaceCount(cracks.mesh) < oneFaceCount(working)) {
    working = cracks.mesh;
    zippedCracks += cracks.zippedCracks;
    const afterCrack = dropOverlappingFlaps(working);
    if (afterCrack.count > 0 && oneFaceCount(afterCrack.mesh) < oneFaceCount(working)) {
      working = afterCrack.mesh;
      deletedFlaps += afterCrack.count;
    }
  }

  for (let i = 0; i < MAX_FLAP_ITERS; i++) {
    const before = oneFaceCount(working);
    const one = snapDanglingVerts(working, { allowOnSurface: false, limit: 64 });
    if (one.count === 0) break;
    if (oneFaceCount(one.mesh) >= before) break;
    working = one.mesh;
    snapped += one.count;
  }
  for (let i = 0; i < MAX_EDGE_ITERS; i++) {
    const before = oneFaceCount(working);
    const batch = stitchIsolatedToInterior(working, 8);
    if (batch.count === 0) break;
    if (oneFaceCount(batch.mesh) < before) {
      working = batch.mesh;
      snapped += batch.count;
      continue;
    }
    const one = stitchIsolatedToInterior(working, 1);
    if (one.count === 0 || oneFaceCount(one.mesh) >= before) break;
    working = one.mesh;
    snapped += one.count;
  }

  const last = collapseIsolatedSlits(working);
  if (last.count > 0 && oneFaceCount(last.mesh) < oneFaceCount(working)) {
    working = last.mesh;
    collapsedSlits += last.count;
  }

  for (let i = 0; i < MAX_T_ITERS; i++) {
    const before = oneFaceCount(working);
    const one = snapTJunctions(working, T_BATCH);
    if (one.count === 0 || oneFaceCount(one.mesh) >= before) break;
    working = one.mesh;
    snappedTJunctions += one.count;
    const afterT = dropOverlappingFlaps(working);
    if (afterT.count > 0 && oneFaceCount(afterT.mesh) < oneFaceCount(working)) {
      working = afterT.mesh;
      deletedFlaps += afterT.count;
    }
  }

  const lateCracks = zipSameOrientationCracks(working);
  if (lateCracks.zippedCracks > 0 && oneFaceCount(lateCracks.mesh) < oneFaceCount(working)) {
    working = lateCracks.mesh;
    zippedCracks += lateCracks.zippedCracks;
    const afterLate = dropOverlappingFlaps(working);
    if (afterLate.count > 0 && oneFaceCount(afterLate.mesh) < oneFaceCount(working)) {
      working = afterLate.mesh;
      deletedFlaps += afterLate.count;
    }
  }

  const surgery = applyLeftoverSurgeries(working);
  const surgeryHits = surgery.collapsedShort + surgery.overlapReplaces + surgery.cavityCommits + surgery.spatialZipCommits + surgery.subsegmentZipCommits + surgery.polylineZipCommits + surgery.sliverCutCommits + surgery.insertCommits + surgery.stripCommits + surgery.leftoverZipCommits + surgery.sheetSplitCommits + surgery.stripBowCommits + surgery.chainRecapCommits + surgery.wrappedTriangles;
  const surgeryNmOk = buildTopology(surgery.mesh).nonManifoldEdgeCount <= buildTopology(working).nonManifoldEdgeCount;
  const surgerySafer = oneFaceCount(surgery.mesh) < oneFaceCount(working) || ((surgery.stripCommits > 0 || surgery.sheetSplitCommits > 0 || surgery.stripBowCommits > 0 || surgery.chainRecapCommits > 0) && surgeryNmOk);
  if (surgeryHits > 0 && surgeryNmOk && surgerySafer) {
    working = surgery.mesh;
    collapsedShort += surgery.collapsedShort;
    overlapReplaces += surgery.overlapReplaces;
    cavityCommits += surgery.cavityCommits;
    spatialZipCommits += surgery.spatialZipCommits;
    subsegmentZipCommits += surgery.subsegmentZipCommits;
    polylineZipCommits += surgery.polylineZipCommits;
    sliverCutCommits += surgery.sliverCutCommits;
    insertCommits += surgery.insertCommits;
    stripCommits += surgery.stripCommits;
    stripMultiCommits += surgery.stripMultiCommits;
    stripFarCommits += surgery.stripFarCommits;
    leftoverZipCommits += surgery.leftoverZipCommits;
    sheetSplitCommits += surgery.sheetSplitCommits;
    stripBowCommits += surgery.stripBowCommits;
    chainRecapCommits += surgery.chainRecapCommits;
    stripBudgetHit = stripBudgetHit || surgery.stripBudgetHit;
    wrappedTriangles += surgery.wrappedTriangles;
    const afterS = dropOverlappingFlaps(working);
    if (afterS.count > 0 && oneFaceCount(afterS.mesh) < oneFaceCount(working)) {
      working = afterS.mesh;
      deletedFlaps += afterS.count;
    }
    const afterCavity = zipSameOrientationCracks(working);
    if (afterCavity.zippedCracks > 0 && oneFaceCount(afterCavity.mesh) < oneFaceCount(working)) {
      working = afterCavity.mesh;
      zippedCracks += afterCavity.zippedCracks;
    }
  }

  return {
    mesh: working,
    collapsedSlits,
    snappedToInterior: snapped,
    deletedFlaps,
    snappedTJunctions,
    zippedCracks,
    collapsedShort,
    overlapReplaces,
    cavityCommits,
    spatialZipCommits,
    subsegmentZipCommits,
    polylineZipCommits,
    sliverCutCommits,
    insertCommits,
    stripCommits,
    stripMultiCommits,
    stripFarCommits,
    leftoverZipCommits,
    sheetSplitCommits,
    stripBowCommits,
    chainRecapCommits,
    stripBudgetHit,
    wrappedTriangles,
  };
}

export function collapseIsolatedSlits(mesh: MeshData): { mesh: MeshData; count: number } {
  const topology = buildTopology(mesh);
  if (topology.fillFrom.length === 0) return { mesh, count: 0 };

  const local = computeVertexMeanEdge(mesh);
  const incidence = new EdgeIncidence(mesh);
  const onSurface = markSurfaceVerts(mesh, incidence);
  const V = mesh.positions.length / 3;
  const valence = new Uint8Array(V);
  for (let i = 0; i < topology.fillFrom.length; i++) {
    valence[topology.fillFrom[i]]++;
    valence[topology.fillTo[i]]++;
  }

  const uf = new UnionFind(V);
  const seen = new Set<string>();
  let count = 0;

  for (let i = 0; i < topology.fillFrom.length; i++) {
    const a = topology.fillFrom[i];
    const b = topology.fillTo[i];
    if (valence[a] !== 1 || valence[b] !== 1) continue;
    if (onSurface[a] === 1 && onSurface[b] === 1) continue;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const pa = vertexAt(mesh.positions, a);
    const pb = vertexAt(mesh.positions, b);
    const len = length(sub(pb, pa));
    const mean = Math.min(local[a] || 0, local[b] || 0);
    if (mean <= 0 || len >= COLLAPSE_RATIO * mean) continue;
    uf.union(a, b);
    count++;
  }

  if (count === 0) return { mesh, count: 0 };
  const buckets = new Map<number, number[]>();
  for (let i = 0; i < topology.fillFrom.length; i++) {
    const a = topology.fillFrom[i];
    const b = topology.fillTo[i];
    if (uf.find(a) === uf.find(b) && a !== b) {
      const root = uf.find(a);
      const list = buckets.get(root);
      if (list) {
        if (!list.includes(a)) list.push(a);
        if (!list.includes(b)) list.push(b);
      } else buckets.set(root, [a, b]);
    }
  }
  const groups = [...buckets.values()].filter((g) => g.length >= 2);
  if (groups.length === 0) return { mesh, count: 0 };
  return { mesh: mergeVertexGroups(mesh, groups), count };
}

export function leftoverSnapStats(mesh: MeshData): LeftoverSnapStats {
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
  const local = computeVertexMeanEdge(mesh);
  const bounds = computeBounds(mesh.positions);
  const globalCap = Math.min(incidence.meanLength * SNAP_LOCAL, bounds.diagonal * SNAP_DIAG);
  const dangling = collectDangling(mesh, topology.fillFrom, topology.fillTo, topology.fillFace);
  const interiors = collectInteriorTriangles(mesh, incidence);
  const onSurface = markSurfaceVerts(mesh, incidence);
  const cell = Math.max(globalCap, incidence.meanLength * 0.5, 1e-12);
  const hashed = interiors.length > 0 ? hashInteriorCells(interiors, cell) : null;
  const scanReach = Math.max(2, Math.ceil((incidence.meanLength * 8) / cell));

  const ungated: number[] = [];
  const gated: number[] = [];
  for (const d of dangling) {
    let bestAny = Infinity;
    let bestGate = Infinity;
    const p = d.pos;
    const ix = Math.floor(p[0] / cell);
    const iy = Math.floor(p[1] / cell);
    const iz = Math.floor(p[2] / cell);
    const seenTri = new Set<number>();
    if (hashed) {
      for (let dx = -scanReach; dx <= scanReach; dx++) {
        for (let dy = -scanReach; dy <= scanReach; dy++) {
          for (let dz = -scanReach; dz <= scanReach; dz++) {
            for (let cand = hashed.table.first(hash3(ix + dx, iy + dy, iz + dz)); cand >= 0; cand = hashed.table.after(cand)) {
              const tri = interiors[hashed.triOf[cand]];
              if (seenTri.has(tri.face)) continue;
              seenTri.add(tri.face);
              if (tri.a === d.vertex || tri.b === d.vertex || tri.c === d.vertex) continue;
              const hit = closestOnTriangle(p, tri.pa, tri.pb, tri.pc);
              const dist = Math.sqrt(hit.d2);
              if (dist < bestAny) bestAny = dist;
              if (passesSnapGate(d, tri, hit, local, globalCap, onSurface[d.vertex] === 1)) {
                if (dist < bestGate) bestGate = dist;
              }
            }
          }
        }
      }
    }
    if (bestAny < Infinity) ungated.push(bestAny);
    if (bestGate < Infinity) gated.push(bestGate);
  }

  const medianUngated = median(ungated);
  const medianGated = gated.length > 0 ? median(gated) : Infinity;
  return {
    leftoverOneFace,
    isolatedTwoVert,
    meanEdge: incidence.meanLength,
    medianUngatedDist: medianUngated,
    medianGatedDist: medianGated,
    ungatedVsMean: incidence.meanLength > 0 ? medianUngated / incidence.meanLength : Infinity,
    gatedVsMean: incidence.meanLength > 0 && medianGated < Infinity ? medianGated / incidence.meanLength : Infinity,
    gatedCount: gated.length,
  };
}

/**
 * 1-face 여분 면이 이미 닫힌 안쪽 면 위에 겹치면 그 여분만 버린다.
 * 면이 둘인 본 시트와 맞닿은 변을 열게 되면 삭제하지 않는다.
 */
export function dropOverlappingFlaps(mesh: MeshData): { mesh: MeshData; count: number } {
  const topology = buildTopology(mesh);
  if (topology.fillFrom.length === 0) return { mesh, count: 0 };

  const incidence = new EdgeIncidence(mesh);
  const interiors = collectInteriorTriangles(mesh, incidence);
  if (interiors.length === 0) return { mesh, count: 0 };

  const cap = incidence.meanLength * OVERLAP_DIST;
  if (cap <= 0) return { mesh, count: 0 };

  const cell = Math.max(cap, incidence.meanLength * 0.5, 1e-12);
  const hashed = hashInteriorCells(interiors, cell);
  const reach = Math.max(2, Math.ceil((incidence.meanLength * 8) / cell));

  const candidateFaces = uniqueFillFaces(topology.fillFace);
  const neighbors = flapAdjacency(mesh, candidateFaces, incidence);
  const edgeFaces = buildEdgeFaces(mesh);
  const drop = new Uint8Array(mesh.indices.length / 3);
  const seen = new Uint8Array(mesh.indices.length / 3);
  let count = 0;

  for (const seed of candidateFaces) {
    if (seen[seed] || drop[seed]) continue;
    const component = growFlapComponent(seed, neighbors, MAX_FLAP_TRIS);
    if (component.length === 0 || component.length > MAX_FLAP_TRIS) {
      for (const f of component) seen[f] = 1;
      if (component.length === 0) seen[seed] = 1;
      continue;
    }
    for (const f of component) seen[f] = 1;
    if (!component.every((f) => faceOverlapsInterior(mesh, f, interiors, hashed, cell, reach, cap))) continue;
    if (!canDropFlap(mesh, component, incidence, drop, edgeFaces)) continue;
    for (const f of component) {
      if (!drop[f]) {
        drop[f] = 1;
        count++;
      }
    }
  }

  if (count === 0) return { mesh, count: 0 };
  const out: number[] = [];
  const { indices } = mesh;
  for (let t = 0; t < indices.length; t += 3) {
    if (drop[t / 3]) continue;
    out.push(indices[t], indices[t + 1], indices[t + 2]);
  }
  const next = { positions: mesh.positions, indices: new Uint32Array(out) };
  if (oneFaceCount(next) >= oneFaceCount(mesh)) return { mesh, count: 0 };
  return { mesh: next, count };
}

export function leftoverFlapStats(mesh: MeshData): LeftoverFlapStats {
  const topology = buildTopology(mesh);
  const leftoverOneFace = topology.fillFrom.length;
  const V = mesh.positions.length / 3;
  const valence = new Uint8Array(V);
  for (let i = 0; i < topology.fillFrom.length; i++) {
    valence[topology.fillFrom[i]]++;
    valence[topology.fillTo[i]]++;
  }
  let isolatedTwoVert = 0;
  const seenEdge = new Set<string>();
  for (let i = 0; i < topology.fillFrom.length; i++) {
    const a = topology.fillFrom[i];
    const b = topology.fillTo[i];
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (seenEdge.has(key)) continue;
    seenEdge.add(key);
    if (valence[a] === 1 && valence[b] === 1) isolatedTwoVert++;
  }

  const incidence = new EdgeIncidence(mesh);
  const interiors = collectInteriorTriangles(mesh, incidence);
  const cap = incidence.meanLength * OVERLAP_DIST;
  const cell = Math.max(cap, incidence.meanLength * 0.5, 1e-12);
  const hashed = interiors.length > 0 && cap > 0 ? hashInteriorCells(interiors, cell) : null;
  const reach = Math.max(2, Math.ceil((incidence.meanLength * 8) / cell));

  const faces = uniqueFillFaces(topology.fillFace);
  const neighbors = flapAdjacency(mesh, faces, incidence);
  const edgeFaces = buildEdgeFaces(mesh);
  const dists: number[] = [];
  const dots: number[] = [];
  let overlappingAndSafe = 0;
  let overlappingWouldTear = 0;
  let notOverlapping = 0;
  const seen = new Set<number>();

  for (const seed of faces) {
    if (seen.has(seed)) continue;
    const component = growFlapComponent(seed, neighbors, MAX_FLAP_TRIS);
    for (const f of component) seen.add(f);
    const probe = component.length > 0 ? component[0] : seed;
    const hit = nearestInteriorOverlap(mesh, probe, interiors, hashed, cell, reach);
    if (hit) {
      dists.push(hit.dist);
      dots.push(hit.normalDot);
    }
    const overlaps =
      cap > 0 &&
      hashed !== null &&
      component.length > 0 &&
      component.length <= MAX_FLAP_TRIS &&
      component.every((f) => faceOverlapsInterior(mesh, f, interiors, hashed, cell, reach, cap));
    if (!overlaps) {
      notOverlapping++;
      continue;
    }
    if (canDropFlap(mesh, component, incidence, new Uint8Array(mesh.indices.length / 3), edgeFaces)) overlappingAndSafe++;
    else overlappingWouldTear++;
  }

  const medianDist = median(dists);
  return {
    leftoverOneFace,
    isolatedTwoVert,
    meanEdge: incidence.meanLength,
    overlappingAndSafe,
    overlappingWouldTear,
    notOverlapping,
    medianOverlapDist: medianDist,
    medianNormalDot: median(dots),
    overlapDistVsMean: incidence.meanLength > 0 ? medianDist / incidence.meanLength : Infinity,
  };
}

/**
 * 1-face 정점이 안쪽(면이 둘인) 에지 위에 T자로 올라앉은 자리를 가른다.
 * 그 에지를 투영 지점에서 나누고 정점을 용접한다. 다른 테두리와는 짝을 짓지 않는다.
 * 후보를 한 건씩 적용하고, 전역 1-face가 줄어든 것만 남긴다.
 */
export function snapTJunctions(mesh: MeshData, limit: number): { mesh: MeshData; count: number } {
  let working = mesh;
  let count = 0;
  const max = Math.max(1, limit);
  for (let i = 0; i < max; i++) {
    const one = snapOneTJunction(working);
    if (!one) break;
    working = one;
    count++;
  }
  return { mesh: working, count };
}

function snapOneTJunction(mesh: MeshData): MeshData | null {
  const topology = buildTopology(mesh);
  if (topology.fillFrom.length === 0) return null;

  const incidence = new EdgeIncidence(mesh);
  const cap = incidence.meanLength * T_DIST;
  if (cap <= 0) return null;

  const segs = collectInteriorEdges(mesh, incidence);
  if (segs.length === 0) return null;

  const cell = Math.max(cap, incidence.meanLength * 0.5, 1e-12);
  const hashed = hashInteriorEdges(segs, cell);
  const reach = Math.max(2, Math.ceil((incidence.meanLength * 8) / cell));
  const partners = fillPartners(topology.fillFrom, topology.fillTo);
  const before = topology.boundaryEdgeCount;

  type VertHit = { vertex: number; u: number; v: number; t: number; d2: number };
  type EdgeHit = { a: number; b: number; u: number; v: number; tA: number; tB: number; d2: number; align: number };
  const onEdge2 = (incidence.meanLength * T_ONEDGE) ** 2;
  const verts: VertHit[] = [];

  for (const [vertex] of partners) {
    const p = vertexAt(mesh.positions, vertex);
    const hit = bestInteriorEdge(p, vertex, segs, hashed, cell, reach, cap, T_TMIN, T_TMAX);
    if (!hit || hit.d2 > onEdge2) continue;
    verts.push({ vertex, u: hit.u, v: hit.v, t: hit.t, d2: hit.d2 });
  }

  const tight = (incidence.meanLength * 0.08) ** 2;
  const edgeHits: EdgeHit[] = [];
  const seenAB = new Set<string>();
  for (let i = 0; i < topology.fillFrom.length; i++) {
    const a = topology.fillFrom[i];
    const b = topology.fillTo[i];
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (seenAB.has(key)) continue;
    seenAB.add(key);
    const pa = vertexAt(mesh.positions, a);
    const pb = vertexAt(mesh.positions, b);
    const ab = sub(pb, pa);
    const mid: Vec3 = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2];
    const ix = Math.floor(mid[0] / cell);
    const iy = Math.floor(mid[1] / cell);
    const iz = Math.floor(mid[2] / cell);
    let best: EdgeHit | null = null;
    const seen = new Set<number>();
    for (let dx = -reach; dx <= reach; dx++) {
      for (let dy = -reach; dy <= reach; dy++) {
        for (let dz = -reach; dz <= reach; dz++) {
          for (let cand = hashed.table.first(hash3(ix + dx, iy + dy, iz + dz)); cand >= 0; cand = hashed.table.after(cand)) {
            const seg = segs[hashed.segOf[cand]];
            if (seen.has(seg.id) || seg.u === a || seg.v === a || seg.u === b || seg.v === b) continue;
            seen.add(seg.id);
            const ha = closestOnSegment(pa, seg.pu, seg.pv);
            const hb = closestOnSegment(pb, seg.pu, seg.pv);
            if (ha.d2 > cap * cap || hb.d2 > cap * cap) continue;
            const uv = sub(seg.pv, seg.pu);
            const align = edgeAlign(ab, uv);
            const d2 = ha.d2 + hb.d2;
            if (best && d2 >= best.d2) continue;
            best = { a, b, u: seg.u, v: seg.v, tA: ha.t, tB: hb.t, d2, align };
          }
        }
      }
    }
    if (best && best.d2 <= 2 * tight && best.align >= 0.9) edgeHits.push(best);
  }

  verts.sort((x, y) => x.d2 - y.d2);
  edgeHits.sort((x, y) => x.d2 - y.d2);

  const vertCap = Math.min(verts.length, 16);
  for (let i = 0; i < vertCap; i++) {
    const next = applyVertT(mesh, verts[i]);
    if (next && oneFaceCount(next) < before) return next;
  }
  for (const hit of edgeHits) {
    const next = applyEdgeT(mesh, hit);
    if (next && oneFaceCount(next) < before) return next;
  }
  return null;
}

function edgeAlign(a: Vec3, b: Vec3): number {
  const la = length(a);
  const lb = length(b);
  if (la < 1e-18 || lb < 1e-18) return 0;
  return Math.abs(dot(a, b) / (la * lb));
}

function applyVertT(mesh: MeshData, hit: { vertex: number; u: number; v: number; t: number }): MeshData | null {
  const split = splitEdge(mesh, hit.u, hit.v, hit.t);
  if (!split) return null;
  const neu = split.positions.length / 3 - 1;
  return mergeVertexGroups(split, [[hit.vertex, neu]]);
}

function applyEdgeT(
  mesh: MeshData,
  hit: { a: number; b: number; u: number; v: number; tA: number; tB: number },
): MeshData | null {
  const pu = vertexAt(mesh.positions, hit.u);
  const pv = vertexAt(mesh.positions, hit.v);
  const pa = vertexAt(mesh.positions, hit.a);
  const pb = vertexAt(mesh.positions, hit.b);
  const anti = dist2(pa, pu) + dist2(pb, pv);
  const other = dist2(pa, pv) + dist2(pb, pu);
  const tLow = Math.min(hit.tA, hit.tB);
  const tHigh = Math.max(hit.tA, hit.tB);
  if (tLow <= T_TMIN && tHigh >= T_TMAX) {
    return mergeVertexGroups(mesh, [
      anti <= other ? [hit.a, hit.u] : [hit.a, hit.v],
      anti <= other ? [hit.b, hit.v] : [hit.b, hit.u],
    ]);
  }
  const t = (hit.tA + hit.tB) / 2;
  const split = splitEdge(mesh, hit.u, hit.v, t);
  if (!split) return null;
  const neu = split.positions.length / 3 - 1;
  const da = closestOnSegment(pa, pu, pv).t <= 0.5 ? hit.u : hit.v;
  return mergeVertexGroups(split, [
    [hit.a, tLow < 0.2 ? da : neu],
    [hit.b, tHigh > 0.8 ? (da === hit.u ? hit.v : hit.u) : neu],
  ]);
}

function fillPartners(from: Uint32Array, to: Uint32Array): Map<number, number[]> {
  const out = new Map<number, number[]>();
  const add = (a: number, b: number) => {
    const list = out.get(a);
    if (list) {
      if (!list.includes(b)) list.push(b);
    } else out.set(a, [b]);
  };
  for (let i = 0; i < from.length; i++) {
    add(from[i], to[i]);
    add(to[i], from[i]);
  }
  return out;
}

function bestInteriorEdge(
  p: Vec3,
  vertex: number,
  segs: { id: number; u: number; v: number; pu: Vec3; pv: Vec3 }[],
  hashed: { table: IntHashTable; segOf: Int32Array },
  cell: number,
  reach: number,
  cap: number,
  tMin: number,
  tMax: number,
): { u: number; v: number; t: number; d2: number } | null {
  const ix = Math.floor(p[0] / cell);
  const iy = Math.floor(p[1] / cell);
  const iz = Math.floor(p[2] / cell);
  let best: { u: number; v: number; t: number; d2: number } | null = null;
  const seen = new Set<number>();
  for (let dx = -reach; dx <= reach; dx++) {
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dz = -reach; dz <= reach; dz++) {
        for (let cand = hashed.table.first(hash3(ix + dx, iy + dy, iz + dz)); cand >= 0; cand = hashed.table.after(cand)) {
          const seg = segs[hashed.segOf[cand]];
          if (seen.has(seg.id) || seg.u === vertex || seg.v === vertex) continue;
          seen.add(seg.id);
          const hit = closestOnSegment(p, seg.pu, seg.pv);
          if (hit.t < tMin || hit.t > tMax || hit.d2 > cap * cap) continue;
          if (best && hit.d2 >= best.d2) continue;
          best = { u: seg.u, v: seg.v, t: hit.t, d2: hit.d2 };
        }
      }
    }
  }
  return best;
}

export function leftoverTJunctionStats(mesh: MeshData): LeftoverTJunctionStats {
  const topology = buildTopology(mesh);
  const leftoverOneFace = topology.fillFrom.length;
  const incidence = new EdgeIncidence(mesh);
  const interiors = collectInteriorTriangles(mesh, incidence);
  const cap = incidence.meanLength * T_DIST;
  const verts = uniqueFillVerts(topology.fillFrom, topology.fillTo);
  const segs = collectInteriorEdges(mesh, incidence);
  const partners = fillPartners(topology.fillFrom, topology.fillTo);
  const cell = Math.max(cap, incidence.meanLength * 0.5, 1e-12);
  const hashed = segs.length > 0 && cap > 0 ? hashInteriorEdges(segs, cell) : null;
  const hashedFaces = interiors.length > 0 && cap > 0 ? hashInteriorCells(interiors, cell) : null;
  const reach = Math.max(2, Math.ceil((incidence.meanLength * 8) / cell));

  const edgeDists: number[] = [];
  let projectToInteriorEdge = 0;
  let trueTSpoke = 0;
  let nearbyOnly = 0;
  let projectToInteriorFace = 0;
  let projectNeither = 0;
  let edgeOnInteriorEdge = 0;
  let onEdge02 = 0;
  let onEdge05 = 0;
  let onEdge10 = 0;

  const seenAB = new Set<string>();
  if (hashed && cap > 0) {
    for (let i = 0; i < topology.fillFrom.length; i++) {
      const a = topology.fillFrom[i];
      const b = topology.fillTo[i];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (seenAB.has(key)) continue;
      seenAB.add(key);
      const pa = vertexAt(mesh.positions, a);
      const pb = vertexAt(mesh.positions, b);
      const mid: Vec3 = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2];
      const ix = Math.floor(mid[0] / cell);
      const iy = Math.floor(mid[1] / cell);
      const iz = Math.floor(mid[2] / cell);
      const seen = new Set<number>();
      let found = false;
      for (let dx = -reach; dx <= reach && !found; dx++) {
        for (let dy = -reach; dy <= reach && !found; dy++) {
          for (let dz = -reach; dz <= reach && !found; dz++) {
            for (let cand = hashed.table.first(hash3(ix + dx, iy + dy, iz + dz)); cand >= 0; cand = hashed.table.after(cand)) {
              const seg = segs[hashed.segOf[cand]];
              if (seen.has(seg.id) || seg.u === a || seg.v === a || seg.u === b || seg.v === b) continue;
              seen.add(seg.id);
              const ha = closestOnSegment(pa, seg.pu, seg.pv);
              const hb = closestOnSegment(pb, seg.pu, seg.pv);
              if (ha.d2 <= cap * cap && hb.d2 <= cap * cap) {
                edgeOnInteriorEdge++;
                found = true;
                break;
              }
            }
          }
        }
      }
    }
  }

  for (const vertex of verts) {
    const p = vertexAt(mesh.positions, vertex);
    let bestEdge = Infinity;
    let bestFace = Infinity;
    if (hashed) {
      const ix = Math.floor(p[0] / cell);
      const iy = Math.floor(p[1] / cell);
      const iz = Math.floor(p[2] / cell);
      const seen = new Set<number>();
      for (let dx = -reach; dx <= reach; dx++) {
        for (let dy = -reach; dy <= reach; dy++) {
          for (let dz = -reach; dz <= reach; dz++) {
            for (let cand = hashed.table.first(hash3(ix + dx, iy + dy, iz + dz)); cand >= 0; cand = hashed.table.after(cand)) {
              const seg = segs[hashed.segOf[cand]];
              if (seen.has(seg.id) || seg.u === vertex || seg.v === vertex) continue;
              seen.add(seg.id);
              const hit = closestOnSegment(p, seg.pu, seg.pv);
              if (hit.t < T_TMIN || hit.t > T_TMAX) continue;
              const dist = Math.sqrt(hit.d2);
              if (dist < bestEdge) bestEdge = dist;
            }
          }
        }
      }
    }
    if (hashedFaces) {
      const ix = Math.floor(p[0] / cell);
      const iy = Math.floor(p[1] / cell);
      const iz = Math.floor(p[2] / cell);
      const seenTri = new Set<number>();
      for (let dx = -reach; dx <= reach; dx++) {
        for (let dy = -reach; dy <= reach; dy++) {
          for (let dz = -reach; dz <= reach; dz++) {
            for (let cand = hashedFaces.table.first(hash3(ix + dx, iy + dy, iz + dz)); cand >= 0; cand = hashedFaces.table.after(cand)) {
              const tri = interiors[hashedFaces.triOf[cand]];
              if (seenTri.has(tri.face) || tri.a === vertex || tri.b === vertex || tri.c === vertex) continue;
              seenTri.add(tri.face);
              const hit = closestOnTriangle(p, tri.pa, tri.pb, tri.pc);
              if (hit.kind !== 'face') continue;
              const dist = Math.sqrt(hit.d2);
              if (dist < bestFace) bestFace = dist;
            }
          }
        }
      }
    }
    const edgeHit = bestEdge <= cap;
    const faceHit = bestFace <= cap;
    if (edgeHit) {
      projectToInteriorEdge++;
      edgeDists.push(bestEdge);
      const vsMean = incidence.meanLength > 0 ? bestEdge / incidence.meanLength : Infinity;
      if (vsMean <= 0.02) onEdge02++;
      if (vsMean <= 0.05) onEdge05++;
      if (vsMean <= 0.10) onEdge10++;
      const hit = hashed ? bestInteriorEdge(p, vertex, segs, hashed, cell, reach, cap, T_TMIN, T_TMAX) : null;
      const neigh = partners.get(vertex) ?? [];
      if (hit && (neigh.includes(hit.u) || neigh.includes(hit.v))) trueTSpoke++;
      else nearbyOnly++;
    } else if (faceHit) projectToInteriorFace++;
    else projectNeither++;
  }

  const faces = uniqueFillFaces(topology.fillFace);
  let faces221 = 0;
  let centroidOnEdge = 0;
  let centroidOnVertex = 0;
  let centroidOnFace = 0;
  for (const face of faces) {
    const o = face * 3;
    const ia = mesh.indices[o];
    const ib = mesh.indices[o + 1];
    const ic = mesh.indices[o + 2];
    const counts = [incidence.count(ia, ib), incidence.count(ib, ic), incidence.count(ic, ia)];
    const ones = counts.filter((c) => c === 1).length;
    const twos = counts.filter((c) => c >= 2).length;
    if (ones === 1 && twos === 2) faces221++;
    const pa = vertexAt(mesh.positions, ia);
    const pb = vertexAt(mesh.positions, ib);
    const pc = vertexAt(mesh.positions, ic);
    const centroid: Vec3 = [(pa[0] + pb[0] + pc[0]) / 3, (pa[1] + pb[1] + pc[1]) / 3, (pa[2] + pb[2] + pc[2]) / 3];
    if (!hashedFaces) continue;
    const ix = Math.floor(centroid[0] / cell);
    const iy = Math.floor(centroid[1] / cell);
    const iz = Math.floor(centroid[2] / cell);
    let bestKind: 'vertex' | 'edge' | 'face' | null = null;
    let bestD = cap + 1;
    const seenTri = new Set<number>();
    for (let dx = -reach; dx <= reach; dx++) {
      for (let dy = -reach; dy <= reach; dy++) {
        for (let dz = -reach; dz <= reach; dz++) {
          for (let cand = hashedFaces.table.first(hash3(ix + dx, iy + dy, iz + dz)); cand >= 0; cand = hashedFaces.table.after(cand)) {
            const tri = interiors[hashedFaces.triOf[cand]];
            if (seenTri.has(tri.face) || tri.face === face) continue;
            seenTri.add(tri.face);
            const hit = closestOnTriangle(centroid, tri.pa, tri.pb, tri.pc);
            const dist = Math.sqrt(hit.d2);
            if (dist > cap || dist >= bestD) continue;
            bestD = dist;
            bestKind = hit.kind;
          }
        }
      }
    }
    if (bestKind === 'edge') centroidOnEdge++;
    else if (bestKind === 'vertex') centroidOnVertex++;
    else if (bestKind === 'face') centroidOnFace++;
  }

  const medianEdge = median(edgeDists);
  return {
    leftoverOneFace,
    leftoverVerts: verts.length,
    meanEdge: incidence.meanLength,
    projectToInteriorEdge,
    trueTSpoke,
    edgeOnInteriorEdge,
    nearbyOnly,
    projectToInteriorFace,
    projectNeither,
    faces221,
    centroidOnEdge,
    centroidOnVertex,
    centroidOnFace,
    onEdge02,
    onEdge05,
    onEdge10,
    medianEdgeDist: medianEdge,
    edgeDistVsMean: incidence.meanLength > 0 ? medianEdge / incidence.meanLength : Infinity,
  };
}

function uniqueFillVerts(from: Uint32Array, to: Uint32Array): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (let i = 0; i < from.length; i++) {
    for (const v of [from[i], to[i]]) {
      if (seen.has(v)) continue;
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

function collectInteriorEdges(
  mesh: MeshData,
  incidence: EdgeIncidence,
): { id: number; u: number; v: number; pu: Vec3; pv: Vec3 }[] {
  const { indices, positions } = mesh;
  const seen = new Set<string>();
  const out: { id: number; u: number; v: number; pu: Vec3; pv: Vec3 }[] = [];
  for (let t = 0; t < indices.length; t += 3) {
    const vs = [indices[t], indices[t + 1], indices[t + 2]];
    for (let k = 0; k < 3; k++) {
      const u = vs[k];
      const v = vs[(k + 1) % 3];
      if (incidence.count(u, v) < 2) continue;
      const key = u < v ? `${u}:${v}` : `${v}:${u}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        id: out.length,
        u: u < v ? u : v,
        v: u < v ? v : u,
        pu: vertexAt(positions, u < v ? u : v),
        pv: vertexAt(positions, u < v ? v : u),
      });
    }
  }
  return out;
}

function hashInteriorEdges(
  segs: { pu: Vec3; pv: Vec3 }[],
  cell: number,
): { table: IntHashTable; segOf: Int32Array } {
  const ids: number[] = [];
  const keys: number[] = [];
  const push = (ix: number, iy: number, iz: number, i: number) => {
    keys.push(hash3(ix, iy, iz));
    ids.push(i);
  };
  for (let i = 0; i < segs.length; i++) {
    const a = segs[i].pu;
    const b = segs[i].pv;
    const x0 = Math.floor(Math.min(a[0], b[0]) / cell);
    const y0 = Math.floor(Math.min(a[1], b[1]) / cell);
    const z0 = Math.floor(Math.min(a[2], b[2]) / cell);
    const x1 = Math.floor(Math.max(a[0], b[0]) / cell);
    const y1 = Math.floor(Math.max(a[1], b[1]) / cell);
    const z1 = Math.floor(Math.max(a[2], b[2]) / cell);
    const span = (x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1);
    if (span <= 32) {
      for (let ix = x0; ix <= x1; ix++) {
        for (let iy = y0; iy <= y1; iy++) {
          for (let iz = z0; iz <= z1; iz++) push(ix, iy, iz, i);
        }
      }
    } else {
      push(Math.floor((a[0] + b[0]) * 0.5 / cell), Math.floor((a[1] + b[1]) * 0.5 / cell), Math.floor((a[2] + b[2]) * 0.5 / cell), i);
      push(Math.floor(a[0] / cell), Math.floor(a[1] / cell), Math.floor(a[2] / cell), i);
      push(Math.floor(b[0] / cell), Math.floor(b[1] / cell), Math.floor(b[2] / cell), i);
    }
  }
  const table = new IntHashTable(ids.length);
  const segOf = new Int32Array(ids.length);
  for (let i = 0; i < ids.length; i++) {
    segOf[i] = ids[i];
    table.insert(keys[i], i);
  }
  return { table, segOf };
}

function closestOnSegment(p: Vec3, a: Vec3, b: Vec3): { t: number; q: Vec3; d2: number } {
  const ab = sub(b, a);
  const denom = dot(ab, ab);
  const t = denom > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / denom)) : 0;
  const q: Vec3 = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
  return { t, q, d2: dist2(p, q) };
}

function uniqueFillFaces(fillFace: Uint32Array): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (let i = 0; i < fillFace.length; i++) {
    const f = fillFace[i];
    if (seen.has(f)) continue;
    seen.add(f);
    out.push(f);
  }
  return out;
}

function flapAdjacency(mesh: MeshData, faces: number[], incidence: EdgeIncidence): Map<number, number[]> {
  const edgeFaces = new Map<string, number[]>();
  const add = (a: number, b: number, face: number) => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    const list = edgeFaces.get(key);
    if (list) list.push(face);
    else edgeFaces.set(key, [face]);
  };
  const { indices } = mesh;
  const faceSet = new Set(faces);
  for (const face of faces) {
    const o = face * 3;
    add(indices[o], indices[o + 1], face);
    add(indices[o + 1], indices[o + 2], face);
    add(indices[o + 2], indices[o], face);
  }
  const neighbors = new Map<number, number[]>();
  for (const face of faces) neighbors.set(face, []);
  for (const [key, list] of edgeFaces) {
    if (list.length < 2) continue;
    const [lo, hi] = key.split(':').map(Number);
    if (incidence.count(lo, hi) >= 3) continue;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (!faceSet.has(list[i]) || !faceSet.has(list[j])) continue;
        neighbors.get(list[i])!.push(list[j]);
        neighbors.get(list[j])!.push(list[i]);
      }
    }
  }
  return neighbors;
}

function growFlapComponent(seed: number, neighbors: Map<number, number[]>, maxN: number): number[] {
  const out = [seed];
  const seen = new Set([seed]);
  for (let i = 0; i < out.length; i++) {
    if (out.length > maxN) return out;
    for (const n of neighbors.get(out[i]) ?? []) {
      if (seen.has(n)) continue;
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

function canDropFlap(
  mesh: MeshData,
  faces: number[],
  incidence: EdgeIncidence,
  already: Uint8Array,
  edgeFaces: Map<string, number[]>,
): boolean {
  const drop = new Set(faces);
  const { indices } = mesh;
  for (const face of faces) {
    if (already[face]) continue;
    const o = face * 3;
    const edges: [number, number][] = [
      [indices[o], indices[o + 1]],
      [indices[o + 1], indices[o + 2]],
      [indices[o + 2], indices[o]],
    ];
    for (const [a, b] of edges) {
      if (incidence.count(a, b) !== 2) continue;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const others = (edgeFaces.get(key) ?? []).filter((f) => !drop.has(f) && !already[f]);
      if (others.length > 0) return false;
    }
  }
  return true;
}

function buildEdgeFaces(mesh: MeshData): Map<string, number[]> {
  const { indices } = mesh;
  const out = new Map<string, number[]>();
  const add = (a: number, b: number, face: number) => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    const list = out.get(key);
    if (list) list.push(face);
    else out.set(key, [face]);
  };
  for (let t = 0; t < indices.length; t += 3) {
    const face = t / 3;
    add(indices[t], indices[t + 1], face);
    add(indices[t + 1], indices[t + 2], face);
    add(indices[t + 2], indices[t], face);
  }
  return out;
}

function faceOverlapsInterior(
  mesh: MeshData,
  face: number,
  interiors: ReturnType<typeof collectInteriorTriangles>,
  hashed: { table: IntHashTable; triOf: Int32Array },
  cell: number,
  reach: number,
  cap: number,
): boolean {
  const hit = nearestInteriorOverlap(mesh, face, interiors, hashed, cell, reach);
  if (!hit || hit.kind !== 'face' || hit.dist > cap) return false;
  if (hit.normalDot < OVERLAP_NORMAL) return false;
  const o = face * 3;
  const cap2 = cap * cap;
  for (const v of [mesh.indices[o], mesh.indices[o + 1], mesh.indices[o + 2]]) {
    const p = vertexAt(mesh.positions, v);
    const d2 = closestOnTriangle(p, hit.pa, hit.pb, hit.pc).d2;
    if (d2 > cap2) return false;
  }
  return true;
}

function nearestInteriorOverlap(
  mesh: MeshData,
  face: number,
  interiors: ReturnType<typeof collectInteriorTriangles>,
  hashed: { table: IntHashTable; triOf: Int32Array } | null,
  cell: number,
  reach: number,
): { dist: number; normalDot: number; kind: 'vertex' | 'edge' | 'face'; pa: Vec3; pb: Vec3; pc: Vec3 } | null {
  if (!hashed || interiors.length === 0) return null;
  const o = face * 3;
  const ia = mesh.indices[o];
  const ib = mesh.indices[o + 1];
  const ic = mesh.indices[o + 2];
  const pa = vertexAt(mesh.positions, ia);
  const pb = vertexAt(mesh.positions, ib);
  const pc = vertexAt(mesh.positions, ic);
  const centroid: Vec3 = [(pa[0] + pb[0] + pc[0]) / 3, (pa[1] + pb[1] + pc[1]) / 3, (pa[2] + pb[2] + pc[2]) / 3];
  const n = normalize(triangleNormalRaw(pa, pb, pc));
  const ix = Math.floor(centroid[0] / cell);
  const iy = Math.floor(centroid[1] / cell);
  const iz = Math.floor(centroid[2] / cell);
  let best: { dist: number; normalDot: number; kind: 'vertex' | 'edge' | 'face'; pa: Vec3; pb: Vec3; pc: Vec3 } | null = null;
  const seenTri = new Set<number>();
  for (let dx = -reach; dx <= reach; dx++) {
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dz = -reach; dz <= reach; dz++) {
        for (let cand = hashed.table.first(hash3(ix + dx, iy + dy, iz + dz)); cand >= 0; cand = hashed.table.after(cand)) {
          const tri = interiors[hashed.triOf[cand]];
          if (seenTri.has(tri.face) || tri.face === face) continue;
          seenTri.add(tri.face);
          const nd = dot(n, tri.normal);
          if (nd < OVERLAP_NORMAL) continue;
          const hit = closestOnTriangle(centroid, tri.pa, tri.pb, tri.pc);
          const dist = Math.sqrt(hit.d2);
          if (best && dist >= best.dist) continue;
          best = { dist, normalDot: nd, kind: hit.kind, pa: tri.pa, pb: tri.pb, pc: tri.pc };
        }
      }
    }
  }
  return best;
}

function oneFaceCount(mesh: MeshData): number {
  return buildTopology(mesh).boundaryEdgeCount;
}

function snapDanglingVerts(
  mesh: MeshData,
  opts: { allowOnSurface: boolean; limit: number },
): { mesh: MeshData; count: number } {
  const topology = buildTopology(mesh);
  if (topology.fillFrom.length === 0) return { mesh, count: 0 };

  const incidence = new EdgeIncidence(mesh);
  const local = computeVertexMeanEdge(mesh);
  const bounds = computeBounds(mesh.positions);
  const globalCap = Math.min(incidence.meanLength * SNAP_LOCAL, bounds.diagonal * SNAP_DIAG);
  if (globalCap <= 0) return { mesh, count: 0 };

  const dangling = collectDangling(mesh, topology.fillFrom, topology.fillTo, topology.fillFace);
  if (dangling.length === 0) return { mesh, count: 0 };

  const interiors = collectInteriorTriangles(mesh, incidence);
  if (interiors.length === 0) return { mesh, count: 0 };

  const onSurface = markSurfaceVerts(mesh, incidence);
  const cell = Math.max(globalCap, incidence.meanLength * 0.5, 1e-12);
  const hashed = hashInteriorCells(interiors, cell);

  type Hit = {
    vertex: number;
    face: number;
    q: Vec3;
    kind: 'vertex' | 'edge' | 'face';
    a: number;
    b: number;
    c: number;
    u: number;
    v: number;
    t: number;
  };
  const hits: Hit[] = [];
  const usedVert = new Set<number>();

  for (const d of dangling) {
    if (!opts.allowOnSurface && onSurface[d.vertex] === 1) continue;
    if (usedVert.has(d.vertex)) continue;
    const cap = Math.min(globalCap, Math.max(local[d.vertex], 1e-12) * SNAP_LOCAL);
    const p = d.pos;
    const ix = Math.floor(p[0] / cell);
    const iy = Math.floor(p[1] / cell);
    const iz = Math.floor(p[2] / cell);
    let best: Hit | null = null;
    let bestD2 = cap * cap + 1e-18;

    const reach = Math.max(2, Math.ceil(Math.max(cap, incidence.meanLength * 8) / cell));
    const seenTri = new Set<number>();
    for (let dx = -reach; dx <= reach; dx++) {
      for (let dy = -reach; dy <= reach; dy++) {
        for (let dz = -reach; dz <= reach; dz++) {
          for (let cand = hashed.table.first(hash3(ix + dx, iy + dy, iz + dz)); cand >= 0; cand = hashed.table.after(cand)) {
            const tri = interiors[hashed.triOf[cand]];
            if (seenTri.has(tri.face)) continue;
            seenTri.add(tri.face);
            if (tri.a === d.vertex || tri.b === d.vertex || tri.c === d.vertex) continue;
            const hit = closestOnTriangle(p, tri.pa, tri.pb, tri.pc);
            if (hit.d2 >= bestD2) continue;
            if (!passesSnapGate(d, tri, hit, local, globalCap, onSurface[d.vertex] === 1)) continue;
            if (hit.kind === 'edge') {
              const u = hit.edge === 0 ? tri.a : hit.edge === 1 ? tri.b : tri.c;
              const v = hit.edge === 0 ? tri.b : hit.edge === 1 ? tri.c : tri.a;
              if (incidence.count(u, v) < 2) continue;
            }
            bestD2 = hit.d2;
            const eu = hit.edge === 0 ? tri.a : hit.edge === 1 ? tri.b : tri.c;
            const ev = hit.edge === 0 ? tri.b : hit.edge === 1 ? tri.c : tri.a;
            best = {
              vertex: d.vertex,
              face: tri.face,
              q: hit.q,
              kind: hit.kind,
              a: tri.a,
              b: tri.b,
              c: tri.c,
              u: eu,
              v: ev,
              t: hit.t,
            };
          }
        }
      }
    }

    if (!best) continue;
    const dest = nearestOf(best.q, [
      [best.a, vertexAt(mesh.positions, best.a)],
      [best.b, vertexAt(mesh.positions, best.b)],
      [best.c, vertexAt(mesh.positions, best.c)],
    ]);
    const destPos = vertexAt(mesh.positions, dest);
    if (best.kind !== 'vertex' && dist2(best.q, destPos) <= (NEAR_VERTEX * Math.max(local[d.vertex], incidence.meanLength)) ** 2) {
      best.kind = 'vertex';
    }
    usedVert.add(best.vertex);
    hits.push(best);
  }

  if (hits.length === 0) return { mesh, count: 0 };
  hits.sort((a, b) => dist2(a.q, vertexAt(mesh.positions, a.vertex)) - dist2(b.q, vertexAt(mesh.positions, b.vertex)));
  const chosen = hits.slice(0, Math.max(1, opts.limit));

  const vertexHits = chosen.filter((h) => h.kind === 'vertex');
  if (vertexHits.length > 0) {
    const groups = vertexHits
      .map((h) => {
        const dest = nearestOf(h.q, [
          [h.a, vertexAt(mesh.positions, h.a)],
          [h.b, vertexAt(mesh.positions, h.b)],
          [h.c, vertexAt(mesh.positions, h.c)],
        ]);
        return dest === h.vertex ? null : [h.vertex, dest];
      })
      .filter((g): g is number[] => g !== null);
    if (groups.length === 0) return { mesh, count: 0 };
    return { mesh: mergeVertexGroups(mesh, groups), count: groups.length };
  }

  const faceHits = chosen.filter((h) => h.kind === 'face');
  if (faceHits.length > 0) {
    const applied = applyFaceSnaps(mesh, faceHits);
    if (applied) return applied;
  }

  const edgeHits = chosen.filter((h) => h.kind === 'edge');
  if (edgeHits.length > 0) {
    const applied = applyEdgeSnaps(mesh, edgeHits);
    if (applied) return applied;
  }

  return { mesh, count: 0 };
}

function stitchIsolatedToInterior(mesh: MeshData, limit: number): { mesh: MeshData; count: number } {
  const topology = buildTopology(mesh);
  if (topology.fillFrom.length === 0) return { mesh, count: 0 };

  const incidence = new EdgeIncidence(mesh);
  const local = computeVertexMeanEdge(mesh);
  const bounds = computeBounds(mesh.positions);
  const globalCap = Math.min(incidence.meanLength * SNAP_LOCAL, bounds.diagonal * SNAP_DIAG);
  if (globalCap <= 0) return { mesh, count: 0 };

  const interiors = collectInteriorTriangles(mesh, incidence);
  if (interiors.length === 0) return { mesh, count: 0 };

  const cell = Math.max(globalCap, incidence.meanLength * 0.5, 1e-12);
  const hashed = hashInteriorCells(interiors, cell);
  const dangling = collectDangling(mesh, topology.fillFrom, topology.fillTo, topology.fillFace);
  const byVert = new Map(dangling.map((d) => [d.vertex, d]));

  const extra: number[] = [];
  const usedVert = new Set<number>();
  const usedQ = new Set<number>();
  const seen = new Set<string>();

  for (let i = 0; i < topology.fillFrom.length && extra.length / 3 < limit; i++) {
    const a = topology.fillFrom[i];
    const b = topology.fillTo[i];
    const fo = topology.fillFace[i] * 3;
    const third = [mesh.indices[fo], mesh.indices[fo + 1], mesh.indices[fo + 2]].find((v) => v !== a && v !== b) ?? -1;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (seen.has(key) || usedVert.has(a) || usedVert.has(b)) continue;
    seen.add(key);
    const da = byVert.get(a);
    const db = byVert.get(b);
    if (!da || !db) continue;

    const mid: Vec3 = [(da.pos[0] + db.pos[0]) / 2, (da.pos[1] + db.pos[1]) / 2, (da.pos[2] + db.pos[2]) / 2];
    const cap = Math.min(globalCap, Math.max(local[a], local[b], 1e-12) * SNAP_LOCAL);
    const ix = Math.floor(mid[0] / cell);
    const iy = Math.floor(mid[1] / cell);
    const iz = Math.floor(mid[2] / cell);
    const reach = Math.max(2, Math.ceil(Math.max(cap, incidence.meanLength * 8) / cell));
    const seenTri = new Set<number>();
    let bestQ = -1;
    let bestD2 = cap * cap + 1e-18;
    let bestTri: (typeof interiors)[number] | null = null;

    for (let dx = -reach; dx <= reach; dx++) {
      for (let dy = -reach; dy <= reach; dy++) {
        for (let dz = -reach; dz <= reach; dz++) {
          for (let cand = hashed.table.first(hash3(ix + dx, iy + dy, iz + dz)); cand >= 0; cand = hashed.table.after(cand)) {
            const tri = interiors[hashed.triOf[cand]];
            if (seenTri.has(tri.face)) continue;
            seenTri.add(tri.face);
            if (tri.a === a || tri.b === a || tri.c === a || tri.a === b || tri.b === b || tri.c === b) continue;
            const hit = closestOnTriangle(mid, tri.pa, tri.pb, tri.pc);
            if (!passesSnapGate({ vertex: a, pos: mid, normal: da.normal }, tri, hit, local, globalCap, true)) continue;
            for (const q of [tri.a, tri.b, tri.c]) {
              if (usedQ.has(q) || q === a || q === b || q === third) continue;
              const aq = incidence.count(a, q);
              const bq = incidence.count(b, q);
              if (aq < 1 || bq < 1) continue;
              if (aq >= 3 || bq >= 3) continue;
              const d2 = dist2(mid, vertexAt(mesh.positions, q));
              if (d2 >= bestD2) continue;
              bestD2 = d2;
              bestQ = q;
              bestTri = tri;
            }
          }
        }
      }
    }

    if (bestQ < 0 || !bestTri) continue;
    if (dot(da.normal, bestTri.normal) < NORMAL_ALIGN) continue;
    extra.push(a, b, bestQ);
    usedVert.add(a);
    usedVert.add(b);
    usedQ.add(bestQ);
  }

  if (extra.length === 0) return { mesh, count: 0 };
  const indices = new Uint32Array(mesh.indices.length + extra.length);
  indices.set(mesh.indices);
  indices.set(extra, mesh.indices.length);
  return { mesh: { positions: mesh.positions, indices }, count: extra.length / 3 };
}


function passesSnapGate(
  d: { vertex: number; pos: Vec3; normal: Vec3 },
  tri: { normal: Vec3 },
  hit: { q: Vec3; d2: number },
  local: ArrayLike<number>,
  globalCap: number,
  onSurface: boolean,
): boolean {
  if (dot(d.normal, tri.normal) < NORMAL_ALIGN) return false;
  const cap = Math.min(globalCap, Math.max(local[d.vertex], 1e-12) * SNAP_LOCAL);
  const moveCap = onSurface ? Math.min(cap, Math.max(local[d.vertex], 1e-12) * SURFACE_MOVE) : cap;
  if (hit.d2 > moveCap * moveCap) return false;
  const gap = sub(hit.q, d.pos);
  const planeDist = Math.abs(dot(gap, d.normal));
  if (planeDist > moveCap * INPLANE) return false;
  return true;
}

function hashInteriorCells(
  interiors: { pa: Vec3; pb: Vec3; pc: Vec3; centroid: Vec3 }[],
  cell: number,
): { table: IntHashTable; triOf: Int32Array } {
  const ids: number[] = [];
  const keys: number[] = [];
  const push = (ix: number, iy: number, iz: number, tri: number) => {
    keys.push(hash3(ix, iy, iz));
    ids.push(tri);
  };

  for (let i = 0; i < interiors.length; i++) {
    const t = interiors[i];
    const minx = Math.min(t.pa[0], t.pb[0], t.pc[0]);
    const miny = Math.min(t.pa[1], t.pb[1], t.pc[1]);
    const minz = Math.min(t.pa[2], t.pb[2], t.pc[2]);
    const maxx = Math.max(t.pa[0], t.pb[0], t.pc[0]);
    const maxy = Math.max(t.pa[1], t.pb[1], t.pc[1]);
    const maxz = Math.max(t.pa[2], t.pb[2], t.pc[2]);
    const x0 = Math.floor(minx / cell);
    const y0 = Math.floor(miny / cell);
    const z0 = Math.floor(minz / cell);
    const x1 = Math.floor(maxx / cell);
    const y1 = Math.floor(maxy / cell);
    const z1 = Math.floor(maxz / cell);
    const span = (x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1);
    if (span <= 64) {
      for (let ix = x0; ix <= x1; ix++) {
        for (let iy = y0; iy <= y1; iy++) {
          for (let iz = z0; iz <= z1; iz++) push(ix, iy, iz, i);
        }
      }
    } else {
      push(Math.floor(t.centroid[0] / cell), Math.floor(t.centroid[1] / cell), Math.floor(t.centroid[2] / cell), i);
      push(Math.floor(t.pa[0] / cell), Math.floor(t.pa[1] / cell), Math.floor(t.pa[2] / cell), i);
      push(Math.floor(t.pb[0] / cell), Math.floor(t.pb[1] / cell), Math.floor(t.pb[2] / cell), i);
      push(Math.floor(t.pc[0] / cell), Math.floor(t.pc[1] / cell), Math.floor(t.pc[2] / cell), i);
    }
  }

  const table = new IntHashTable(ids.length);
  const triOf = new Int32Array(ids.length);
  for (let i = 0; i < ids.length; i++) {
    triOf[i] = ids[i];
    table.insert(keys[i], i);
  }
  return { table, triOf };
}

function markSurfaceVerts(mesh: MeshData, incidence: EdgeIncidence): Uint8Array {
  const { indices } = mesh;
  const out = new Uint8Array(mesh.positions.length / 3);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t];
    const b = indices[t + 1];
    const c = indices[t + 2];
    if (incidence.count(a, b) >= 2) {
      out[a] = 1;
      out[b] = 1;
    }
    if (incidence.count(b, c) >= 2) {
      out[b] = 1;
      out[c] = 1;
    }
    if (incidence.count(c, a) >= 2) {
      out[c] = 1;
      out[a] = 1;
    }
  }
  return out;
}

function applyFaceSnaps(
  mesh: MeshData,
  hits: { vertex: number; q: Vec3; a: number; b: number; c: number; face: number }[],
): { mesh: MeshData; count: number } | null {
  const groups = new Map<number, typeof hits>();
  const used = new Set<number>();
  for (const hit of hits) {
    if (used.has(hit.vertex)) continue;
    used.add(hit.vertex);
    const list = groups.get(hit.face);
    if (list) list.push(hit);
    else groups.set(hit.face, [hit]);
  }
  if (groups.size === 0) return null;

  const skip = new Set<number>();
  const extra: number[] = [];
  const pairs: number[][] = [];
  let positions = new Float32Array(mesh.positions);
  let next = positions.length / 3;

  const grow = (q: Vec3): number => {
    const grown = new Float32Array(positions.length + 3);
    grown.set(positions);
    grown[next * 3] = q[0];
    grown[next * 3 + 1] = q[1];
    grown[next * 3 + 2] = q[2];
    positions = grown;
    return next++;
  };

  for (const group of groups.values()) {
    const { a, b, c, face } = group[0];
    skip.add(face);
    const steiners: number[] = [];
    for (const hit of group) {
      const s = grow(hit.q);
      steiners.push(s);
      pairs.push([hit.vertex, s]);
    }
    let tris: [number, number, number][] = [[a, b, c]];
    for (const s of steiners) {
      const q = vertexAt(positions, s);
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < tris.length; i++) {
        const [ta, tb, tc] = tris[i];
        const d2 = closestOnTriangle(q, vertexAt(positions, ta), vertexAt(positions, tb), vertexAt(positions, tc)).d2;
        if (d2 < bestD) {
          bestD = d2;
          best = i;
        }
      }
      const [ta, tb, tc] = tris[best];
      tris.splice(best, 1, [ta, tb, s], [tb, tc, s], [tc, ta, s]);
    }
    for (const t of tris) extra.push(t[0], t[1], t[2]);
  }

  const { indices } = mesh;
  const out: number[] = [];
  for (let t0 = 0; t0 < indices.length; t0 += 3) {
    if (skip.has(t0 / 3)) continue;
    out.push(indices[t0], indices[t0 + 1], indices[t0 + 2]);
  }
  out.push(...extra);
  const split: MeshData = { positions, indices: new Uint32Array(out) };
  return { mesh: mergeVertexGroups(split, pairs), count: pairs.length };
}

function applyEdgeSnaps(
  mesh: MeshData,
  hits: { vertex: number; q: Vec3; u: number; v: number; t: number }[],
): { mesh: MeshData; count: number } | null {
  const byEdge = new Map<string, typeof hits>();
  const used = new Set<number>();
  for (const hit of hits) {
    if (used.has(hit.vertex)) continue;
    used.add(hit.vertex);
    const key = hit.u < hit.v ? `${hit.u}:${hit.v}` : `${hit.v}:${hit.u}`;
    const list = byEdge.get(key);
    if (list) list.push(hit);
    else byEdge.set(key, [hit]);
  }
  if (byEdge.size === 0) return null;

  let working = mesh;
  let count = 0;
  for (const group of byEdge.values()) {
    const hit = group[0];
    const split = splitEdge(working, hit.u, hit.v, hit.t);
    if (!split) continue;
    const neu = split.positions.length / 3 - 1;
    working = mergeVertexGroups(split, [[hit.vertex, neu]]);
    count++;
    break;
  }
  return count > 0 ? { mesh: working, count } : null;
}

function collectDangling(
  mesh: MeshData,
  from: Uint32Array,
  to: Uint32Array,
  face: Uint32Array,
): { vertex: number; pos: Vec3; normal: Vec3 }[] {
  const acc = new Map<number, { x: number; y: number; z: number }>();
  for (let i = 0; i < from.length; i++) {
    const n = faceNormal(mesh, face[i]);
    for (const v of [from[i], to[i]]) {
      const cur = acc.get(v);
      if (cur) {
        cur.x += n[0];
        cur.y += n[1];
        cur.z += n[2];
      } else acc.set(v, { x: n[0], y: n[1], z: n[2] });
    }
  }
  const out: { vertex: number; pos: Vec3; normal: Vec3 }[] = [];
  for (const [vertex, s] of acc) {
    out.push({
      vertex,
      pos: vertexAt(mesh.positions, vertex),
      normal: normalize([s.x, s.y, s.z]),
    });
  }
  return out;
}

function collectInteriorTriangles(
  mesh: MeshData,
  incidence: EdgeIncidence,
): { face: number; a: number; b: number; c: number; pa: Vec3; pb: Vec3; pc: Vec3; normal: Vec3; centroid: Vec3 }[] {
  const { indices, positions } = mesh;
  const out: { face: number; a: number; b: number; c: number; pa: Vec3; pb: Vec3; pc: Vec3; normal: Vec3; centroid: Vec3 }[] = [];
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t];
    const b = indices[t + 1];
    const c = indices[t + 2];
    if (incidence.count(a, b) < 2 || incidence.count(b, c) < 2 || incidence.count(c, a) < 2) continue;
    const pa = vertexAt(positions, a);
    const pb = vertexAt(positions, b);
    const pc = vertexAt(positions, c);
    const n = triangleNormalRaw(pa, pb, pc);
    if (length(n) < 1e-18) continue;
    out.push({
      face: t / 3,
      a,
      b,
      c,
      pa,
      pb,
      pc,
      normal: normalize(n),
      centroid: [(pa[0] + pb[0] + pc[0]) / 3, (pa[1] + pb[1] + pc[1]) / 3, (pa[2] + pb[2] + pc[2]) / 3],
    });
  }
  return out;
}

function closestOnTriangle(
  p: Vec3,
  a: Vec3,
  b: Vec3,
  c: Vec3,
): { q: Vec3; d2: number; kind: 'vertex' | 'edge' | 'face'; edge: number; t: number } {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return { q: a, d2: dist2(p, a), kind: 'vertex', edge: 0, t: 0 };

  const bp = sub(p, b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return { q: b, d2: dist2(p, b), kind: 'vertex', edge: 0, t: 1 };

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const t = d1 / (d1 - d3);
    const q: Vec3 = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
    return { q, d2: dist2(p, q), kind: 'edge', edge: 0, t };
  }

  const cp = sub(p, c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return { q: c, d2: dist2(p, c), kind: 'vertex', edge: 0, t: 1 };

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const t = d2 / (d2 - d6);
    const q: Vec3 = [a[0] + ac[0] * t, a[1] + ac[1] * t, a[2] + ac[2] * t];
    return { q, d2: dist2(p, q), kind: 'edge', edge: 2, t };
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const t = (d4 - d3) / (d4 - d3 + d5 - d6);
    const bc = sub(c, b);
    const q: Vec3 = [b[0] + bc[0] * t, b[1] + bc[1] * t, b[2] + bc[2] * t];
    return { q, d2: dist2(p, q), kind: 'edge', edge: 1, t };
  }

  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  const q: Vec3 = [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w];
  return { q, d2: dist2(p, q), kind: 'face', edge: 0, t: v };
}

function nearestOf(q: Vec3, pts: [number, Vec3][]): number {
  let best = pts[0][0];
  let bestD = Infinity;
  for (const [id, p] of pts) {
    const d = dist2(q, p);
    if (d < bestD) {
      bestD = d;
      best = id;
    }
  }
  return best;
}

function splitEdge(mesh: MeshData, u: number, v: number, t: number): MeshData | null {
  const clamped = Math.min(0.95, Math.max(0.05, t));
  const a = vertexAt(mesh.positions, u);
  const b = vertexAt(mesh.positions, v);
  const p: Vec3 = [a[0] + (b[0] - a[0]) * clamped, a[1] + (b[1] - a[1]) * clamped, a[2] + (b[2] - a[2]) * clamped];
  const newIndex = mesh.positions.length / 3;
  const positions = new Float32Array(mesh.positions.length + 3);
  positions.set(mesh.positions);
  positions[newIndex * 3] = p[0];
  positions[newIndex * 3 + 1] = p[1];
  positions[newIndex * 3 + 2] = p[2];

  const { indices } = mesh;
  const faces: number[] = [];
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

function median(values: number[]): number {
  if (values.length === 0) return Infinity;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function dist2(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}
