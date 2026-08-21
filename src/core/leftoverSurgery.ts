import { mergeVertexGroups, remapAndCompact } from './compact.ts';
import { applyCap } from './cap/index.ts';
import { wrapLeftoverEdgeAabbs } from './cap/voxelWrap.ts';
import { traceFillableLoops } from './boundary.ts';
import type { CapStrategy } from './classify.ts';
import { buildTopology } from './halfEdge.ts';
import { EdgeIncidence, computeVertexMeanEdge } from './incidence.ts';
import { computeBounds, type MeshData } from './types.ts';
import { centroidOf, cross, dot, length, newellNormal, normalize, scale, sub, triangleNormalRaw, vertexAt, type Vec3 } from './geom.ts';

export interface LeftoverSurgeryResult {
  mesh: MeshData;
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

const SHORT_RATIO = 0.35;
const OVERLAP_DIST = 0.35;
const OVERLAP_NORMAL = 0.5;
const STENCIL_DIST = 0.5;
const STENCIL_MAX = 16;
const LAYER_CAP = 4;
const OTHER_CAP = 2;
const LOOP_MIN = 3;
const LOOP_MAX = 40;
const ZIP_DIST = 0.5;
const MAX_SHORT = 64;
const MAX_REPLACE = 32;
const MAX_CAVITY = 48;
const MAX_SPATIAL = 64;
const MAX_INSERT = 128;
const MAX_STRIP = 250;
const MAX_LEFTOVER_ZIP = 48;
const MAX_SHEET_SPLIT = 200;
const STRIP_OFFSET = 0.5;
const STRIP_FAR = 0.85;
const STRIP_BOW = 0.25;
const STRIP_BOW_LEN = 2;
const STRIP_BOW_COVER = 0.4;
const STRIP_BOW_PROJ = 1.55;
const STRIP_DRAW = 0.35;
const MAX_CHAIN_RECAP = 64;
const MAX_RECAP_VERTS = 24;
const MAX_CHAIN_BOW_EDGES = 4;
const STRIP_BLOW = 24;
const STRIP_SAMPLES = 8;
const POLY_COVER = 0.6;
const POLY_INSET = 0.08;
const SLIVER_VERT = 0.5;
const SUB_DIST = 0.5;
const SUB_TMIN = 0.05;
const SUB_TMAX = 0.95;
const SUB_COVER = 0.55;

/**
 * 짧은 1-face 미매칭 변을 한 건씩 접고, 겹친 안쪽 면은 한 트랜잭션으로 교체한다.
 * 전역 1-face가 줄고 비다양체가 늘지 않을 때만 남긴다.
 */
export function applyLeftoverSurgeries(mesh: MeshData): LeftoverSurgeryResult {
  let working = mesh;
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

  for (let i = 0; i < MAX_INSERT; i++) {
    const one = insertOneConstrained(working);
    if (!one) break;
    working = one;
    insertCommits++;
  }
  const stripped = applyGapStrips(working, MAX_STRIP);
  working = stripped.mesh;
  stripCommits = stripped.commits;
  stripMultiCommits = stripped.multi;
  stripFarCommits = stripped.far;
  stripBowCommits = stripped.bow;
  stripBudgetHit = stripped.budgetHit;
  for (let i = 0; i < MAX_SHORT; i++) {
    const one = collapseOneShortUnmatched(working);
    if (!one) break;
    working = one;
    collapsedShort++;
  }
  for (let i = 0; i < MAX_REPLACE; i++) {
    const one = replaceOneOverlap(working);
    if (!one) break;
    working = one;
    overlapReplaces++;
  }
  for (let i = 0; i < MAX_SPATIAL; i++) {
    const one = remeshOneSpatialCavity(working);
    if (!one) break;
    working = one;
    spatialZipCommits++;
  }
  for (let i = 0; i < MAX_CAVITY; i++) {
    const one = collectCavityTrials(working, { stopAtFirst: true, limit: 80 })?.commit ?? null;
    if (!one) break;
    working = one;
    cavityCommits++;
  }
  if (buildTopology(working).boundaryEdgeCount > 0) {
    const wrapped = wrapLeftoverEdgeAabbs(working);
    if (wrapped.addedTriangles > 0 && isSafer(working, wrapped.mesh)) {
      working = wrapped.mesh;
      wrappedTriangles = wrapped.addedTriangles;
    }
  }
  const split = splitSheetSpokes(working, MAX_SHEET_SPLIT);
  working = split.mesh;
  sheetSplitCommits = split.commits;
  if (sheetSplitCommits > 0) {
    const afterSplit = applyFarNoHitStrips(working, MAX_STRIP);
    working = afterSplit.mesh;
    stripCommits += afterSplit.commits;
    stripFarCommits += afterSplit.far;
  }
  for (let i = 0; i < MAX_LEFTOVER_ZIP; i++) {
    const one = zipOneLeftoverPair(working);
    if (!one) break;
    working = one;
    leftoverZipCommits++;
  }
  const recapped = recapDrawnChains(working, MAX_CHAIN_RECAP);
  working = recapped.mesh;
  chainRecapCommits = recapped.commits;
  return { mesh: working, collapsedShort, overlapReplaces, cavityCommits, spatialZipCommits, subsegmentZipCommits, polylineZipCommits, sliverCutCommits, insertCommits, stripCommits, stripMultiCommits, stripFarCommits, leftoverZipCommits, sheetSplitCommits, stripBowCommits, chainRecapCommits, stripBudgetHit, wrappedTriangles };
}

export interface LeftoverSubsegmentStats {
  leftoverOneFace: number;
  meanEdge: number;
  tried: number;
  nearbyInterior: number;
  interiorProj: number;
  splits: number;
  zipFail: number;
  saferFail: number;
  wouldCommit: number;
  samples: { reason: string; [k: string]: number | string }[];
}

export function leftoverSubsegmentStats(mesh: MeshData): LeftoverSubsegmentStats {
  const empty: LeftoverSubsegmentStats = {
    leftoverOneFace: 0,
    meanEdge: 0,
    tried: 0,
    nearbyInterior: 0,
    interiorProj: 0,
    splits: 0,
    zipFail: 0,
    saferFail: 0,
    wouldCommit: 0,
    samples: [],
  };
  const trials = collectSubsegmentTrials(mesh, { stopAtFirst: false, limit: 80 });
  if (!trials) return empty;
  return {
    leftoverOneFace: trials.leftoverOneFace,
    meanEdge: trials.meanEdge,
    tried: trials.results.length,
    nearbyInterior: trials.results.filter((r) => r.reason !== 'nearby').length,
    interiorProj: trials.results.filter((r) => Number(r.interiorProj ?? 0) > 0 || r.reason === 'ok' || r.reason === 'safer' || r.reason === 'split').length,
    splits: trials.results.filter((r) => r.reason === 'ok' || r.reason === 'safer' || r.reason === 'zip').length,
    zipFail: trials.results.filter((r) => r.reason === 'zip').length,
    saferFail: trials.results.filter((r) => r.reason === 'safer').length,
    wouldCommit: trials.results.filter((r) => r.reason === 'ok').length,
    samples: trials.results.slice(0, 8),
  };
}

export interface LeftoverShadowCoverage {
  leftoverOneFace: number;
  meanEdge: number;
  edges: number;
  hist: { lt10: number; p10to50: number; p50to90: number; ge90: number };
  ge60: number;
  medianCover: number;
  medianShadow: number;
  medianAspect: number;
  longEdges: number;
  longGe60: number;
  isolatedTwoVert: number;
  isolatedGe60: number;
  samples: { cover: number; shadow: number; aspect: number; abLen: number }[];
}

/**
 * 미매칭 1-face마다 0.5× 안의 같은 방향 안쪽 2-face를 모두 모아
 * AB 위 투영 구간 합집합이 변을 얼마나 덮는지 잰다.
 */
export function leftoverShadowCoverage(mesh: MeshData): LeftoverShadowCoverage {
  const empty: LeftoverShadowCoverage = {
    leftoverOneFace: 0,
    meanEdge: 0,
    edges: 0,
    hist: { lt10: 0, p10to50: 0, p50to90: 0, ge90: 0 },
    ge60: 0,
    medianCover: 0,
    medianShadow: 0,
    medianAspect: 0,
    longEdges: 0,
    longGe60: 0,
    isolatedTwoVert: 0,
    isolatedGe60: 0,
    samples: [],
  };
  const topology = buildTopology(mesh);
  if (topology.fillFrom.length === 0) return empty;
  const incidence = new EdgeIncidence(mesh);
  const mean = incidence.meanLength;
  if (mean <= 0) return empty;

  const valence = leftoverValence(topology, mesh.positions.length / 3);
  const leftover: { a: number; b: number; face: number }[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < topology.fillFrom.length; i++) {
    const a = topology.fillFrom[i];
    const b = topology.fillTo[i];
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    leftover.push({ a, b, face: topology.fillFace[i] });
  }

  const interiorMap = new Map<string, { p: number; q: number; faces: number[] }>();
  const { indices } = mesh;
  for (let t = 0; t < indices.length; t += 3) {
    const vs = [indices[t], indices[t + 1], indices[t + 2]];
    const face = t / 3;
    for (let k = 0; k < 3; k++) {
      const p = vs[k];
      const q = vs[(k + 1) % 3];
      if (incidence.count(p, q) !== 2) continue;
      const key = p < q ? `${p}:${q}` : `${q}:${p}`;
      const cur = interiorMap.get(key);
      if (cur) {
        if (!cur.faces.includes(face)) cur.faces.push(face);
      } else interiorMap.set(key, { p, q, faces: [face] });
    }
  }

  const hist = { lt10: 0, p10to50: 0, p50to90: 0, ge90: 0 };
  const covers: number[] = [];
  const shadows: number[] = [];
  const aspects: number[] = [];
  const samples: { cover: number; shadow: number; aspect: number; abLen: number }[] = [];
  let ge60 = 0;
  let longEdges = 0;
  let longGe60 = 0;
  let isolatedTwoVert = 0;
  let isolatedGe60 = 0;

  for (const ab of leftover) {
    const pa = vertexAt(mesh.positions, ab.a);
    const pb = vertexAt(mesh.positions, ab.b);
    const abLen = length(sub(pb, pa));
    if (abLen < 1e-18) continue;
    const seedN = faceNormal(mesh, ab.face);
    const vs = faceVerts(mesh, ab.face);
    const apex = vs.find((v) => v !== ab.a && v !== ab.b);
    const aspect = apex === undefined ? 0 : pointSegDist(vertexAt(mesh.positions, apex), pa, pb) / abLen;
    const intervals: [number, number][] = [];
    let shadow = 0;
    const pad = mean * SUB_DIST;
    const minX = Math.min(pa[0], pb[0]) - pad;
    const maxX = Math.max(pa[0], pb[0]) + pad;
    const minY = Math.min(pa[1], pb[1]) - pad;
    const maxY = Math.max(pa[1], pb[1]) + pad;
    const minZ = Math.min(pa[2], pb[2]) - pad;
    const maxZ = Math.max(pa[2], pb[2]) + pad;
    for (const edge of interiorMap.values()) {
      if (edge.p === ab.a || edge.p === ab.b || edge.q === ab.a || edge.q === ab.b) continue;
      const pp = vertexAt(mesh.positions, edge.p);
      const pq = vertexAt(mesh.positions, edge.q);
      if (Math.max(pp[0], pq[0]) < minX || Math.min(pp[0], pq[0]) > maxX) continue;
      if (Math.max(pp[1], pq[1]) < minY || Math.min(pp[1], pq[1]) > maxY) continue;
      if (Math.max(pp[2], pq[2]) < minZ || Math.min(pp[2], pq[2]) > maxZ) continue;
      if (segmentSegmentDist(pa, pb, pp, pq) > pad) continue;
      if (!edge.faces.some((f) => dot(faceNormal(mesh, f), seedN) >= OVERLAP_NORMAL)) continue;
      const tp = projectSegT(pp, pa, pb);
      const tq = projectSegT(pq, pa, pb);
      const t0 = Math.min(tp.tClamp, tq.tClamp);
      const t1 = Math.max(tp.tClamp, tq.tClamp);
      if (t1 - t0 < 1e-6) continue;
      intervals.push([t0, t1]);
      shadow++;
    }
    const cover = unionIntervalLength(intervals);
    covers.push(cover);
    shadows.push(shadow);
    aspects.push(aspect);
    const isolated = valence[ab.a] === 1 && valence[ab.b] === 1;
    if (isolated) isolatedTwoVert++;
    if (cover >= 0.6) {
      ge60++;
      if (isolated) isolatedGe60++;
    }
    if (abLen >= mean * 8) {
      longEdges++;
      if (cover >= 0.6) longGe60++;
    }
    if (cover < 0.1) hist.lt10++;
    else if (cover < 0.5) hist.p10to50++;
    else if (cover < 0.9) hist.p50to90++;
    else hist.ge90++;
    if (samples.length < 12) samples.push({ cover: +cover.toFixed(3), shadow, aspect: +aspect.toFixed(3), abLen: +(abLen / mean).toFixed(3) });
  }
  covers.sort((a, b) => a - b);
  shadows.sort((a, b) => a - b);
  aspects.sort((a, b) => a - b);
  return {
    leftoverOneFace: topology.fillFrom.length,
    meanEdge: mean,
    edges: leftover.length,
    hist,
    ge60,
    medianCover: covers.length ? covers[Math.floor(covers.length / 2)] : 0,
    medianShadow: shadows.length ? shadows[Math.floor(shadows.length / 2)] : 0,
    medianAspect: aspects.length ? aspects[Math.floor(aspects.length / 2)] : 0,
    longEdges,
    longGe60,
    isolatedTwoVert,
    isolatedGe60,
    samples,
  };
}

function unionIntervalLength(intervals: [number, number][]): number {
  if (intervals.length === 0) return 0;
  intervals.sort((a, b) => a[0] - b[0]);
  let lo = intervals[0][0];
  let hi = intervals[0][1];
  let sum = 0;
  for (let i = 1; i < intervals.length; i++) {
    const [a, b] = intervals[i];
    if (a <= hi) hi = Math.max(hi, b);
    else {
      sum += hi - lo;
      lo = a;
      hi = b;
    }
  }
  sum += hi - lo;
  return sum;
}

export interface LeftoverPolylineStats {
  leftoverOneFace: number;
  tried: number;
  highCover: number;
  zipFail: number;
  saferFail: number;
  wouldCommit: number;
  samples: { reason: string; [k: string]: number | string }[];
}

export function leftoverPolylineStats(mesh: MeshData): LeftoverPolylineStats {
  const empty: LeftoverPolylineStats = {
    leftoverOneFace: 0,
    tried: 0,
    highCover: 0,
    zipFail: 0,
    saferFail: 0,
    wouldCommit: 0,
    samples: [],
  };
  const trials = collectPolylineTrials(mesh, { stopAtFirst: false, limit: 40 });
  if (!trials) return empty;
  return {
    leftoverOneFace: trials.leftoverOneFace,
    tried: trials.results.length,
    highCover: trials.results.filter((r) => r.reason !== 'cover').length,
    zipFail: trials.results.filter((r) => r.reason === 'zip').length,
    saferFail: trials.results.filter((r) => r.reason === 'safer').length,
    wouldCommit: trials.results.filter((r) => r.reason === 'ok').length,
    samples: trials.results.slice(0, 8),
  };
}

const INSERT_BARY = 0.02;
const INSERT_WING = 0.08;

export interface LeftoverInsertStats {
  leftoverOneFace: number;
  tried: number;
  uniqueContaining: number;
  multiFace: number;
  inserts: number;
  wouldCommit: number;
  saferFail: number;
  nmFail: number;
  oneFaceFail: number;
  degenerate: number;
  samples: { reason: string; [k: string]: number | string }[];
}

export function leftoverInsertStats(mesh: MeshData): LeftoverInsertStats {
  const empty: LeftoverInsertStats = {
    leftoverOneFace: 0,
    tried: 0,
    uniqueContaining: 0,
    multiFace: 0,
    inserts: 0,
    wouldCommit: 0,
    saferFail: 0,
    nmFail: 0,
    oneFaceFail: 0,
    degenerate: 0,
    samples: [],
  };
  const trials = collectInsertTrials(mesh, { stopAtFirst: false, limit: 80 });
  if (!trials) return empty;
  return {
    leftoverOneFace: trials.leftoverOneFace,
    tried: trials.results.length,
    uniqueContaining: trials.uniqueContaining,
    multiFace: trials.multiFace,
    inserts: trials.results.filter((r) => r.reason !== 'contain' && r.reason !== 'cover').length,
    wouldCommit: trials.results.filter((r) => r.reason === 'ok').length,
    saferFail: trials.results.filter((r) => r.reason === 'nm' || r.reason === 'oneface').length,
    nmFail: trials.results.filter((r) => r.reason === 'nm').length,
    oneFaceFail: trials.results.filter((r) => r.reason === 'oneface').length,
    degenerate: trials.results.filter((r) => r.reason === 'degenerate').length,
    samples: trials.results.slice(0, 12),
  };
}

/** 그린 leftover를 flipped / no-hit / isolation / leftover-near로 나눈다. */
export function leftoverDrawnClass(mesh: MeshData): {
  raw: number;
  drawn: number;
  hidden: number;
  onSheetHide: number;
  isolationHide: number;
  flippedHide: number;
  highCover: number;
  lowCoverFar: number;
  flipped: number;
  noHit: number;
  isolation: number;
  leftoverNear: number;
  leftoverOnlyNoHit: number;
  medianNoHitDist: number;
} {
  const topology = buildTopology(mesh);
  const raw = listFillableEdgesFrom(topology);
  const drawn = listDrawnLeftoverEdges(mesh);
  const drawnSet = new Set(drawn.map(([a, b]) => (a < b ? `${a}:${b}` : `${b}:${a}`)));
  const incidence = new EdgeIncidence(mesh);
  const mean = incidence.meanLength;
  const out = {
    raw: raw.length,
    drawn: drawnSet.size,
    hidden: raw.length - drawnSet.size,
    onSheetHide: 0,
    isolationHide: 0,
    flippedHide: 0,
    highCover: 0,
    lowCoverFar: 0,
    flipped: 0,
    noHit: 0,
    isolation: 0,
    leftoverNear: 0,
    leftoverOnlyNoHit: 0,
    medianNoHitDist: 0,
  };
  if (raw.length === 0 || mean <= 0) return out;
  const interiors = collectInteriorFaces(mesh, incidence);
  const cap = mean * STRIP_OFFSET;
  const leftoverSegs = raw.map(([a, b]) => ({ a, b, pa: vertexAt(mesh.positions, a), pb: vertexAt(mesh.positions, b) }));
  const noHitDists: number[] = [];
  for (const [a, b] of raw) {
    const faces = facesOfEdge(mesh, a, b);
    const seedN: Vec3 = faces.length > 0 ? faceNormal(mesh, faces[0]) : [0, 0, 1];
    const leftoverV = faces.length > 0 ? new Set(faceVerts(mesh, faces[0])) : new Set<number>();
    const pa = vertexAt(mesh.positions, a);
    const pb = vertexAt(mesh.positions, b);
    const hide = leftoverLooksAttached(a, b, pa, pb, seedN, leftoverV, interiors, mean);
    if (hide === 'flipped') {
      out.onSheetHide++;
      out.flippedHide++;
    } else if (hide === 'isolation') {
      out.onSheetHide++;
      out.isolationHide++;
    }
  }
  for (const [a, b] of drawn) {
    const faces = facesOfEdge(mesh, a, b);
    const seedN: Vec3 = faces.length > 0 ? faceNormal(mesh, faces[0]) : [0, 0, 1];
    const leftoverV = faces.length > 0 ? new Set(faceVerts(mesh, faces[0])) : new Set<number>();
    const pa = vertexAt(mesh.positions, a);
    const pb = vertexAt(mesh.positions, b);
    const mid: Vec3 = [(pa[0] + pb[0]) * 0.5, (pa[1] + pb[1]) * 0.5, (pa[2] + pb[2]) * 0.5];
    const sameIso = nearestSheetDist(mid, seedN, leftoverV, interiors, 'same', true);
    const flipIso = nearestSheetDist(mid, seedN, leftoverV, interiors, 'flip', true);
    const anyIso = nearestSheetDist(mid, seedN, leftoverV, interiors, 'any', true);
    const anyFree = nearestSheetDist(mid, seedN, leftoverV, interiors, 'any', false);
    const cover = faceShadowCover(pa, pb, seedN, leftoverV, interiors, cap, 'same', true);
    let nearLeftover = false;
    for (const other of leftoverSegs) {
      if ((other.a === a && other.b === b) || (other.a === b && other.b === a)) continue;
      if (segmentSegmentDist(pa, pb, other.pa, other.pb) <= cap) {
        nearLeftover = true;
        break;
      }
    }
    if (flipIso <= cap && sameIso > cap) out.flipped++;
    else if (anyFree > cap) {
      out.noHit++;
      noHitDists.push(anyFree);
      if (leftoverOnlyVerts(a, b, interiors)) out.leftoverOnlyNoHit++;
    } else if (anyIso > cap && anyFree <= cap) out.isolation++;
    else if (nearLeftover) out.leftoverNear++;
    else if (cover >= POLY_COVER) out.highCover++;
    else out.lowCoverFar++;
  }
  noHitDists.sort((x, y) => x - y);
  out.medianNoHitDist = noHitDists.length ? noHitDists[Math.floor(noHitDists.length / 2)] / mean : 0;
  return out;
}

/** 그린 leftover가 사슬인지, 시트 정점을 몇 개 공유하는지, 메울 루프에 들어가는지. */
export function leftoverDrawnAttachStats(mesh: MeshData): {
  drawn: number;
  isolated2: number;
  chain2: number;
  chain3plus: number;
  loop3plus: number;
  share0: number;
  share1: number;
  share2: number;
  share1Isolated2: number;
  share1Chain: number;
  share2Isolated2: number;
  share2Loop: number;
  inFillableLoop: number;
  medianLen: number;
  share1MedianLen: number;
  share2MedianLen: number;
  share2OnSheet: number;
  share2BowedShadow: number;
  share2Window: number;
  share2MedianMid: number;
  share2MedianCover: number;
  recapEligible: number;
  recapTooLong: number;
  recapBlocked2Face: number;
} {
  const topology = buildTopology(mesh);
  const drawn = listDrawnLeftoverEdges(mesh);
  const incidence = new EdgeIncidence(mesh);
  const mean = incidence.meanLength;
  const empty = {
    drawn: drawn.length,
    isolated2: 0,
    chain2: 0,
    chain3plus: 0,
    loop3plus: 0,
    share0: 0,
    share1: 0,
    share2: 0,
    share1Isolated2: 0,
    share1Chain: 0,
    share2Isolated2: 0,
    share2Loop: 0,
    inFillableLoop: 0,
    medianLen: 0,
    share1MedianLen: 0,
    share2MedianLen: 0,
    share2OnSheet: 0,
    share2BowedShadow: 0,
    share2Window: 0,
    share2MedianMid: 0,
    share2MedianCover: 0,
    recapEligible: 0,
    recapTooLong: 0,
    recapBlocked2Face: 0,
  };
  if (drawn.length === 0 || mean <= 0) return empty;
  const interiors = collectInteriorFaces(mesh, incidence);
  const valence = drawnLeftoverValence(topology);
  const comp = drawnLeftoverComponents(drawn);
  const loops = traceFillableLoops(topology, 3);
  const inLoop = new Set<string>();
  for (const loop of loops) {
    if (!loop.closed || loop.vertices.length < 3) continue;
    for (let i = 0; i < loop.vertices.length; i++) {
      const a = loop.vertices[i];
      const b = loop.vertices[(i + 1) % loop.vertices.length];
      inLoop.add(a < b ? `${a}:${b}` : `${b}:${a}`);
    }
  }
  const lens: number[] = [];
  const share1Lens: number[] = [];
  const share2Lens: number[] = [];
  const share2Mids: number[] = [];
  const share2Covers: number[] = [];
  for (const [a, b] of drawn) {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    const shares = (vertexOnInterior(a, interiors) ? 1 : 0) + (vertexOnInterior(b, interiors) ? 1 : 0);
    const va = valence.get(a) ?? 0;
    const vb = valence.get(b) ?? 0;
    const isolated = va === 1 && vb === 1;
    const size = comp.get(key) ?? 1;
    const looped = inLoop.has(key);
    const abLen = length(sub(vertexAt(mesh.positions, b), vertexAt(mesh.positions, a))) / mean;
    lens.push(abLen);
    if (shares === 0) empty.share0++;
    else if (shares === 1) {
      empty.share1++;
      share1Lens.push(abLen);
      if (isolated) empty.share1Isolated2++;
      else empty.share1Chain++;
    } else {
      empty.share2++;
      share2Lens.push(abLen);
      if (isolated) empty.share2Isolated2++;
      if (looped) empty.share2Loop++;
      const faces = facesOfEdge(mesh, a, b);
      const seedN: Vec3 = faces.length > 0 ? faceNormal(mesh, faces[0]) : [0, 0, 1];
      const leftoverV = faces.length > 0 ? new Set(faceVerts(mesh, faces[0])) : new Set<number>();
      const pa = vertexAt(mesh.positions, a);
      const pb = vertexAt(mesh.positions, b);
      const mid: Vec3 = [(pa[0] + pb[0]) * 0.5, (pa[1] + pb[1]) * 0.5, (pa[2] + pb[2]) * 0.5];
      const midOff = nearestSheetDist(mid, seedN, leftoverV, interiors, 'same', false);
      const cover = faceShadowCover(pa, pb, seedN, leftoverV, interiors, mean * STRIP_BOW_PROJ, 'same', false);
      share2Mids.push(midOff / mean);
      share2Covers.push(cover);
      if (midOff <= mean * STRIP_DRAW) empty.share2OnSheet++;
      else if (cover >= STRIP_BOW_COVER || midOff <= mean * STRIP_FAR) empty.share2BowedShadow++;
      else empty.share2Window++;
    }
    if (isolated) empty.isolated2++;
    else if (looped) empty.loop3plus++;
    else if (size === 2) empty.chain2++;
    else empty.chain3plus++;
    if (looped) empty.inFillableLoop++;
  }
  lens.sort((x, y) => x - y);
  share1Lens.sort((x, y) => x - y);
  share2Lens.sort((x, y) => x - y);
  empty.medianLen = lens[Math.floor(lens.length / 2)] ?? 0;
  empty.share1MedianLen = share1Lens[Math.floor(share1Lens.length / 2)] ?? 0;
  empty.share2MedianLen = share2Lens[Math.floor(share2Lens.length / 2)] ?? 0;
  share2Mids.sort((x, y) => x - y);
  share2Covers.sort((x, y) => x - y);
  empty.share2MedianMid = share2Mids[Math.floor(share2Mids.length / 2)] ?? 0;
  empty.share2MedianCover = share2Covers[Math.floor(share2Covers.length / 2)] ?? 0;
  const recapChains = openChainsFromEdges(drawn);
  for (const verts of recapChains) {
    if (verts.length < 3) continue;
    if (verts.length > MAX_RECAP_VERTS) empty.recapTooLong++;
    else if (incidence.count(verts[0], verts[verts.length - 1]) >= 2) empty.recapBlocked2Face++;
    else empty.recapEligible++;
  }
  return empty;
}

function drawnLeftoverValence(topology: { fillFrom: Uint32Array; fillTo: Uint32Array }): Map<number, number> {
  const valence = new Map<number, number>();
  const seen = new Set<string>();
  for (let i = 0; i < topology.fillFrom.length; i++) {
    const a = topology.fillFrom[i];
    const b = topology.fillTo[i];
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    valence.set(a, (valence.get(a) ?? 0) + 1);
    valence.set(b, (valence.get(b) ?? 0) + 1);
  }
  return valence;
}

function drawnLeftoverComponents(edges: number[][]): Map<string, number> {
  const parent = new Map<number, number>();
  const find = (v: number): number => {
    if (!parent.has(v)) parent.set(v, v);
    const p = parent.get(v)!;
    if (p !== v) {
      const r = find(p);
      parent.set(v, r);
      return r;
    }
    return v;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const [a, b] of edges) union(a, b);
  const size = new Map<number, number>();
  for (const [a] of edges) {
    const r = find(a);
    size.set(r, (size.get(r) ?? 0) + 1);
  }
  const out = new Map<string, number>();
  for (const [a, b] of edges) {
    out.set(a < b ? `${a}:${b}` : `${b}:${a}`, size.get(find(a)) ?? 1);
  }
  return out;
}

export function leftoverZipStats(mesh: MeshData): {
  nearPairs: number;
  tried: number;
  saferFail: number;
  wouldCommit: number;
} {
  const leftover = listFillableEdgesFrom(buildTopology(mesh));
  const mean = new EdgeIncidence(mesh).meanLength;
  const empty = { nearPairs: 0, tried: 0, saferFail: 0, wouldCommit: 0 };
  if (leftover.length < 2 || mean <= 0) return empty;
  const cap = mean * STRIP_OFFSET;
  const segs = leftover.map(([a, b]) => ({
    a,
    b,
    pa: vertexAt(mesh.positions, a),
    pb: vertexAt(mesh.positions, b),
  }));
  const candidates: { pairs: number[][]; d2: number }[] = [];
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const x = segs[i];
      const y = segs[j];
      if (x.a === y.a || x.a === y.b || x.b === y.a || x.b === y.b) continue;
      if (segmentSegmentDist(x.pa, x.pb, y.pa, y.pb) > cap) continue;
      empty.nearPairs++;
      candidates.push(leftoverWeldPairs(x.a, x.b, y.a, y.b, mesh));
    }
  }
  candidates.sort((x, y) => x.d2 - y.d2);
  const limit = Math.min(candidates.length, 12);
  for (let k = 0; k < limit; k++) {
    empty.tried++;
    const next = mergeVertexGroups(mesh, candidates[k].pairs);
    if (isSaferOneFace(mesh, next)) empty.wouldCommit++;
    else empty.saferFail++;
  }
  return empty;
}

/** 그린 leftover가 왜 남는지. 덮임·오프셋·법선 불일치 수를 나눈다. */
export function leftoverDrawnBreakdown(mesh: MeshData): {
  raw: number;
  drawn: number;
  hidden: number;
  highCoverClose: number;
  highCoverFar: number;
  shortClose: number;
  lowCoverFar: number;
  oppositeOrMiss: number;
} {
  const topology = buildTopology(mesh);
  const raw = listFillableEdgesFrom(topology);
  const drawnSet = new Set(listDrawnLeftoverEdges(mesh).map(([a, b]) => (a < b ? `${a}:${b}` : `${b}:${a}`)));
  const incidence = new EdgeIncidence(mesh);
  const mean = incidence.meanLength;
  const empty = { raw: raw.length, drawn: drawnSet.size, hidden: raw.length - drawnSet.size, highCoverClose: 0, highCoverFar: 0, shortClose: 0, lowCoverFar: 0, oppositeOrMiss: 0 };
  if (raw.length === 0 || mean <= 0) return empty;
  const interiors = collectInteriorFaces(mesh, incidence);
  const drawCap = mean * STRIP_DRAW;
  const coverCap = mean * STRIP_OFFSET;
  for (const [a, b] of raw) {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (!drawnSet.has(key)) continue;
    const faces = facesOfEdge(mesh, a, b);
    const seedN: Vec3 = faces.length > 0 ? faceNormal(mesh, faces[0]) : [0, 0, 1];
    const leftoverV = faces.length > 0 ? new Set(faceVerts(mesh, faces[0])) : new Set<number>();
    const pa = vertexAt(mesh.positions, a);
    const pb = vertexAt(mesh.positions, b);
    const cover = faceShadowCover(pa, pb, seedN, leftoverV, interiors, coverCap);
    const ts = [0, 0.25, 0.5, 0.75, 1];
    let sum = 0;
    let hits = 0;
    for (const t of ts) {
      const p: Vec3 = [pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t, pa[2] + (pb[2] - pa[2]) * t];
      const hit = projectOntoSheet(p, seedN, leftoverV, interiors, coverCap);
      if (!hit) continue;
      sum += hit.dist;
      hits++;
    }
    const meanOff = hits > 0 ? sum / hits : Infinity;
    const abLen = length(sub(pb, pa));
    if (hits < 2) empty.oppositeOrMiss++;
    else if (cover >= POLY_COVER && meanOff <= drawCap) empty.highCoverClose++;
    else if (cover >= POLY_COVER) empty.highCoverFar++;
    else if (abLen <= coverCap && meanOff <= drawCap) empty.shortClose++;
    else empty.lowCoverFar++;
  }
  return empty;
}

/**
 * leftover 1-face와 안쪽 투영을 새 Steiner만으로 잇는 얇은 띠.
 * 안쪽 삼각형은 가르거나 지우지 않고, 이미 면이 둘인 에지에 세 번째 면을 붙이지 않는다.
 */
export function leftoverStripStats(mesh: MeshData): {
  leftover: number;
  candidates: number;
  multi: number;
  samples: { a: number; b: number; n: number; faces: number; multi: boolean; t0: number; t1: number; cover: number }[];
} {
  const topology = buildTopology(mesh);
  const cands = collectStripCandidates(mesh);
  return {
    leftover: topology.fillFrom.length,
    candidates: cands.length,
    multi: cands.filter((c) => c.multi).length,
    samples: cands.slice(0, 8).map((c) => ({
      a: c.a,
      b: c.b,
      n: c.samples.length,
      faces: new Set(c.samples.map((s) => s.face)).size,
      multi: c.multi,
      t0: +c.samples[0].t.toFixed(3),
      t1: +c.samples[c.samples.length - 1].t.toFixed(3),
      cover: +faceShadowCover(
        vertexAt(mesh.positions, c.a),
        vertexAt(mesh.positions, c.b),
        faceNormal(mesh, c.face),
        new Set(faceVerts(mesh, c.face)),
        collectInteriorFaces(mesh, new EdgeIncidence(mesh)),
        new EdgeIncidence(mesh).meanLength * STRIP_OFFSET,
      ).toFixed(3),
    })),
  };
}

export function stripOneGap(mesh: MeshData): MeshData | null {
  const one = applyGapStrips(mesh, 1, false);
  return one.commits > 0 ? one.mesh : null;
}

function applyGapStrips(mesh: MeshData, maxCommits: number, drawnOnly = true): { mesh: MeshData; commits: number; multi: number; far: number; bow: number; budgetHit: boolean } {
  const candidates = collectStripCandidates(mesh, drawnOnly);
  if (candidates.length === 0) return { mesh, commits: 0, multi: 0, far: 0, bow: 0, budgetHit: false };
  const budget = drawnOnly ? Math.max(maxCommits, candidates.length) : maxCommits;
  let working = mesh;
  let commits = 0;
  let multi = 0;
  let far = 0;
  let bow = 0;
  let cursor = 0;
  for (; cursor < candidates.length; cursor++) {
    if (commits >= budget) break;
    const cand = candidates[cursor];
    if (new EdgeIncidence(working).count(cand.a, cand.b) !== 1) continue;
    const trial = addGapStrip(working, cand);
    if (!trial) continue;
    const before = buildTopology(working);
    const after = buildTopology(trial);
    if (after.nonManifoldEdgeCount > before.nonManifoldEdgeCount) continue;
    if (after.boundaryEdgeCount > before.boundaryEdgeCount + STRIP_BLOW) continue;
    working = trial;
    commits++;
    if (cand.multi) multi++;
    if (cand.far) far++;
    if (cand.bow) bow++;
  }
  return { mesh: working, commits, multi, far, bow, budgetHit: commits >= budget && cursor < candidates.length };
}

function applyFarNoHitStrips(mesh: MeshData, maxCommits: number): { mesh: MeshData; commits: number; far: number } {
  const candidates = collectStripCandidates(mesh).filter((c) => c.far);
  if (candidates.length === 0) return { mesh, commits: 0, far: 0 };
  const budget = Math.max(maxCommits, candidates.length);
  let working = mesh;
  let commits = 0;
  let far = 0;
  for (const cand of candidates) {
    if (commits >= budget) break;
    if (new EdgeIncidence(working).count(cand.a, cand.b) !== 1) continue;
    const trial = addGapStrip(working, cand);
    if (!trial) continue;
    const before = buildTopology(working);
    const after = buildTopology(trial);
    if (after.nonManifoldEdgeCount > before.nonManifoldEdgeCount) continue;
    if (after.boundaryEdgeCount > before.boundaryEdgeCount + STRIP_BLOW) continue;
    working = trial;
    commits++;
    far++;
  }
  return { mesh: working, commits, far };
}

/**
 * 안쪽 면 위에 앉은 1-face는 남은 찢김으로 그리지 않는다.
 * 덮임이 낮거나 안쪽에서 먼 진짜 구멍만 남긴다.
 */
export function listDrawnLeftoverEdges(mesh: MeshData): number[][] {
  const topology = buildTopology(mesh);
  const raw = listFillableEdgesFrom(topology);
  if (raw.length === 0) return raw;
  const incidence = new EdgeIncidence(mesh);
  const mean = incidence.meanLength;
  if (mean <= 0) return raw;
  const interiors = collectInteriorFaces(mesh, incidence);
  const interiorEdges = collectInteriorEdges(interiors);
  const drawn: number[][] = [];
  const cap = mean * STRIP_DRAW;
  for (const [a, b] of raw) {
    const faces = facesOfEdge(mesh, a, b);
    const seedN: Vec3 = faces.length > 0 ? faceNormal(mesh, faces[0]) : [0, 0, 1];
    const leftoverV = faces.length > 0 ? new Set(faceVerts(mesh, faces[0])) : new Set<number>();
    const pa = vertexAt(mesh.positions, a);
    const pb = vertexAt(mesh.positions, b);
    const hug = leftoverHugSheet(pa, pb, seedN, leftoverV, interiors, interiorEdges, cap, mean * STRIP_OFFSET);
    if (hug) continue;
    if (leftoverLooksAttached(a, b, pa, pb, seedN, leftoverV, interiors, mean)) continue;
    drawn.push([a, b]);
  }
  return drawn;
}

function listFillableEdgesFrom(topology: { fillFrom: Uint32Array; fillTo: Uint32Array }): number[][] {
  const edges: number[][] = [];
  const seen = new Set<string>();
  for (let i = 0; i < topology.fillFrom.length; i++) {
    const a = topology.fillFrom[i];
    const b = topology.fillTo[i];
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push([a, b]);
  }
  return edges;
}

type OrientMode = 'same' | 'flip' | 'any';
type StripSample = { t: number; q: Vec3; face: number; dist: number };
type StripCandidate = { a: number; b: number; face: number; samples: StripSample[]; multi: boolean; far?: boolean; bow?: boolean };

function orientOk(triN: Vec3, seedN: Vec3, mode: OrientMode): boolean {
  const d = dot(triN, seedN);
  if (mode === 'same') return d >= OVERLAP_NORMAL;
  if (mode === 'flip') return d <= -OVERLAP_NORMAL;
  return true;
}

function skipIsolated(tri: InteriorFace, leftoverV: Set<number>, isolate: boolean): boolean {
  if (!isolate) return false;
  return leftoverV.has(tri.u) || leftoverV.has(tri.v) || leftoverV.has(tri.w);
}

function collectStripCandidates(mesh: MeshData, drawnOnly = true): StripCandidate[] {
  const incidence = new EdgeIncidence(mesh);
  const mean = incidence.meanLength;
  if (mean <= 0) return [];
  const interiors = collectInteriorFaces(mesh, incidence);
  const leftover: { a: number; b: number; face: number }[] = [];
  if (drawnOnly) {
    for (const [a, b] of listDrawnLeftoverEdges(mesh)) {
      const faces = facesOfEdge(mesh, a, b);
      if (faces.length === 0) continue;
      leftover.push({ a, b, face: faces[0] });
    }
  } else {
    const topology = buildTopology(mesh);
    const seen = new Set<string>();
    for (let i = 0; i < topology.fillFrom.length; i++) {
      const a = topology.fillFrom[i];
      const b = topology.fillTo[i];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      leftover.push({ a, b, face: topology.fillFace[i] });
    }
  }
  if (leftover.length === 0) return [];
  leftover.sort((x, y) => {
    const lx = length(sub(vertexAt(mesh.positions, x.b), vertexAt(mesh.positions, x.a)));
    const ly = length(sub(vertexAt(mesh.positions, y.b), vertexAt(mesh.positions, y.a)));
    return ly - lx;
  });

  const out: StripCandidate[] = [];
  const cap = mean * STRIP_OFFSET;
  const sameKeys = new Set<string>();
  for (const ab of leftover) {
    const seedN = faceNormal(mesh, ab.face);
    const leftoverV = new Set(faceVerts(mesh, ab.face));
    const pa = vertexAt(mesh.positions, ab.a);
    const pb = vertexAt(mesh.positions, ab.b);
    const abLen = length(sub(pb, pa));
    if (abLen < 1e-18) continue;
    const near = interiorsNearSeg(interiors, pa, pb, cap);
    const samples = pickStripSamples(pa, pb, seedN, leftoverV, near, cap, mean, 'same', true);
    if (!samples) continue;
    const faces = new Set(samples.map((s) => s.face));
    const multi = samples.length > 2 || faces.size > 1;
    out.push({ a: ab.a, b: ab.b, face: ab.face, samples, multi });
    sameKeys.add(ab.a < ab.b ? `${ab.a}:${ab.b}` : `${ab.b}:${ab.a}`);
  }
  for (const ab of leftover) {
    const key = ab.a < ab.b ? `${ab.a}:${ab.b}` : `${ab.b}:${ab.a}`;
    if (sameKeys.has(key)) continue;
    const seedN = faceNormal(mesh, ab.face);
    const leftoverV = new Set(faceVerts(mesh, ab.face));
    const pa = vertexAt(mesh.positions, ab.a);
    const pb = vertexAt(mesh.positions, ab.b);
    const abLen = length(sub(pb, pa));
    if (abLen < 1e-18) continue;
    const mid: Vec3 = [(pa[0] + pb[0]) * 0.5, (pa[1] + pb[1]) * 0.5, (pa[2] + pb[2]) * 0.5];
    const near = interiorsNearSeg(interiors, pa, pb, cap);
    const flipD = nearestSheetDist(mid, seedN, leftoverV, near, 'flip', true);
    const localLong = longestLeftoverAt(ab.a, ab.b, leftover, mesh);
    if (flipD > cap || flipD < mean * 0.05 || abLen < localLong * 0.7) continue;
    if (!leftoverOnlyVerts(ab.a, ab.b, interiors)) continue;
    const samples = pickStripSamples(pa, pb, seedN, leftoverV, near, cap, mean, 'flip', true);
    if (!samples) continue;
    const faces = new Set(samples.map((s) => s.face));
    const multi = samples.length > 2 || faces.size > 1;
    out.push({ a: ab.a, b: ab.b, face: ab.face, samples, multi });
    sameKeys.add(key);
  }
  for (const ab of leftover) {
    const key = ab.a < ab.b ? `${ab.a}:${ab.b}` : `${ab.b}:${ab.a}`;
    if (sameKeys.has(key)) continue;
    const seedN = faceNormal(mesh, ab.face);
    const leftoverV = new Set(faceVerts(mesh, ab.face));
    const pa = vertexAt(mesh.positions, ab.a);
    const pb = vertexAt(mesh.positions, ab.b);
    const abLen = length(sub(pb, pa));
    if (abLen < 1e-18) continue;
    if (!leftoverOnlyVerts(ab.a, ab.b, interiors)) continue;
    const mid: Vec3 = [(pa[0] + pb[0]) * 0.5, (pa[1] + pb[1]) * 0.5, (pa[2] + pb[2]) * 0.5];
    const near = interiorsNearSeg(interiors, pa, pb, cap);
    const freeD = nearestSheetDist(mid, seedN, leftoverV, near, 'any', false);
    const localLong = longestLeftoverAt(ab.a, ab.b, leftover, mesh);
    if (freeD > cap || freeD < mean * 0.05 || abLen < localLong * 0.7) continue;
    const samples = pickStripSamples(pa, pb, seedN, leftoverV, near, cap, mean, 'any', false);
    if (!samples) continue;
    const faces = new Set(samples.map((s) => s.face));
    out.push({ a: ab.a, b: ab.b, face: ab.face, samples, multi: samples.length > 2 || faces.size > 1 });
    sameKeys.add(key);
  }
  const far = mean * STRIP_FAR;
  for (const ab of leftover) {
    const key = ab.a < ab.b ? `${ab.a}:${ab.b}` : `${ab.b}:${ab.a}`;
    if (sameKeys.has(key)) continue;
    const seedN = faceNormal(mesh, ab.face);
    const leftoverV = new Set(faceVerts(mesh, ab.face));
    const pa = vertexAt(mesh.positions, ab.a);
    const pb = vertexAt(mesh.positions, ab.b);
    const abLen = length(sub(pb, pa));
    if (abLen < 1e-18 || abLen > mean * 4) continue;
    if (!leftoverOnlyVerts(ab.a, ab.b, interiors)) continue;
    const mid: Vec3 = [(pa[0] + pb[0]) * 0.5, (pa[1] + pb[1]) * 0.5, (pa[2] + pb[2]) * 0.5];
    const nearFar = interiorsNearSeg(interiors, pa, pb, far);
    const nearest = nearestSheetDist(mid, seedN, leftoverV, nearFar, 'any', false);
    if (nearest > far || nearest <= cap) continue;
    const samples = pickFarNoHitSamples(pa, pb, seedN, leftoverV, nearFar, far, mean);
    if (!samples) continue;
    const faces = new Set(samples.map((s) => s.face));
    out.push({ a: ab.a, b: ab.b, face: ab.face, samples, multi: samples.length > 2 || faces.size > 1, far: true });
    sameKeys.add(key);
  }
  const leftoverAdj = leftoverEdgeAdj(leftover);
  const faceOf = new Map<string, number>();
  for (const ab of leftover) faceOf.set(ab.a < ab.b ? `${ab.a}:${ab.b}` : `${ab.b}:${ab.a}`, ab.face);
  const tryBow = (a: number, b: number, face: number) => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (sameKeys.has(key)) return;
    const pa = vertexAt(mesh.positions, a);
    const pb = vertexAt(mesh.positions, b);
    if (length(sub(pb, pa)) < mean * 0.35) return;
    const seedN = faceNormal(mesh, face);
    const leftoverV = new Set(faceVerts(mesh, face));
    if (leftoverLooksAttached(a, b, pa, pb, seedN, leftoverV, interiors, mean)) return;
    const samples = pickBowChordSamples(pa, pb, seedN, leftoverV, interiors, mean);
    if (!samples) return;
    const faces = new Set(samples.map((s) => s.face));
    out.push({ a, b, face, samples, multi: samples.length > 2 || faces.size > 1, bow: true });
    sameKeys.add(key);
  };
  for (const ab of leftover) {
    const va = leftoverAdj.valence.get(ab.a) ?? 0;
    const vb = leftoverAdj.valence.get(ab.b) ?? 0;
    if (va !== 1 || vb !== 1) continue;
    if (leftoverOnlyVerts(ab.a, ab.b, interiors)) continue;
    if (!vertexOnInterior(ab.a, interiors) || !vertexOnInterior(ab.b, interiors)) continue;
    if (length(sub(vertexAt(mesh.positions, ab.b), vertexAt(mesh.positions, ab.a))) < mean * STRIP_BOW_LEN) continue;
    tryBow(ab.a, ab.b, ab.face);
  }
  const chains = openChainsFromEdges(leftover.map((ab) => [ab.a, ab.b]));
  for (const verts of chains) {
    if (verts.length < 3 || verts.length > MAX_RECAP_VERTS) continue;
    const segs: [number, number][] = [];
    for (let i = 0; i < verts.length - 1; i++) segs.push([verts[i], verts[i + 1]]);
    const step = Math.max(1, Math.ceil(segs.length / MAX_CHAIN_BOW_EDGES));
    let bows = 0;
    for (let i = 0; i < segs.length && bows < MAX_CHAIN_BOW_EDGES; i += step) {
      const [a, b] = segs[i];
      const face = faceOf.get(a < b ? `${a}:${b}` : `${b}:${a}`);
      if (face === undefined) continue;
      tryBow(a, b, face);
      bows++;
    }
  }
  return out;
}

function leftoverEdgeAdj(leftover: { a: number; b: number }[]): { valence: Map<number, number>; comp: Map<string, number> } {
  const valence = new Map<number, number>();
  for (const ab of leftover) {
    valence.set(ab.a, (valence.get(ab.a) ?? 0) + 1);
    valence.set(ab.b, (valence.get(ab.b) ?? 0) + 1);
  }
  return { valence, comp: drawnLeftoverComponents(leftover.map((ab) => [ab.a, ab.b])) };
}

export function splitOneSheetSpoke(mesh: MeshData): MeshData | null {
  const one = splitSheetSpokes(mesh, 1);
  return one.commits > 0 ? one.mesh : null;
}

function splitSheetSpokes(mesh: MeshData, maxCommits: number): { mesh: MeshData; commits: number } {
  const drawn = listDrawnLeftoverEdges(mesh);
  if (drawn.length === 0) return { mesh, commits: 0 };
  const incidence = new EdgeIncidence(mesh);
  const mean = incidence.meanLength;
  if (mean <= 0) return { mesh, commits: 0 };
  const interiors = collectInteriorFaces(mesh, incidence);
  const candidates: { sheet: number; far: number; t: number }[] = [];
  for (const [a, b] of drawn) {
    const sharesA = vertexOnInterior(a, interiors);
    const sharesB = vertexOnInterior(b, interiors);
    if (sharesA === sharesB) continue;
    const sheet = sharesA ? a : b;
    const far = sharesA ? b : a;
    const pa = vertexAt(mesh.positions, sheet);
    const pb = vertexAt(mesh.positions, far);
    const abLen = length(sub(pb, pa));
    if (abLen < mean * 0.7) continue;
    const faces = facesOfEdge(mesh, a, b);
    const seedN: Vec3 = faces.length > 0 ? faceNormal(mesh, faces[0]) : [0, 0, 1];
    const leftoverV = faces.length > 0 ? new Set(faceVerts(mesh, faces[0])) : new Set<number>();
    let t = Math.min(0.45, Math.max(0.12, (mean * 0.4) / abLen));
    for (const sample of [0.08, 0.14, 0.2, 0.28, 0.36, 0.45]) {
      const p: Vec3 = [pa[0] + (pb[0] - pa[0]) * sample, pa[1] + (pb[1] - pa[1]) * sample, pa[2] + (pb[2] - pa[2]) * sample];
      const hit = nearestSheetHit(p, seedN, leftoverV, interiors, 'any', false);
      if (hit && hit.dist > mean * STRIP_DRAW) {
        t = sample;
        break;
      }
    }
    candidates.push({ sheet, far, t });
  }
  if (candidates.length === 0) return { mesh, commits: 0 };
  let working = mesh;
  let commits = 0;
  let beforeNm = buildTopology(working).nonManifoldEdgeCount;
  for (const cand of candidates) {
    if (commits >= maxCommits) break;
    if (new EdgeIncidence(working).count(cand.sheet, cand.far) !== 1) continue;
    const split = splitEdgeAt(working, cand.sheet, cand.far, cand.t);
    if (!split) continue;
    const afterNm = buildTopology(split.mesh).nonManifoldEdgeCount;
    if (afterNm > beforeNm) continue;
    working = split.mesh;
    beforeNm = afterNm;
    commits++;
  }
  return { mesh: working, commits };
}

function zipOneLeftoverPair(mesh: MeshData): MeshData | null {
  const leftover = listFillableEdgesFrom(buildTopology(mesh));
  const mean = new EdgeIncidence(mesh).meanLength;
  if (leftover.length < 2 || mean <= 0) return null;
  const cap = mean * STRIP_OFFSET;
  const segs = leftover.map(([a, b]) => ({
    a,
    b,
    pa: vertexAt(mesh.positions, a),
    pb: vertexAt(mesh.positions, b),
  }));
  const candidates: { pairs: number[][]; d2: number }[] = [];
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const x = segs[i];
      const y = segs[j];
      if (x.a === y.a || x.a === y.b || x.b === y.a || x.b === y.b) continue;
      if (segmentSegmentDist(x.pa, x.pb, y.pa, y.pb) > cap) continue;
      candidates.push(leftoverWeldPairs(x.a, x.b, y.a, y.b, mesh));
    }
  }
  candidates.sort((x, y) => x.d2 - y.d2);
  const limit = Math.min(candidates.length, 12);
  for (let k = 0; k < limit; k++) {
    const next = mergeVertexGroups(mesh, candidates[k].pairs);
    if (isSaferOneFace(mesh, next)) return next;
  }
  return null;
}

function leftoverWeldPairs(a0: number, a1: number, b0: number, b1: number, mesh: MeshData): { pairs: number[][]; d2: number } {
  const pa0 = vertexAt(mesh.positions, a0);
  const pa1 = vertexAt(mesh.positions, a1);
  const pb0 = vertexAt(mesh.positions, b0);
  const pb1 = vertexAt(mesh.positions, b1);
  const anti = dist2(pa0, pb1) + dist2(pa1, pb0);
  const other = dist2(pa0, pb0) + dist2(pa1, pb1);
  return anti <= other
    ? { pairs: [[a0, b1], [a1, b0]], d2: anti }
    : { pairs: [[a0, b0], [a1, b1]], d2: other };
}

function leftoverOnlyVerts(a: number, b: number, interiors: InteriorFace[]): boolean {
  for (const tri of interiors) {
    if (tri.u === a || tri.v === a || tri.w === a || tri.u === b || tri.v === b || tri.w === b) return false;
  }
  return true;
}

function longestLeftoverAt(
  a: number,
  b: number,
  leftover: { a: number; b: number }[],
  mesh: MeshData,
): number {
  let maxLen = 0;
  for (const ab of leftover) {
    if (ab.a !== a && ab.a !== b && ab.b !== a && ab.b !== b) continue;
    const len = length(sub(vertexAt(mesh.positions, ab.b), vertexAt(mesh.positions, ab.a)));
    if (len > maxLen) maxLen = len;
  }
  return maxLen;
}

function pickStripSamples(
  pa: Vec3,
  pb: Vec3,
  seedN: Vec3,
  leftoverV: Set<number>,
  interiors: InteriorFace[],
  cap: number,
  mean: number,
  mode: OrientMode,
  isolate: boolean,
): StripSample[] | null {
  const cover = faceShadowCover(pa, pb, seedN, leftoverV, interiors, cap, mode, isolate);
  const samples = sampleStripProjections(pa, pb, seedN, leftoverV, interiors, cap, mean, mode, isolate);
  if (samples.length < 2) return null;
  const span = samples[samples.length - 1].t - samples[0].t;
  const endsIn = samples[0].t <= 1e-6 && samples[samples.length - 1].t >= 1 - 1e-6;
  if (cover < POLY_COVER && (mode !== 'same' || !endsIn)) return null;
  if (span < 0.25) return null;
  return samples;
}

function pickFarNoHitSamples(
  pa: Vec3,
  pb: Vec3,
  seedN: Vec3,
  leftoverV: Set<number>,
  interiors: InteriorFace[],
  cap: number,
  mean: number,
): StripSample[] | null {
  const cover = faceShadowCover(pa, pb, seedN, leftoverV, interiors, cap, 'any', false);
  const samples = sampleStripProjections(pa, pb, seedN, leftoverV, interiors, cap, mean, 'any', false);
  if (samples.length < 2) return null;
  const span = samples[samples.length - 1].t - samples[0].t;
  const endsIn = samples[0].t <= 1e-6 && samples[samples.length - 1].t >= 1 - 1e-6;
  if (cover < POLY_COVER && !endsIn) return null;
  if (span < 0.25) return null;
  return samples;
}

function pickBowChordSamples(
  pa: Vec3,
  pb: Vec3,
  seedN: Vec3,
  leftoverV: Set<number>,
  interiors: InteriorFace[],
  mean: number,
): StripSample[] | null {
  const mid: Vec3 = [(pa[0] + pb[0]) * 0.5, (pa[1] + pb[1]) * 0.5, (pa[2] + pb[2]) * 0.5];
  const coverCap = mean * STRIP_BOW_PROJ;
  const midOff = nearestSheetDist(mid, seedN, leftoverV, interiors, 'same', false);
  if (midOff < mean * STRIP_BOW) return null;
  const cover = faceShadowCover(pa, pb, seedN, leftoverV, interiors, coverCap, 'same', false);
  if (cover < STRIP_BOW_COVER && midOff > mean * STRIP_FAR) return null;
  const projMul = Math.max(STRIP_FAR, Math.min(STRIP_BOW_PROJ, midOff / mean + 0.2));
  const projCap = mean * projMul;
  const near = interiorsNearSeg(interiors, pa, pb, projCap);
  const sheetN = nearestSheetNormal(mid, new Set(), interiors, projCap) ?? seedN;
  let samples = bowInteriorSamples(pa, pb, sheetN, leftoverV, near, projCap, mean, 'any');
  if (samples.length < 2) samples = bowInteriorSamples(pa, pb, seedN, leftoverV, near, projCap, mean, 'same');
  if (samples.length < 2) return null;
  if (samples[samples.length - 1].t - samples[0].t < 0.25) return null;
  const abLen = length(sub(pb, pa));
  for (let i = 1; i < samples.length; i++) {
    const leftoverStep = Math.abs(samples[i].t - samples[i - 1].t) * abLen;
    if (length(sub(samples[i].q, samples[i - 1].q)) > leftoverStep * 3 + mean) return null;
  }
  return samples;
}

function bowInteriorSamples(
  pa: Vec3,
  pb: Vec3,
  seedN: Vec3,
  leftoverV: Set<number>,
  interiors: InteriorFace[],
  cap: number,
  mean: number,
  mode: OrientMode,
): StripSample[] {
  const minQ = mean * 0.04;
  const out: StripSample[] = [];
  for (const t of [0.35, 0.65]) {
    const p: Vec3 = [pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t, pa[2] + (pb[2] - pa[2]) * t];
    const hit = projectOntoSheet(p, seedN, leftoverV, interiors, cap, mode, false);
    if (!hit) continue;
    const face = nearestInteriorFace(hit.q, seedN, leftoverV, interiors, mode, false);
    if (face < 0) continue;
    if (length(sub(hit.q, pa)) < minQ || length(sub(hit.q, pb)) < minQ) continue;
    out.push({ t, q: hit.q, face, dist: hit.dist });
  }
  return out;
}

function interiorsNearSeg(interiors: InteriorFace[], pa: Vec3, pb: Vec3, cap: number): InteriorFace[] {
  const minX = Math.min(pa[0], pb[0]) - cap;
  const maxX = Math.max(pa[0], pb[0]) + cap;
  const minY = Math.min(pa[1], pb[1]) - cap;
  const maxY = Math.max(pa[1], pb[1]) + cap;
  const minZ = Math.min(pa[2], pb[2]) - cap;
  const maxZ = Math.max(pa[2], pb[2]) + cap;
  const out: InteriorFace[] = [];
  for (const tri of interiors) {
    const maxTx = Math.max(tri.pu[0], tri.pv[0], tri.pw[0]);
    const minTx = Math.min(tri.pu[0], tri.pv[0], tri.pw[0]);
    if (maxTx < minX || minTx > maxX) continue;
    const maxTy = Math.max(tri.pu[1], tri.pv[1], tri.pw[1]);
    const minTy = Math.min(tri.pu[1], tri.pv[1], tri.pw[1]);
    if (maxTy < minY || minTy > maxY) continue;
    const maxTz = Math.max(tri.pu[2], tri.pv[2], tri.pw[2]);
    const minTz = Math.min(tri.pu[2], tri.pv[2], tri.pw[2]);
    if (maxTz < minZ || minTz > maxZ) continue;
    out.push(tri);
  }
  return out;
}

function sampleStripProjections(
  pa: Vec3,
  pb: Vec3,
  seedN: Vec3,
  leftoverV: Set<number>,
  interiors: InteriorFace[],
  cap: number,
  mean: number,
  mode: OrientMode = 'same',
  isolate: boolean = true,
): StripSample[] {
  const abLen = length(sub(pb, pa));
  const ts: number[] = [0, 1];
  const seen = new Set<string>(['0.0000', '1.0000']);
  const pushT = (t: number) => {
    if (t <= SUB_TMIN || t >= SUB_TMAX) return;
    const key = t.toFixed(4);
    if (seen.has(key)) return;
    seen.add(key);
    ts.push(t);
  };
  if (mode !== 'same' || !isolate) pushT(0.5);
  for (const tri of interiors) {
    if (skipIsolated(tri, leftoverV, isolate)) continue;
    if (!orientOk(tri.n, seedN, mode)) continue;
    for (const [p, q] of [
      [tri.pu, tri.pv],
      [tri.pv, tri.pw],
      [tri.pw, tri.pu],
    ] as const) {
      const hit = closestSegmentTs(pa, pb, p, q);
      if (hit.dist > cap) continue;
      if (hit.s <= 0 || hit.s >= 1) continue;
      pushT(hit.t);
    }
  }
  ts.sort((a, b) => a - b);
  for (let i = 0; i < ts.length - 1 && ts.length < STRIP_SAMPLES + 2; i++) {
    const gap = (ts[i + 1] - ts[i]) * abLen;
    if (gap <= mean) continue;
    const mid = (ts[i] + ts[i + 1]) * 0.5;
    const key = mid.toFixed(4);
    if (seen.has(key) || mid <= SUB_TMIN || mid >= SUB_TMAX) continue;
    seen.add(key);
    ts.splice(i + 1, 0, mid);
  }

  const projected: (StripSample | null)[] = [];
  for (const t of ts) {
    const p: Vec3 = [pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t, pa[2] + (pb[2] - pa[2]) * t];
    const hit = projectOntoSheet(p, seedN, leftoverV, interiors, cap, mode, isolate);
    projected.push(hit ? { t, q: hit.q, face: nearestInteriorFace(hit.q, seedN, leftoverV, interiors, mode, isolate), dist: hit.dist } : null);
  }

  let best: StripSample[] = [];
  let run: StripSample[] = [];
  for (const sample of projected) {
    if (sample && sample.face >= 0 && sample.dist <= cap) {
      run.push(sample);
      if (run.length > best.length) best = run;
    } else run = [];
  }
  if (best.length < 2) return [];
  for (let i = 1; i < best.length; i++) {
    const leftoverStep = Math.abs(best[i].t - best[i - 1].t) * abLen;
    if (length(sub(best[i].q, best[i - 1].q)) > leftoverStep * 3 + mean) return [];
  }
  return best;
}

function nearestInteriorFace(
  q: Vec3,
  seedN: Vec3,
  leftoverV: Set<number>,
  interiors: InteriorFace[],
  mode: OrientMode = 'same',
  isolate: boolean = true,
): number {
  let best = -1;
  let bestD = Infinity;
  for (const tri of interiors) {
    if (skipIsolated(tri, leftoverV, isolate)) continue;
    if (!orientOk(tri.n, seedN, mode)) continue;
    const hit = closestPointOnTriangle(q, tri.pu, tri.pv, tri.pw);
    if (hit.dist < bestD) {
      bestD = hit.dist;
      best = tri.face;
    }
  }
  return best;
}

function nearestSheetDist(
  p: Vec3,
  seedN: Vec3,
  leftoverV: Set<number>,
  interiors: InteriorFace[],
  mode: OrientMode,
  isolate: boolean,
): number {
  let best = Infinity;
  for (const tri of interiors) {
    if (skipIsolated(tri, leftoverV, isolate)) continue;
    if (!orientOk(tri.n, seedN, mode)) continue;
    const hit = closestPointOnTriangle(p, tri.pu, tri.pv, tri.pw);
    if (hit.dist < best) best = hit.dist;
  }
  return best;
}

type InteriorFace = { face: number; u: number; v: number; w: number; pu: Vec3; pv: Vec3; pw: Vec3; n: Vec3 };

function collectInteriorFaces(mesh: MeshData, incidence: EdgeIncidence): InteriorFace[] {
  const out: InteriorFace[] = [];
  const { indices } = mesh;
  for (let t = 0; t < indices.length; t += 3) {
    const u = indices[t];
    const v = indices[t + 1];
    const w = indices[t + 2];
    if (incidence.count(u, v) !== 2 || incidence.count(v, w) !== 2 || incidence.count(w, u) !== 2) continue;
    const pu = vertexAt(mesh.positions, u);
    const pv = vertexAt(mesh.positions, v);
    const pw = vertexAt(mesh.positions, w);
    const n = triangleNormalRaw(pu, pv, pw);
    if (length(n) < 1e-18) continue;
    out.push({ face: t / 3, u, v, w, pu, pv, pw, n: normalize(n) });
  }
  return out;
}

function projectOntoSheet(
  p: Vec3,
  seedN: Vec3,
  leftoverV: Set<number>,
  interiors: InteriorFace[],
  cap: number,
  mode: OrientMode = 'same',
  isolate: boolean = true,
): { q: Vec3; dist: number; inside: boolean } | null {
  let best: { q: Vec3; dist: number; inside: boolean } | null = null;
  for (const tri of interiors) {
    if (skipIsolated(tri, leftoverV, isolate)) continue;
    if (!orientOk(tri.n, seedN, mode)) continue;
    const hit = closestPointOnTriangle(p, tri.pu, tri.pv, tri.pw);
    if (hit.dist > cap) continue;
    const inside = hit.kind === 'face';
    if (!best || (inside && !best.inside) || (inside === best.inside && hit.dist < best.dist)) {
      best = { q: hit.q, dist: hit.dist, inside };
    }
  }
  return best;
}

function faceShadowCover(
  pa: Vec3,
  pb: Vec3,
  seedN: Vec3,
  leftoverV: Set<number>,
  interiors: InteriorFace[],
  cap: number,
  mode: OrientMode = 'same',
  isolate: boolean = true,
): number {
  const intervals: [number, number][] = [];
  for (const tri of interiors) {
    if (skipIsolated(tri, leftoverV, isolate)) continue;
    if (!orientOk(tri.n, seedN, mode)) continue;
    const d = Math.min(
      pointSegDist(tri.pu, pa, pb),
      pointSegDist(tri.pv, pa, pb),
      pointSegDist(tri.pw, pa, pb),
      pointSegDist(faceCentroidPts(tri.pu, tri.pv, tri.pw), pa, pb),
    );
    if (d > cap) continue;
    const ts = [projectSegT(tri.pu, pa, pb).tClamp, projectSegT(tri.pv, pa, pb).tClamp, projectSegT(tri.pw, pa, pb).tClamp];
    const t0 = Math.min(...ts);
    const t1 = Math.max(...ts);
    if (t1 - t0 < 1e-6) continue;
    intervals.push([t0, t1]);
  }
  return unionIntervalLength(intervals);
}

function collectInteriorEdges(interiors: InteriorFace[]): { p: Vec3; q: Vec3; n: Vec3; u: number; v: number }[] {
  const seen = new Set<string>();
  const out: { p: Vec3; q: Vec3; n: Vec3; u: number; v: number }[] = [];
  for (const tri of interiors) {
    for (const [u, v, p, q] of [
      [tri.u, tri.v, tri.pu, tri.pv],
      [tri.v, tri.w, tri.pv, tri.pw],
      [tri.w, tri.u, tri.pw, tri.pu],
    ] as const) {
      const key = u < v ? `${u}:${v}` : `${v}:${u}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ p, q, n: tri.n, u, v });
    }
  }
  return out;
}

function recapDrawnChains(mesh: MeshData, maxCommits: number): { mesh: MeshData; commits: number } {
  const drawn = listDrawnLeftoverEdges(mesh);
  if (drawn.length < 2) return { mesh, commits: 0 };
  const chains = openChainsFromEdges(drawn).filter((v) => v.length >= 3 && v.length <= MAX_RECAP_VERTS);
  if (chains.length === 0) return { mesh, commits: 0 };
  let working = mesh;
  let commits = 0;
  let beforeNm = buildTopology(working).nonManifoldEdgeCount;
  let before1 = buildTopology(working).boundaryEdgeCount;
  for (const verts of chains) {
    if (commits >= maxCommits) break;
    if (new EdgeIncidence(working).count(verts[0], verts[verts.length - 1]) >= 2) continue;
    const faces = facesOfEdge(working, verts[0], verts[1]);
    if (faces.length === 0) continue;
    const seedN = faceNormal(working, faces[0]);
    const trial = fillLoop(working, verts, seedN, true);
    if (!trial) continue;
    const after = buildTopology(trial);
    if (after.nonManifoldEdgeCount > beforeNm) continue;
    if (after.boundaryEdgeCount >= before1) continue;
    working = trial;
    beforeNm = after.nonManifoldEdgeCount;
    before1 = after.boundaryEdgeCount;
    commits++;
  }
  return { mesh: working, commits };
}

function openChainsFromEdges(edges: number[][]): number[][] {
  const adj = new Map<number, number[]>();
  const add = (u: number, v: number) => {
    const list = adj.get(u);
    if (list) {
      if (!list.includes(v)) list.push(v);
    } else adj.set(u, [v]);
  };
  for (const [a, b] of edges) {
    add(a, b);
    add(b, a);
  }
  const used = new Set<string>();
  const chains: number[][] = [];
  const starts = [...adj.entries()].filter(([, n]) => n.length === 1).map(([v]) => v);
  const walk = (start: number) => {
    const verts = [start];
    let prev = -1;
    let cur = start;
    for (;;) {
      const nexts = (adj.get(cur) ?? []).filter((v) => v !== prev);
      if (nexts.length === 0) break;
      const nxt = nexts[0];
      const key = cur < nxt ? `${cur}:${nxt}` : `${nxt}:${cur}`;
      if (used.has(key)) break;
      used.add(key);
      verts.push(nxt);
      prev = cur;
      cur = nxt;
      if ((adj.get(cur)?.length ?? 0) !== 2 && cur !== start) break;
    }
    return verts;
  };
  for (const start of starts) {
    const degree = adj.get(start)?.length ?? 0;
    if (degree !== 1) continue;
    const verts = walk(start);
    if (verts.length >= 3) chains.push(verts);
  }
  return chains;
}

function leftoverLooksAttached(
  a: number,
  b: number,
  pa: Vec3,
  pb: Vec3,
  seedN: Vec3,
  leftoverV: Set<number>,
  interiors: InteriorFace[],
  mean: number,
): 'isolation' | 'flipped' | null {
  const drawCap = mean * STRIP_DRAW;
  const mid: Vec3 = [(pa[0] + pb[0]) * 0.5, (pa[1] + pb[1]) * 0.5, (pa[2] + pb[2]) * 0.5];
  const abLen = length(sub(pb, pa));
  const flipHit = nearestSheetHit(mid, seedN, leftoverV, interiors, 'flip', false);
  if (flipHit && flipHit.kind === 'face' && flipHit.dist <= drawCap) return 'flipped';

  const sharesA = vertexOnInterior(a, interiors);
  const sharesB = vertexOnInterior(b, interiors);
  const faceShares = leftoverFaceSharesSheet(leftoverV, interiors);
  const hitA = nearestSheetHit(pa, seedN, leftoverV, interiors, 'any', false);
  const hitB = nearestSheetHit(pb, seedN, leftoverV, interiors, 'any', false);
  const hitM = nearestSheetHit(mid, seedN, leftoverV, interiors, 'any', false);
  const endsOnSheet = !!(hitA && hitA.dist <= drawCap && hitB && hitB.dist <= drawCap);
  const midOnSheet = !!(hitM && hitM.kind !== 'vertex' && hitM.dist <= mean * STRIP_OFFSET);
  const midCoplanar = !!(hitM && hitM.kind === 'face' && hitM.dist <= drawCap);
  if (abLen <= mean * 2) {
    if (sharesA !== sharesB) return 'isolation';
    if (!sharesA && !sharesB && faceShares) return 'isolation';
  }
  if ((sharesA || sharesB || endsOnSheet) && (abLen <= mean * 2 || midCoplanar) && midOnSheet) return 'isolation';
  if (sharesA && sharesB) {
    const sameHit = nearestSheetHit(mid, seedN, leftoverV, interiors, 'same', false);
    if (sameHit && sameHit.dist <= drawCap) return 'isolation';
  }
  return null;
}

function leftoverFaceSharesSheet(leftoverV: Set<number>, interiors: InteriorFace[]): boolean {
  for (const v of leftoverV) {
    if (vertexOnInterior(v, interiors)) return true;
  }
  return false;
}

function vertexOnInterior(v: number, interiors: InteriorFace[]): boolean {
  for (const tri of interiors) {
    if (tri.u === v || tri.v === v || tri.w === v) return true;
  }
  return false;
}

function nearestSheetHit(
  p: Vec3,
  seedN: Vec3,
  leftoverV: Set<number>,
  interiors: InteriorFace[],
  mode: OrientMode,
  isolate: boolean,
): { dist: number; kind: 'vertex' | 'edge' | 'face' } | null {
  let best: { dist: number; kind: 'vertex' | 'edge' | 'face' } | null = null;
  for (const tri of interiors) {
    if (skipIsolated(tri, leftoverV, isolate)) continue;
    if (!orientOk(tri.n, seedN, mode)) continue;
    const hit = closestPointOnTriangle(p, tri.pu, tri.pv, tri.pw);
    if (!best || hit.dist < best.dist) best = { dist: hit.dist, kind: hit.kind };
  }
  return best;
}

function leftoverHugSheet(
  pa: Vec3,
  pb: Vec3,
  seedN: Vec3,
  leftoverV: Set<number>,
  interiors: InteriorFace[],
  interiorEdges: { p: Vec3; q: Vec3; n: Vec3; u: number; v: number }[],
  drawCap: number,
  coverCap: number,
): boolean {
  if (hugWithSeed(pa, pb, seedN, leftoverV, interiors, interiorEdges, drawCap, coverCap)) return true;
  const mid: Vec3 = [(pa[0] + pb[0]) * 0.5, (pa[1] + pb[1]) * 0.5, (pa[2] + pb[2]) * 0.5];
  const sheetN = nearestSheetNormal(mid, leftoverV, interiors, coverCap);
  if (sheetN && Math.abs(dot(sheetN, seedN)) < OVERLAP_NORMAL) {
    if (hugWithSeed(pa, pb, sheetN, leftoverV, interiors, interiorEdges, drawCap, coverCap)) return true;
  }
  const flipped: Vec3 = [-seedN[0], -seedN[1], -seedN[2]];
  return hugWithSeed(pa, pb, flipped, leftoverV, interiors, interiorEdges, drawCap, coverCap);
}

function nearestSheetNormal(p: Vec3, leftoverV: Set<number>, interiors: InteriorFace[], cap: number): Vec3 | null {
  let best: Vec3 | null = null;
  let bestD = cap;
  for (const tri of interiors) {
    if (leftoverV.has(tri.u) || leftoverV.has(tri.v) || leftoverV.has(tri.w)) continue;
    const hit = closestPointOnTriangle(p, tri.pu, tri.pv, tri.pw);
    if (hit.dist <= bestD) {
      bestD = hit.dist;
      best = tri.n;
    }
  }
  return best;
}

function hugWithSeed(
  pa: Vec3,
  pb: Vec3,
  seedN: Vec3,
  leftoverV: Set<number>,
  interiors: InteriorFace[],
  interiorEdges: { p: Vec3; q: Vec3; n: Vec3; u: number; v: number }[],
  drawCap: number,
  coverCap: number,
): boolean {
  const mid: Vec3 = [(pa[0] + pb[0]) * 0.5, (pa[1] + pb[1]) * 0.5, (pa[2] + pb[2]) * 0.5];
  const projA = projectOntoSheet(pa, seedN, leftoverV, interiors, drawCap);
  const projB = projectOntoSheet(pb, seedN, leftoverV, interiors, drawCap);
  const projM = projectOntoSheet(mid, seedN, leftoverV, interiors, drawCap);
  if ((projA?.inside && projA.dist <= drawCap) || (projB?.inside && projB.dist <= drawCap) || (projM?.inside && projM.dist <= drawCap)) {
    return true;
  }
  const cover = faceShadowCover(pa, pb, seedN, leftoverV, interiors, coverCap);
  const ts = [0, 0.25, 0.5, 0.75, 1];
  let sum = 0;
  let hits = 0;
  for (const t of ts) {
    const p: Vec3 = [pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t, pa[2] + (pb[2] - pa[2]) * t];
    const hit = projectOntoSheet(p, seedN, leftoverV, interiors, coverCap);
    if (!hit) continue;
    sum += hit.dist;
    hits++;
  }
  const meanOff = hits > 0 ? sum / hits : Infinity;
  const abLen = length(sub(pb, pa));
  if (hits >= 3 && meanOff <= drawCap) {
    if (cover >= POLY_COVER) return true;
    if (abLen <= coverCap) return true;
  }
  let near = Infinity;
  let nearN = seedN;
  const edgeHits: { t0: number; t1: number; n: Vec3; d: number }[] = [];
  for (const edge of interiorEdges) {
    if (leftoverV.has(edge.u) || leftoverV.has(edge.v)) continue;
    const d = segmentSegmentDist(pa, pb, edge.p, edge.q);
    if (d > coverCap) continue;
    const tp = projectSegT(edge.p, pa, pb);
    const tq = projectSegT(edge.q, pa, pb);
    const t0 = Math.min(tp.tClamp, tq.tClamp);
    const t1 = Math.max(tp.tClamp, tq.tClamp);
    if (t1 - t0 < 1e-6) continue;
    edgeHits.push({ t0, t1, n: edge.n, d });
    if (d < near) {
      near = d;
      nearN = edge.n;
    }
  }
  if (near > drawCap) return false;
  const ref = dot(nearN, seedN) >= OVERLAP_NORMAL ? seedN : nearN;
  const intervals: [number, number][] = [];
  for (const hit of edgeHits) {
    if (dot(hit.n, ref) < OVERLAP_NORMAL) continue;
    intervals.push([hit.t0, hit.t1]);
  }
  return unionIntervalLength(intervals) >= POLY_COVER;
}

function faceCentroidPts(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  return [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
}

function addGapStrip(mesh: MeshData, cand: StripCandidate): MeshData | null {
  const incidence = new EdgeIncidence(mesh);
  if (incidence.count(cand.a, cand.b) !== 1) return null;
  const samples = cand.samples;
  if (samples.length < 2) return null;

  const aligned = leftoverVertsForSamples(mesh, cand.a, cand.b, samples);
  if (!aligned) return null;
  const { mesh: working, verts: leftoverVerts } = aligned;
  if (leftoverVerts.length !== samples.length || leftoverVerts.length < 2) return null;

  const extra: number[] = [];
  for (const sample of samples) extra.push(sample.q[0], sample.q[1], sample.q[2]);
  const basePrime = working.positions.length / 3;
  const positions = concatPositions(working.positions, extra);
  const tris: number[] = [];
  const inc = new EdgeIncidence({ positions, indices: working.indices });
  for (let i = 0; i < leftoverVerts.length - 1; i++) {
    const left = leftoverVerts[i];
    const right = leftoverVerts[i + 1];
    const p0 = basePrime + i;
    const p1 = basePrime + i + 1;
    if (left === right || p0 === p1) return null;
    if (inc.count(left, right) !== 1) return null;
    if (inc.count(p0, p1) !== 0 || inc.count(right, p1) !== 0) return null;
    const spoke = inc.count(left, p0);
    if (i === 0 ? spoke !== 0 : spoke !== 1) return null;
    if (inc.count(p0, p1) >= 2 || inc.count(left, p0) >= 2 || inc.count(right, p1) >= 2) return null;
    const leftoverFace = facesOfEdge(working, left, right)[0];
    if (leftoverFace === undefined) return null;
    const flip = leftoverHasDirectedEdge(working, leftoverFace, left, right);
    const quad = flip ? [right, left, p1, left, p0, p1] : [left, right, p1, left, p1, p0];
    const n0 = triangleNormalRaw(vertexAt(positions, quad[0]), vertexAt(positions, quad[1]), vertexAt(positions, quad[2]));
    const n1 = triangleNormalRaw(vertexAt(positions, quad[3]), vertexAt(positions, quad[4]), vertexAt(positions, quad[5]));
    if (length(n0) < 1e-18 || length(n1) < 1e-18) return null;
    tris.push(...quad);
    inc.addTriangle(quad[0], quad[1], quad[2]);
    inc.addTriangle(quad[3], quad[4], quad[5]);
  }
  return { positions, indices: concatIndices(working.indices, tris) };
}

function leftoverVertsForSamples(
  mesh: MeshData,
  a: number,
  b: number,
  samples: StripSample[],
): { mesh: MeshData; verts: number[] } | null {
  const splitTs = [...new Set(samples.map((s) => s.t).filter((t) => t > SUB_TMIN && t < SUB_TMAX))].sort((x, y) => x - y);
  if (splitTs.length === 0) {
    if (samples.length !== 2) return null;
    return { mesh, verts: [a, b] };
  }
  const split = splitAtTs(mesh, a, b, splitTs);
  if (!split) return null;
  const verts: number[] = [];
  for (const sample of samples) {
    if (sample.t <= SUB_TMIN) verts.push(a);
    else if (sample.t >= SUB_TMAX) verts.push(b);
    else {
      const idx = splitTs.findIndex((t) => Math.abs(t - sample.t) < 1e-4);
      if (idx < 0) return null;
      verts.push(split.verts[idx + 1]);
    }
  }
  return { mesh: split.mesh, verts };
}

function closestPointOnTriangle(
  p: Vec3,
  a: Vec3,
  b: Vec3,
  c: Vec3,
): { q: Vec3; dist: number; kind: 'vertex' | 'edge' | 'face' } {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return { q: a, dist: Math.sqrt(dist2(p, a)), kind: 'vertex' };
  const bp = sub(p, b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return { q: b, dist: Math.sqrt(dist2(p, b)), kind: 'vertex' };
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const t = d1 / (d1 - d3);
    const q: Vec3 = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
    return { q, dist: Math.sqrt(dist2(p, q)), kind: 'edge' };
  }
  const cp = sub(p, c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return { q: c, dist: Math.sqrt(dist2(p, c)), kind: 'vertex' };
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const t = d2 / (d2 - d6);
    const q: Vec3 = [a[0] + ac[0] * t, a[1] + ac[1] * t, a[2] + ac[2] * t];
    return { q, dist: Math.sqrt(dist2(p, q)), kind: 'edge' };
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const t = (d4 - d3) / (d4 - d3 + d5 - d6);
    const bc = sub(c, b);
    const q: Vec3 = [b[0] + bc[0] * t, b[1] + bc[1] * t, b[2] + bc[2] * t];
    return { q, dist: Math.sqrt(dist2(p, q)), kind: 'edge' };
  }
  const denom = va + vb + vc;
  const q: Vec3 = [a[0] + ab[0] * (vb / denom) + ac[0] * (vc / denom), a[1] + ab[1] * (vb / denom) + ac[1] * (vc / denom), a[2] + ab[2] * (vb / denom) + ac[2] * (vc / denom)];
  return { q, dist: Math.sqrt(dist2(p, q)), kind: 'face' };
}

/**
 * 그림자 면 안에 leftover 1-face를 Steiner 제약변으로 넣는다.
 * 면을 구멍으로 지우지 않고, 같은 UVW를 자식 삼각형으로 다시 덮는다.
 */
export function insertOneConstrained(mesh: MeshData): MeshData | null {
  return collectInsertTrials(mesh, { stopAtFirst: true, limit: 80 })?.commit ?? null;
}

function collectInsertTrials(
  mesh: MeshData,
  options: { stopAtFirst: boolean; limit: number },
): {
  leftoverOneFace: number;
  uniqueContaining: number;
  multiFace: number;
  commit: MeshData | null;
  results: { reason: string; [k: string]: number | string }[];
} | null {
  const topology = buildTopology(mesh);
  if (topology.fillFrom.length === 0) return null;
  const incidence = new EdgeIncidence(mesh);
  const mean = incidence.meanLength;
  if (mean <= 0) return null;
  const interiorMap = buildInteriorEdgeMap(mesh, incidence);

  const leftover: { a: number; b: number; face: number }[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < topology.fillFrom.length; i++) {
    const a = topology.fillFrom[i];
    const b = topology.fillTo[i];
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    leftover.push({ a, b, face: topology.fillFace[i] });
  }
  leftover.sort((x, y) => {
    const lx = length(sub(vertexAt(mesh.positions, x.b), vertexAt(mesh.positions, x.a)));
    const ly = length(sub(vertexAt(mesh.positions, y.b), vertexAt(mesh.positions, y.a)));
    return ly - lx;
  });

  const results: { reason: string; [k: string]: number | string }[] = [];
  const uniqueTrials: { ab: { a: number; b: number; face: number }; face: number; shadow: number; cover: number }[] = [];
  const multiTrials: { ab: { a: number; b: number; face: number }; shadow: { face: number }[]; cover: number }[] = [];
  let uniqueContaining = 0;
  let multiFace = 0;

  for (const ab of leftover) {
    const shadow = collectShadowedFaces(mesh, ab, mean, incidence);
    const unique = shadow.filter((s) => s.insideA && s.insideB);
    if (unique.length === 1) {
      uniqueContaining++;
      uniqueTrials.push({ ab, face: unique[0].face, shadow: shadow.length, cover: 0 });
      continue;
    }
    const chain = collectShadowChain(mesh, ab, mean, interiorMap);
    const cover = chain?.cover ?? 0;
    if (cover >= POLY_COVER && shadow.length >= 1) {
      multiFace++;
      multiTrials.push({ ab, shadow, cover });
    } else if (results.length < 8) {
      results.push({ reason: 'contain', faces: shadow.length, unique: unique.length, cover: +cover.toFixed(3) });
    }
  }

  let commit: MeshData | null = null;
  const tryLimit = options.stopAtFirst ? uniqueTrials.length + multiTrials.length : Math.min(options.limit, uniqueTrials.length + multiTrials.length);
  let tried = 0;
  for (const item of uniqueTrials) {
    if (tried >= tryLimit) break;
    tried++;
    const trial = applyConstrainedInsert(mesh, item.ab.a, item.ab.b, item.face, item.ab.face);
    results.push({
      reason: trial.reason,
      faces: item.shadow,
      unique: 1,
      cover: +item.cover.toFixed(3),
      ...(trial.extra ?? {}),
    });
    if (trial.mesh && trial.reason === 'ok') {
      if (!commit) commit = trial.mesh;
      if (options.stopAtFirst) break;
    }
  }
  if (!commit || !options.stopAtFirst) {
    for (const item of multiTrials) {
      if (tried >= tryLimit) break;
      if (commit && options.stopAtFirst) break;
      tried++;
      const trial = applySplitConstrainedInsert(mesh, item.ab, item.shadow, mean);
      results.push({
        reason: trial.reason,
        faces: item.shadow.length,
        unique: 0,
        cover: +item.cover.toFixed(3),
        ...(trial.extra ?? {}),
      });
      if (trial.mesh && trial.reason === 'ok') {
        if (!commit) commit = trial.mesh;
        if (options.stopAtFirst) break;
      }
    }
  }

  return { leftoverOneFace: topology.fillFrom.length, uniqueContaining, multiFace, commit, results };
}

function collectShadowedFaces(
  mesh: MeshData,
  ab: { a: number; b: number; face: number },
  mean: number,
  incidence: EdgeIncidence,
): { face: number; insideA: boolean; insideB: boolean; dist: number }[] {
  const pa = vertexAt(mesh.positions, ab.a);
  const pb = vertexAt(mesh.positions, ab.b);
  const mid: Vec3 = [(pa[0] + pb[0]) * 0.5, (pa[1] + pb[1]) * 0.5, (pa[2] + pb[2]) * 0.5];
  const seedN = faceNormal(mesh, ab.face);
  const leftoverV = new Set(faceVerts(mesh, ab.face));
  const pad = mean * STENCIL_DIST;
  const out: { face: number; insideA: boolean; insideB: boolean; dist: number }[] = [];
  const { indices } = mesh;
  for (let t = 0; t < indices.length; t += 3) {
    const face = t / 3;
    const u = indices[t];
    const v = indices[t + 1];
    const w = indices[t + 2];
    if (leftoverV.has(u) || leftoverV.has(v) || leftoverV.has(w)) continue;
    if (incidence.count(u, v) !== 2 || incidence.count(v, w) !== 2 || incidence.count(w, u) !== 2) continue;
    if (dot(faceNormal(mesh, face), seedN) < OVERLAP_NORMAL) continue;
    const pu = vertexAt(mesh.positions, u);
    const pv = vertexAt(mesh.positions, v);
    const pw = vertexAt(mesh.positions, w);
    const baryA = barycentricOnTri(pa, pu, pv, pw);
    const baryB = barycentricOnTri(pb, pu, pv, pw);
    const baryM = barycentricOnTri(mid, pu, pv, pw);
    const centroidDist = pointSegDist(faceCentroid(mesh, face), pa, pb);
    const near = Math.min(baryA.dist, baryB.dist, baryM.dist, centroidDist) <= pad;
    if (!near) continue;
    out.push({
      face,
      insideA: baryInside(baryA, pad),
      insideB: baryInside(baryB, pad),
      dist: baryM.dist,
    });
  }
  out.sort((a, b) => a.dist - b.dist);
  return out;
}

function barycentricOnTri(p: Vec3, a: Vec3, b: Vec3, c: Vec3): { u: number; v: number; w: number; dist: number } {
  const v0 = sub(c, a);
  const v1 = sub(b, a);
  const n = cross(v1, v0);
  const nLen = length(n);
  if (nLen < 1e-18) return { u: -1, v: -1, w: -1, dist: Infinity };
  const nn = scale(n, 1 / nLen);
  const signed = dot(sub(p, a), nn);
  const pp: Vec3 = [p[0] - nn[0] * signed, p[1] - nn[1] * signed, p[2] - nn[2] * signed];
  const vp = sub(pp, a);
  const d00 = dot(v0, v0);
  const d01 = dot(v0, v1);
  const d11 = dot(v1, v1);
  const d20 = dot(vp, v0);
  const d21 = dot(vp, v1);
  const denom = d00 * d11 - d01 * d01;
  if (Math.abs(denom) < 1e-18) return { u: -1, v: -1, w: -1, dist: Math.abs(signed) };
  const w = (d11 * d20 - d01 * d21) / denom;
  const v = (d00 * d21 - d01 * d20) / denom;
  const u = 1 - v - w;
  return { u, v, w, dist: Math.abs(signed) };
}

function baryInside(bary: { u: number; v: number; w: number; dist: number }, planeCap: number): boolean {
  return bary.u > INSERT_BARY && bary.v > INSERT_BARY && bary.w > INSERT_BARY && bary.dist <= planeCap;
}

function applyConstrainedInsert(
  mesh: MeshData,
  a: number,
  b: number,
  face: number,
  leftoverFace: number,
): { mesh: MeshData | null; reason: string; extra?: Record<string, number | string> } {
  const vs = faceVerts(mesh, face);
  if (vs.includes(a) || vs.includes(b)) return { mesh: null, reason: 'shared' };
  const leftoverVs = faceVerts(mesh, leftoverFace);
  if (vs.some((v) => leftoverVs.includes(v))) return { mesh: null, reason: 'shared' };

  const pa = vertexAt(mesh.positions, a);
  const pb = vertexAt(mesh.positions, b);
  const abLen = length(sub(pb, pa));
  if (abLen < 1e-18) return { mesh: null, reason: 'degenerate' };

  const incidence = new EdgeIncidence(mesh);
  const spokeA = vs.filter((v) => incidence.count(a, v) === 1);
  const spokeB = vs.filter((v) => incidence.count(b, v) === 1);
  const both = vs.filter((v) => incidence.count(a, v) === 1 && incidence.count(b, v) === 1);
  let W = -1;
  let U = -1;
  let V = -1;
  if (both.length === 1) {
    V = both[0];
    const rest = vs.filter((v) => v !== V);
    W = rest.reduce((best, v) => (pointSegDist(vertexAt(mesh.positions, v), pa, pb) > pointSegDist(vertexAt(mesh.positions, best), pa, pb) ? v : best), rest[0]);
    U = rest.find((v) => v !== W) ?? rest[0];
  } else {
    W = vs.reduce((best, v) => (pointSegDist(vertexAt(mesh.positions, v), pa, pb) > pointSegDist(vertexAt(mesh.positions, best), pa, pb) ? v : best), vs[0]);
    const others = vs.filter((v) => v !== W);
    const uPref = spokeA.find((v) => v !== W && others.includes(v));
    const vPref = spokeB.find((v) => v !== W && others.includes(v) && v !== uPref);
    U = uPref ?? others[0];
    V = vPref ?? others.find((v) => v !== U) ?? others[1];
  }
  if (U < 0 || V < 0 || W < 0 || U === V || V === W || U === W) return { mesh: null, reason: 'degenerate' };
  const bestD = pointSegDist(vertexAt(mesh.positions, W), pa, pb);
  if (bestD < abLen * 1e-4) return { mesh: null, reason: 'degenerate' };

  const sheetN = faceNormal(mesh, face);
  if (incidence.count(vs[0], vs[1]) !== 2 || incidence.count(vs[1], vs[2]) !== 2 || incidence.count(vs[2], vs[0]) !== 2) {
    return { mesh: null, reason: 'notinterior' };
  }
  if (incidence.count(a, b) !== 1) return { mesh: null, reason: 'abcount' };

  let next = deleteFaces(mesh, [face]);
  const inc = new EdgeIncidence(next);
  const children: number[] = [];
  const add = (i: number, j: number, k: number): boolean => {
    if (i === j || j === k || i === k) return false;
    if (inc.wouldCreateNonManifold(i, j, k)) return false;
    const n = triangleNormalRaw(vertexAt(next.positions, i), vertexAt(next.positions, j), vertexAt(next.positions, k));
    if (length(n) < 1e-18) return false;
    children.push(i, j, k);
    inc.addTriangle(i, j, k);
    return true;
  };
  const orient = (i: number, j: number, k: number, hint: Vec3): [number, number, number] => {
    const n = triangleNormalRaw(vertexAt(next.positions, i), vertexAt(next.positions, j), vertexAt(next.positions, k));
    return dot(n, hint) < 0 ? [i, k, j] : [i, j, k];
  };

  const abChild = leftoverHasDirectedEdge(mesh, leftoverFace, a, b) ? [b, a, W] : [a, b, W];
  const tris: [number, number, number][] = [
    [abChild[0], abChild[1], abChild[2]],
    orient(U, a, W, sheetN),
    orient(V, b, W, sheetN),
    orient(U, V, a, sheetN),
  ];
  for (const tri of tris) {
    if (!add(tri[0], tri[1], tri[2])) {
      return { mesh: null, reason: 'degenerate', extra: { children: children.length / 3 } };
    }
  }
  next = { positions: next.positions, indices: concatIndices(next.indices, children) };

  const wing = findWingOnAB(mesh, a, b);
  if (wing >= 0) next = weldSecondToFirst(next, a, wing);

  return classifyInsertSafer(mesh, next, { wing, children: children.length / 3 });
}

function applySplitConstrainedInsert(
  mesh: MeshData,
  ab: { a: number; b: number; face: number },
  shadow: { face: number }[],
  mean: number,
): { mesh: MeshData | null; reason: string; extra?: Record<string, number | string> } {
  const faces = shadow.map((s) => s.face);
  const ts = crossingTs(mesh, ab.a, ab.b, faces, mean);
  let working = mesh;
  let verts = [ab.a, ab.b];
  if (ts.length > 0) {
    const split = splitAtTs(mesh, ab.a, ab.b, ts);
    if (!split) return { mesh: null, reason: 'degenerate', extra: { step: 'split' } };
    working = split.mesh;
    verts = split.verts;
  }

  let inserts = 0;
  for (let i = 0; i < verts.length - 1; i++) {
    const left = verts[i];
    const right = verts[i + 1];
    const leftoverFace = facesOfEdge(working, left, right)[0];
    if (leftoverFace === undefined) continue;
    const inc = new EdgeIncidence(working);
    const candidates = collectShadowedFaces(working, { a: left, b: right, face: leftoverFace }, mean, inc);
    const unique = candidates.filter((s) => s.insideA && s.insideB);
    const target = unique[0] ?? candidates.find((s) => s.insideA || s.insideB) ?? candidates[0];
    if (!target) continue;
    const trial = applyConstrainedInsert(working, left, right, target.face, leftoverFace);
    if (!trial.mesh) {
      return { mesh: null, reason: trial.reason, extra: { ...(trial.extra ?? {}), inserts, segs: verts.length - 1 } };
    }
    working = trial.mesh;
    inserts++;
  }
  if (inserts === 0) return { mesh: null, reason: 'contain', extra: { segs: verts.length - 1 } };
  return classifyInsertSafer(mesh, working, { inserts, segs: verts.length - 1 });
}

function classifyInsertSafer(
  before: MeshData,
  after: MeshData,
  extra: Record<string, number | string> = {},
): { mesh: MeshData | null; reason: string; extra?: Record<string, number | string> } {
  const a = buildTopology(before);
  const b = buildTopology(after);
  const payload = {
    ...extra,
    before1: a.boundaryEdgeCount,
    after1: b.boundaryEdgeCount,
    beforeNm: a.nonManifoldEdgeCount,
    afterNm: b.nonManifoldEdgeCount,
  };
  if (b.nonManifoldEdgeCount > a.nonManifoldEdgeCount) return { mesh: null, reason: 'nm', extra: payload };
  if (b.boundaryEdgeCount >= a.boundaryEdgeCount) return { mesh: null, reason: 'oneface', extra: payload };
  return { mesh: after, reason: 'ok', extra: payload };
}

function leftoverHasDirectedEdge(mesh: MeshData, face: number, a: number, b: number): boolean {
  const [i, j, k] = faceVerts(mesh, face);
  return (i === a && j === b) || (j === a && k === b) || (k === a && i === b);
}

function findWingOnAB(mesh: MeshData, a: number, b: number): number {
  const topology = buildTopology(mesh);
  const pa = vertexAt(mesh.positions, a);
  const pb = vertexAt(mesh.positions, b);
  const abLen = length(sub(pb, pa));
  if (abLen < 1e-18) return -1;
  const fromA: number[] = [];
  const fromB: number[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < topology.fillFrom.length; i++) {
    const u = topology.fillFrom[i];
    const v = topology.fillTo[i];
    const key = u < v ? `${u}:${v}` : `${v}:${u}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if ((u === a && v !== b) || (v === a && u !== b)) fromA.push(u === a ? v : u);
    if ((u === b && v !== a) || (v === b && u !== a)) fromB.push(u === b ? v : u);
  }
  for (const d of fromA) {
    if (!fromB.includes(d)) continue;
    if (pointSegDist(vertexAt(mesh.positions, d), pa, pb) > abLen * INSERT_WING) continue;
    return d;
  }
  return -1;
}

function weldSecondToFirst(mesh: MeshData, dest: number, src: number): MeshData {
  if (dest === src) return mesh;
  const V = mesh.positions.length / 3;
  if (src < 0 || dest < 0 || src >= V || dest >= V) return mesh;
  const remap = new Int32Array(V);
  for (let i = 0; i < V; i++) remap[i] = i;
  remap[src] = dest;
  return remapAndCompact(mesh, remap);
}

function crossingTs(mesh: MeshData, a: number, b: number, faces: number[], mean: number): number[] {
  const pa = vertexAt(mesh.positions, a);
  const pb = vertexAt(mesh.positions, b);
  const ts: number[] = [];
  const seen = new Set<string>();
  const push = (t: number) => {
    if (t <= SUB_TMIN || t >= SUB_TMAX) return;
    const key = t.toFixed(4);
    if (seen.has(key)) return;
    seen.add(key);
    ts.push(t);
  };
  for (const face of faces) {
    const [u, v, w] = faceVerts(mesh, face);
    for (const [p, q] of [
      [u, v],
      [v, w],
      [w, u],
    ] as const) {
      const hit = closestSegmentTs(pa, pb, vertexAt(mesh.positions, p), vertexAt(mesh.positions, q));
      if (hit.dist > mean * 0.15) continue;
      if (hit.s <= 0 || hit.s >= 1) continue;
      push(hit.t);
    }
  }
  ts.sort((x, y) => x - y);
  return ts;
}

function closestSegmentTs(a: Vec3, b: Vec3, c: Vec3, d: Vec3): { t: number; s: number; dist: number } {
  const u = sub(b, a);
  const v = sub(d, c);
  const w0 = sub(a, c);
  const uu = dot(u, u);
  const vv = dot(v, v);
  const uv = dot(u, v);
  const uw = dot(u, w0);
  const vw = dot(v, w0);
  const denom = uu * vv - uv * uv;
  let t = 0;
  let s = 0;
  if (Math.abs(denom) > 1e-18) {
    t = (uv * vw - vv * uw) / denom;
    s = (uu * vw - uv * uw) / denom;
  } else if (uu > 1e-18) {
    t = -uw / uu;
  }
  t = Math.max(0, Math.min(1, t));
  s = Math.max(0, Math.min(1, s));
  const p: Vec3 = [a[0] + u[0] * t, a[1] + u[1] * t, a[2] + u[2] * t];
  const q: Vec3 = [c[0] + v[0] * s, c[1] + v[1] * s, c[2] + v[2] * s];
  return { t, s, dist: Math.sqrt(dist2(p, q)) };
}

/**
 * 덮임이 큰 긴 1-face를 안쪽 그림자 체인에 맞춰 갈라, 꼭짓점을 빼고 리본만 지퍼한다.
 */
export function zipOnePolylineRibbon(mesh: MeshData): MeshData | null {
  return collectPolylineTrials(mesh, { stopAtFirst: true, limit: 80 })?.commit ?? null;
}

function collectPolylineTrials(
  mesh: MeshData,
  options: { stopAtFirst: boolean; limit: number },
): {
  leftoverOneFace: number;
  commit: MeshData | null;
  results: { reason: string; [k: string]: number | string }[];
} | null {
  const topology = buildTopology(mesh);
  if (topology.fillFrom.length === 0) return null;
  const incidence = new EdgeIncidence(mesh);
  const mean = incidence.meanLength;
  if (mean <= 0) return null;
  const interiorMap = buildInteriorEdgeMap(mesh, incidence);

  const leftover: { a: number; b: number; face: number }[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < topology.fillFrom.length; i++) {
    const a = topology.fillFrom[i];
    const b = topology.fillTo[i];
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    leftover.push({ a, b, face: topology.fillFace[i] });
  }
  leftover.sort((x, y) => {
    const lx = length(sub(vertexAt(mesh.positions, x.b), vertexAt(mesh.positions, x.a)));
    const ly = length(sub(vertexAt(mesh.positions, y.b), vertexAt(mesh.positions, y.a)));
    return ly - lx;
  });

  const results: { reason: string; [k: string]: number | string }[] = [];
  const candidates: { ab: { a: number; b: number; face: number }; shadow: { cover: number; polyline: number[]; faces: number[] } }[] = [];
  for (const ab of leftover) {
    const shadow = collectShadowChain(mesh, ab, mean, interiorMap);
    if (!shadow || shadow.cover < POLY_COVER || shadow.polyline.length < 2) {
      continue;
    }
    candidates.push({ ab, shadow });
  }

  let commit: MeshData | null = null;
  const limit = Math.min(candidates.length, options.limit);
  for (let i = 0; i < limit; i++) {
    const { ab, shadow } = candidates[i];
    const trial = applyPolylineRibbon(mesh, ab, shadow, mean);
    results.push({
      reason: trial.reason,
      cover: +shadow.cover.toFixed(3),
      shadow: shadow.polyline.length,
      faces: shadow.faces.length,
      ...(trial.extra ?? {}),
    });
    if (trial.mesh && trial.reason === 'ok') {
      if (!commit) commit = trial.mesh;
      if (options.stopAtFirst) break;
    }
  }
  return { leftoverOneFace: topology.fillFrom.length, commit, results };
}

function buildInteriorEdgeMap(
  mesh: MeshData,
  incidence: EdgeIncidence,
): Map<string, { p: number; q: number; faces: number[] }> {
  const interiorMap = new Map<string, { p: number; q: number; faces: number[] }>();
  const { indices } = mesh;
  for (let t = 0; t < indices.length; t += 3) {
    const vs = [indices[t], indices[t + 1], indices[t + 2]];
    const face = t / 3;
    for (let k = 0; k < 3; k++) {
      const p = vs[k];
      const q = vs[(k + 1) % 3];
      if (incidence.count(p, q) !== 2) continue;
      const key = p < q ? `${p}:${q}` : `${q}:${p}`;
      const cur = interiorMap.get(key);
      if (cur) {
        if (!cur.faces.includes(face)) cur.faces.push(face);
      } else interiorMap.set(key, { p, q, faces: [face] });
    }
  }
  return interiorMap;
}

function collectShadowChain(
  mesh: MeshData,
  ab: { a: number; b: number; face: number },
  mean: number,
  interiorMap: Map<string, { p: number; q: number; faces: number[] }>,
): { cover: number; polyline: number[]; faces: number[] } | null {
  const pa = vertexAt(mesh.positions, ab.a);
  const pb = vertexAt(mesh.positions, ab.b);
  const abLen = length(sub(pb, pa));
  if (abLen < mean * 0.5) return null;
  const seedN = faceNormal(mesh, ab.face);
  const leftoverV = new Set(faceVerts(mesh, ab.face));
  const pad = mean * SUB_DIST;
  const minX = Math.min(pa[0], pb[0]) - pad;
  const maxX = Math.max(pa[0], pb[0]) + pad;
  const minY = Math.min(pa[1], pb[1]) - pad;
  const maxY = Math.max(pa[1], pb[1]) + pad;
  const minZ = Math.min(pa[2], pb[2]) - pad;
  const maxZ = Math.max(pa[2], pb[2]) + pad;
  const hits: { p: number; q: number; t0: number; t1: number; faces: number[] }[] = [];
  for (const edge of interiorMap.values()) {
    if (leftoverV.has(edge.p) || leftoverV.has(edge.q)) continue;
    const pp = vertexAt(mesh.positions, edge.p);
    const pq = vertexAt(mesh.positions, edge.q);
    if (Math.max(pp[0], pq[0]) < minX || Math.min(pp[0], pq[0]) > maxX) continue;
    if (Math.max(pp[1], pq[1]) < minY || Math.min(pp[1], pq[1]) > maxY) continue;
    if (Math.max(pp[2], pq[2]) < minZ || Math.min(pp[2], pq[2]) > maxZ) continue;
    if (segmentSegmentDist(pa, pb, pp, pq) > pad) continue;
    if (!edge.faces.some((f) => dot(faceNormal(mesh, f), seedN) >= OVERLAP_NORMAL)) continue;
    const tp = projectSegT(pp, pa, pb);
    const tq = projectSegT(pq, pa, pb);
    const t0 = Math.min(tp.tClamp, tq.tClamp);
    const t1 = Math.max(tp.tClamp, tq.tClamp);
    if (t1 - t0 < 1e-6) continue;
    hits.push({
      p: edge.p,
      q: edge.q,
      t0,
      t1,
      faces: edge.faces.filter((f) => !faceVerts(mesh, f).some((v) => leftoverV.has(v))),
    });
  }
  if (hits.length === 0) return { cover: 0, polyline: [], faces: [] };
  const cover = unionIntervalLength(hits.map((h) => [h.t0, h.t1] as [number, number]));
  hits.sort((a, b) => (a.t0 + a.t1) / 2 - (b.t0 + b.t1) / 2);
  const polyline = stitchShadowPolyline(mesh, hits, pa, pb);
  const faces: number[] = [];
  const usedF = new Set<number>();
  for (const hit of hits) {
    let best = -1;
    let bestD = Infinity;
    for (const face of hit.faces) {
      if (usedF.has(face)) continue;
      const d = pointSegDist(faceCentroid(mesh, face), pa, pb);
      if (d < bestD) {
        bestD = d;
        best = face;
      }
    }
    if (best >= 0) {
      usedF.add(best);
      faces.push(best);
    }
  }
  return { cover, polyline, faces };
}

function stitchShadowPolyline(
  mesh: MeshData,
  hits: { p: number; q: number; t0: number; t1: number }[],
  pa: Vec3,
  pb: Vec3,
): number[] {
  if (hits.length === 0) return [];
  const tOf = (v: number) => projectSegT(vertexAt(mesh.positions, v), pa, pb).tClamp;
  const abDir = normalize(sub(pb, pa));
  const aligned = hits.filter((h) => {
    const d = sub(vertexAt(mesh.positions, h.q), vertexAt(mesh.positions, h.p));
    const len = length(d);
    return len > 1e-18 && Math.abs(dot(scale(d, 1 / len), abDir)) >= 0.5;
  });
  const pool = aligned.length >= 2 ? aligned : hits;
  const key = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  const walk = (start: number): number[] => {
    const used = new Set<string>();
    const out = [start];
    let cur = start;
    for (let step = 0; step < pool.length + 2; step++) {
      let next = -1;
      let nextT = Infinity;
      for (const hit of pool) {
        if (used.has(key(hit.p, hit.q))) continue;
        const other = hit.p === cur ? hit.q : hit.q === cur ? hit.p : -1;
        if (other < 0) continue;
        const t = tOf(other);
        if (t + 1e-9 < tOf(cur)) continue;
        if (t < nextT) {
          next = other;
          nextT = t;
        }
      }
      if (next < 0) break;
      used.add(key(cur, next));
      out.push(next);
      cur = next;
    }
    return out;
  };
  let best: number[] = [];
  const starts = new Set<number>();
  for (const hit of pool) starts.add(tOf(hit.p) <= tOf(hit.q) ? hit.p : hit.q);
  for (const start of starts) {
    const chain = walk(start);
    if (chain.length > best.length) best = chain;
  }
  if (best.length < 2) {
    const verts = new Set<number>();
    for (const hit of pool) {
      verts.add(hit.p);
      verts.add(hit.q);
    }
    return [...verts].sort((a, b) => tOf(a) - tOf(b));
  }
  return best;
}

function applyPolylineRibbon(
  mesh: MeshData,
  ab: { a: number; b: number; face: number },
  shadow: { cover: number; polyline: number[]; faces: number[] },
  mean: number,
): { mesh: MeshData | null; reason: string; extra?: Record<string, number | string> } {
  const pa = vertexAt(mesh.positions, ab.a);
  const pb = vertexAt(mesh.positions, ab.b);
  const leftoverVs = faceVerts(mesh, ab.face);
  const apex = leftoverVs.find((v) => v !== ab.a && v !== ab.b);
  if (apex === undefined) return { mesh: null, reason: 'zip' };
  const ts: number[] = [];
  const seenT = new Set<string>();
  const pushT = (t: number) => {
    if (t <= SUB_TMIN || t >= SUB_TMAX) return;
    const key = t.toFixed(4);
    if (seenT.has(key)) return;
    seenT.add(key);
    ts.push(t);
  };
  for (const v of shadow.polyline) pushT(projectSegT(vertexAt(mesh.positions, v), pa, pb).tClamp);
  if (ts.length < 3) {
    for (let k = 1; k <= 4; k++) pushT(k / 5);
  }
  ts.sort((a, b) => a - b);
  if (ts.length < 1) return { mesh: null, reason: 'zip' };

  const split = splitAtTs(mesh, ab.a, ab.b, ts);
  if (!split) return { mesh: null, reason: 'split' };
  let working = split.mesh;
  const rim = split.verts;
  const height = pointSegDist(vertexAt(working.positions, apex), pa, pb);
  const eps = Math.min(POLY_INSET, height > 1e-9 ? (0.12 * mean) / height : POLY_INSET);
  const insetPts: Vec3[] = rim.map((v) => {
    const pv = vertexAt(working.positions, v);
    const pc = vertexAt(working.positions, apex);
    return [pv[0] + (pc[0] - pv[0]) * eps, pv[1] + (pc[1] - pv[1]) * eps, pv[2] + (pc[2] - pv[2]) * eps];
  });
  const insetStart = working.positions.length / 3;
  working = appendVerts(working, insetPts);
  const inset = insetPts.map((_, i) => insetStart + i);

  const leftoverFaces: number[] = [];
  for (let i = 0; i < rim.length - 1; i++) {
    leftoverFaces.push(...facesWithVerts(working, [apex, rim[i], rim[i + 1]]));
  }
  if (leftoverFaces.length === 0) return { mesh: null, reason: 'zip' };
  const ribbonVerts = new Set<number>([...rim, ...shadow.polyline, apex]);
  for (const face of leftoverFaces) {
    for (const v of faceVerts(working, face)) ribbonVerts.add(v);
  }

  const drop: number[] = [...leftoverFaces];
  const remainder: number[] = [];
  const cutPts: Vec3[] = [];
  let sliverFaces = 0;
  let largeFaces = 0;
  const seenFace = new Set<number>();
  for (let i = 0; i < shadow.polyline.length - 1; i++) {
    const p = shadow.polyline[i];
    const q = shadow.polyline[i + 1];
    const found = facesOfEdge(working, p, q).filter((f) => {
      const vs = faceVerts(working, f);
      return !vs.includes(apex) && !rim.some((v) => vs.includes(v));
    });
    let best = -1;
    let bestD = Infinity;
    for (const face of found) {
      const d = pointSegDist(faceCentroid(working, face), pa, pb);
      if (d < bestD) {
        bestD = d;
        best = face;
      }
    }
    if (best < 0 || seenFace.has(best)) continue;
    seenFace.add(best);
    for (const v of faceVerts(working, best)) ribbonVerts.add(v);
    if (isSliverFace(working, best, pa, pb, mean)) {
      sliverFaces++;
      drop.push(best);
      continue;
    }
    const vs = faceVerts(working, best);
    const r = vs.find((v) => v !== p && v !== q);
    if (r === undefined) continue;
    const tp = projectSegT(vertexAt(working.positions, p), pa, pb).tClamp;
    const tq = projectSegT(vertexAt(working.positions, q), pa, pb).tClamp;
    const lo = Math.min(tp, tq);
    const hi = Math.max(tp, tq);
    const edgeTs = ts.filter((t) => t >= lo - 0.03 && t <= hi + 0.03);
    const cut = sliverCutPoints(working, p, q, r, pa, pb, mean, edgeTs, lo, hi);
    if (!cut) continue;
    largeFaces++;
    drop.push(best);
    const tStart = working.positions.length / 3 + cutPts.length;
    cutPts.push(...cut.pts);
    const tIdx = cut.pts.map((_, k) => tStart + k);
    const same = (vs[0] === p && vs[1] === q) || (vs[1] === p && vs[2] === q) || (vs[2] === p && vs[0] === q);
    remainder.push(...remainderAfterSliver(p, q, r, tIdx, same));
    for (const v of tIdx) ribbonVerts.add(v);
  }
  if (sliverFaces + largeFaces === 0) return { mesh: null, reason: 'zip' };

  if (cutPts.length > 0) working = appendVerts(working, cutPts);
  working = deleteFaces(working, [...new Set(drop)]);
  const added: number[] = [...remainder];
  for (let i = 0; i < inset.length - 1; i++) added.push(apex, inset[i], inset[i + 1]);
  if (facesOfEdge(working, apex, ab.a).length < 2) added.push(apex, ab.a, inset[0]);
  if (facesOfEdge(working, apex, ab.b).length < 2) added.push(apex, inset[inset.length - 1], ab.b);
  working = { positions: working.positions, indices: concatIndices(working.indices, added) };

  const cutStart = working.positions.length / 3 - cutPts.length;
  const cutVerts = cutPts.length > 0 ? cutPts.map((_, k) => cutStart + k) : shadow.polyline;
  const paired = pairPolylines(working, inset, cutVerts);
  if (!paired || paired.length < 2) {
    return { mesh: null, reason: 'zip', extra: { inset: inset.length, poly: cutVerts.length, large: largeFaces, sliver: sliverFaces } };
  }
  working = snapPairsToLower(working, paired);
  working = mergeVertexGroups(working, paired);
  const oneAfterZip = buildTopology(working).boundaryEdgeCount;

  const fillInfo: { found: number; filled: number; skipped: number; skipSizes?: string } = { found: 0, filled: 0, skipped: 0 };
  const filled = fillNearLoops(working, ribbonVerts, faceNormal(mesh, ab.face), fillInfo);
  if (filled) working = filled;

  if (isSaferOneFace(mesh, working)) {
    const after = buildTopology(working);
    return {
      mesh: working,
      reason: 'ok',
      extra: {
        after1: after.boundaryEdgeCount,
        before1: buildTopology(mesh).boundaryEdgeCount,
        oneAfterZip,
        large: largeFaces,
        sliver: sliverFaces,
        splits: cutPts.length,
        ...fillInfo,
      },
    };
  }
  const after = buildTopology(working);
  return {
    mesh: null,
    reason: 'safer',
    extra: {
      before1: buildTopology(mesh).boundaryEdgeCount,
      after1: after.boundaryEdgeCount,
      oneAfterZip,
      beforeNm: buildTopology(mesh).nonManifoldEdgeCount,
      afterNm: after.nonManifoldEdgeCount,
      inset: inset.length,
      poly: cutVerts.length,
      large: largeFaces,
      sliver: sliverFaces,
      splits: cutPts.length,
      ...fillInfo,
    },
  };
}

function isSliverFace(mesh: MeshData, face: number, pa: Vec3, pb: Vec3, mean: number): boolean {
  return faceVerts(mesh, face).every((v) => pointSegDist(vertexAt(mesh.positions, v), pa, pb) <= mean * SLIVER_VERT);
}

function sliverCutPoints(
  mesh: MeshData,
  p: number,
  q: number,
  r: number,
  pa: Vec3,
  pb: Vec3,
  mean: number,
  ts: number[],
  lo = 0,
  hi = 1,
): { pts: Vec3[] } | null {
  const pp = vertexAt(mesh.positions, p);
  const pq = vertexAt(mesh.positions, q);
  const pr = vertexAt(mesh.positions, r);
  const height = pointSegDist(pr, pp, pq);
  if (height < 1e-9) return null;
  const mid: Vec3 = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2];
  const pqDir = sub(pq, pp);
  const sameSide = dot(cross(pqDir, sub(mid, pp)), cross(pqDir, sub(pr, pp))) > 0;
  const projDist = pointSegDist(mid, pp, pq);
  const s = sameSide
    ? Math.min(0.35, Math.max(0.06, projDist / height))
    : Math.min(0.2, Math.max(0.06, (0.15 * mean) / height));
  const span = Math.max(1e-9, hi - lo);
  const samples = ts.length >= 2 ? ts : [lo + 0.2 * span, lo + 0.8 * span];
  const pts: Vec3[] = [];
  for (const t of samples) {
    const u = Math.min(0.92, Math.max(0.08, (t - lo) / span));
    const onPq: Vec3 = [pp[0] + (pq[0] - pp[0]) * u, pp[1] + (pq[1] - pp[1]) * u, pp[2] + (pq[2] - pp[2]) * u];
    pts.push([onPq[0] + (pr[0] - onPq[0]) * s, onPq[1] + (pr[1] - onPq[1]) * s, onPq[2] + (pr[2] - onPq[2]) * s]);
  }
  return pts.length >= 2 ? { pts } : null;
}

function remainderAfterSliver(p: number, q: number, r: number, tIdx: number[], same: boolean): number[] {
  if (tIdx.length < 2) return [];
  const t0 = tIdx[0];
  const tn = tIdx[tIdx.length - 1];
  const out: number[] = [];
  if (same) {
    out.push(p, t0, r);
    for (let i = 0; i < tIdx.length - 1; i++) out.push(tIdx[i], tIdx[i + 1], r);
    out.push(tn, q, r);
  } else {
    out.push(p, r, t0);
    for (let i = 0; i < tIdx.length - 1; i++) out.push(tIdx[i], r, tIdx[i + 1]);
    out.push(tn, r, q);
  }
  return out;
}

function splitAtTs(mesh: MeshData, a: number, b: number, ts: number[]): { mesh: MeshData; verts: number[] } | null {
  let working = mesh;
  const verts = [a];
  let left = a;
  let base = 0;
  for (const t of ts) {
    const tRel = (t - base) / Math.max(1e-9, 1 - base);
    const one = splitEdgeAt(working, left, b, tRel);
    if (!one) return null;
    working = one.mesh;
    verts.push(one.newIndex);
    left = one.newIndex;
    base = t;
  }
  verts.push(b);
  return { mesh: working, verts };
}

function appendVerts(mesh: MeshData, pts: Vec3[]): MeshData {
  const extra: number[] = [];
  for (const p of pts) extra.push(p[0], p[1], p[2]);
  return { positions: concatPositions(mesh.positions, extra), indices: mesh.indices };
}

function facesWithVerts(mesh: MeshData, vs: number[]): number[] {
  const want = new Set(vs);
  const out: number[] = [];
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = mesh.indices[t];
    const b = mesh.indices[t + 1];
    const c = mesh.indices[t + 2];
    if (want.has(a) && want.has(b) && want.has(c)) out.push(t / 3);
  }
  return out;
}

function snapPairsToLower(mesh: MeshData, pairs: number[][]): MeshData {
  const positions = new Float32Array(mesh.positions);
  for (const group of pairs) {
    if (group.length < 2) continue;
    let dest = group[0];
    for (const v of group) if (v < dest) dest = v;
    const dx = positions[dest * 3];
    const dy = positions[dest * 3 + 1];
    const dz = positions[dest * 3 + 2];
    for (const v of group) {
      positions[v * 3] = dx;
      positions[v * 3 + 1] = dy;
      positions[v * 3 + 2] = dz;
    }
  }
  return { positions, indices: mesh.indices };
}

function pairPolylines(mesh: MeshData, a: number[], b: number[]): number[][] | null {
  if (a.length < 2 || b.length < 2) return null;
  const pa = a.map((v) => vertexAt(mesh.positions, v));
  const pb = b.map((v) => vertexAt(mesh.positions, v));
  const rev = pb.slice().reverse();
  const d0 = oneSidedLoopDistance(pa, pb);
  const d1 = oneSidedLoopDistance(pa, rev);
  const vertsB = d1 < d0 ? b.slice().reverse() : b;
  const ptsB = d1 < d0 ? rev : pb;
  const nA = a.length;
  const nB = vertsB.length;
  const pairs: number[][] = [];
  const used = new Uint8Array(nB);
  for (let i = 0; i < nA; i++) {
    const j = Math.round((i * (nB - 1)) / Math.max(1, nA - 1));
    pairs.push([a[i], vertsB[j]]);
    used[j] = 1;
  }
  for (let j = 0; j < nB; j++) {
    if (used[j]) continue;
    let bi = 0;
    let bd = Infinity;
    for (let i = 0; i < nA; i++) {
      const d = dist2(ptsB[j], pa[i]);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    pairs.push([vertsB[j], a[bi]]);
  }
  return pairs.length >= 2 ? pairs : null;
}

function fillNearLoops(
  mesh: MeshData,
  seeds: Set<number>,
  hint: Vec3,
  info?: { found: number; filled: number; skipped: number; skipSizes?: string },
): MeshData | null {
  const loops = traceFillableLoops(buildTopology(mesh), LOOP_MIN);
  let working = mesh;
  let changed = false;
  const skipSizes: number[] = [];
  for (const loop of loops) {
    if (loop.vertices.length < LOOP_MIN || loop.vertices.length > LOOP_MAX) {
      if (info && loop.vertices.some((v) => seeds.has(v))) {
        info.skipped++;
        skipSizes.push(loop.closed ? loop.vertices.length : -loop.vertices.length);
      }
      continue;
    }
    if (!loop.vertices.some((v) => seeds.has(v))) continue;
    if (info) info.found++;
    const filled = fillLoop(working, loop.vertices, hint, loop.closed, true);
    if (!filled) continue;
    if (buildTopology(filled).nonManifoldEdgeCount > buildTopology(working).nonManifoldEdgeCount) continue;
    working = filled;
    changed = true;
    if (info) info.filled++;
  }
  if (info && skipSizes.length) info.skipSizes = skipSizes.join(',');
  return changed ? working : null;
}

/**
 * 긴 1-face 중간만 갈라, 겹친 짧은 안쪽 2-face와 지퍼한다. 꼭짓점은 PQ에 붙이지 않는다.
 */
export function zipOneSubsegment(mesh: MeshData): MeshData | null {
  return collectSubsegmentTrials(mesh, { stopAtFirst: true, limit: 120 })?.commit ?? null;
}

function collectSubsegmentTrials(
  mesh: MeshData,
  options: { stopAtFirst: boolean; limit: number },
): {
  leftoverOneFace: number;
  meanEdge: number;
  commit: MeshData | null;
  results: { reason: string; [k: string]: number | string }[];
} | null {
  const topology = buildTopology(mesh);
  if (topology.fillFrom.length === 0) return null;
  const incidence = new EdgeIncidence(mesh);
  const mean = incidence.meanLength;
  if (mean <= 0) return null;

  const leftover: { a: number; b: number; face: number }[] = [];
  const seenL = new Set<string>();
  for (let i = 0; i < topology.fillFrom.length; i++) {
    const a = topology.fillFrom[i];
    const b = topology.fillTo[i];
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (seenL.has(key)) continue;
    seenL.add(key);
    leftover.push({ a, b, face: topology.fillFace[i] });
  }

  const interiorMap = new Map<string, { p: number; q: number; faces: number[] }>();
  const { indices } = mesh;
  for (let t = 0; t < indices.length; t += 3) {
    const vs = [indices[t], indices[t + 1], indices[t + 2]];
    const face = t / 3;
    for (let k = 0; k < 3; k++) {
      const p = vs[k];
      const q = vs[(k + 1) % 3];
      if (incidence.count(p, q) !== 2) continue;
      const key = p < q ? `${p}:${q}` : `${q}:${p}`;
      const cur = interiorMap.get(key);
      if (cur) {
        if (!cur.faces.includes(face)) cur.faces.push(face);
      } else interiorMap.set(key, { p, q, faces: [face] });
    }
  }
  const interiors = [...interiorMap.values()];

  leftover.sort((x, y) => {
    const lx = length(sub(vertexAt(mesh.positions, x.b), vertexAt(mesh.positions, x.a)));
    const ly = length(sub(vertexAt(mesh.positions, y.b), vertexAt(mesh.positions, y.a)));
    return ly - lx;
  });

  const results: { reason: string; [k: string]: number | string }[] = [];
  let commit: MeshData | null = null;
  const limit = Math.min(leftover.length, options.limit);

  for (let i = 0; i < limit; i++) {
    const ab = leftover[i];
    const pa = vertexAt(mesh.positions, ab.a);
    const pb = vertexAt(mesh.positions, ab.b);
    const abLen = length(sub(pb, pa));
    if (abLen < mean * 0.5) {
      results.push({ reason: 'short', abLen: +(abLen / mean).toFixed(3) });
      continue;
    }
    const seedN = faceNormal(mesh, ab.face);
    let best: {
      p: number;
      q: number;
      faces: number[];
      t0: number;
      t1: number;
      dist: number;
      cover: number;
    } | null = null;
    let nearby = 0;
    let projOk = 0;
    for (const edge of interiors) {
      if (edge.p === ab.a || edge.p === ab.b || edge.q === ab.a || edge.q === ab.b) continue;
      const pp = vertexAt(mesh.positions, edge.p);
      const pq = vertexAt(mesh.positions, edge.q);
      const dist = segmentSegmentDist(pa, pb, pp, pq);
      if (dist > mean * SUB_DIST) continue;
      const nOk = edge.faces.some((f) => dot(faceNormal(mesh, f), seedN) >= OVERLAP_NORMAL);
      if (!nOk) continue;
      nearby++;
      const tp = projectSegT(pp, pa, pb);
      const tq = projectSegT(pq, pa, pb);
      const t0 = Math.min(tp.tClamp, tq.tClamp);
      const t1 = Math.max(tp.tClamp, tq.tClamp);
      const pInterior = tp.tClamp > SUB_TMIN && tp.tClamp < SUB_TMAX;
      const qInterior = tq.tClamp > SUB_TMIN && tq.tClamp < SUB_TMAX;
      const bothInterior = pInterior && qInterior;
      if (!bothInterior) continue;
      const cover = (t1 - t0) * abLen;
      const pqLen = length(sub(pq, pp));
      if (pqLen < 1e-12 || cover < pqLen * SUB_COVER) continue;
      if (pqLen > abLen * 0.95) continue;
      projOk++;
      const rank = dist + (bothInterior ? 0 : mean);
      const bestRank = best ? best.dist + (best.t0 > SUB_TMIN && best.t1 < SUB_TMAX ? 0 : mean) : Infinity;
      if (!best || rank < bestRank || (rank === bestRank && cover > best.cover)) {
        best = { p: edge.p, q: edge.q, faces: edge.faces, t0, t1, dist, cover };
      }
    }
    if (!best) {
      results.push({ reason: nearby === 0 ? 'nearby' : 'proj', nearby, interiorProj: projOk, abLen: +(abLen / mean).toFixed(3) });
      continue;
    }
    const trial = applySubsegmentZip(mesh, ab, best, seedN, mean);
    results.push({
      reason: trial.reason,
      nearby,
      interiorProj: 1,
      dist: +(best.dist / mean).toFixed(3),
      cover: +(best.cover / mean).toFixed(3),
      t0: +best.t0.toFixed(3),
      t1: +best.t1.toFixed(3),
      abLen: +(abLen / mean).toFixed(3),
      ...(trial.extra ?? {}),
    });
    if (trial.mesh && trial.reason === 'ok') {
      if (!commit) commit = trial.mesh;
      if (options.stopAtFirst) break;
    }
  }
  return { leftoverOneFace: topology.fillFrom.length, meanEdge: mean, commit, results };
}

function applySubsegmentZip(
  mesh: MeshData,
  ab: { a: number; b: number; face: number },
  hit: { p: number; q: number; faces: number[]; t0: number; t1: number; dist: number },
  seedN: Vec3,
  mean: number,
): { mesh: MeshData | null; reason: string; extra?: Record<string, number | string> } {
  const split = splitSegmentTwice(mesh, ab.a, ab.b, hit.t0, hit.t1);
  if (!split) return { mesh: null, reason: 'split' };
  const { mesh: splitMesh, left: aPrime, right: bPrime } = split;
  const leftoverMid = facesOfEdge(splitMesh, aPrime, bPrime);
  if (leftoverMid.length === 0) return { mesh: null, reason: 'split' };

  const pqFaces = facesOfEdge(splitMesh, hit.p, hit.q).filter((face) => {
    const vs = faceVerts(splitMesh, face);
    if (vs.includes(aPrime) || vs.includes(bPrime) || vs.includes(ab.a) || vs.includes(ab.b)) return false;
    return dot(faceNormal(splitMesh, face), seedN) >= OVERLAP_NORMAL;
  });
  const dropFace = pickCloserFace(splitMesh, pqFaces.length > 0 ? pqFaces : facesOfEdge(splitMesh, hit.p, hit.q), aPrime, bPrime);
  const earFaces = leftoverMid.length > 1
    ? leftoverMid
    : facesTouchingEdge(splitMesh, ab.a, aPrime).concat(facesTouchingEdge(splitMesh, bPrime, ab.b)).filter((f, i, arr) => arr.indexOf(f) === i);
  const leftoverLoose = layerDisconnected(mesh, growOpenFaceCluster(mesh, ab.face));

  const variants: MeshData[] = [];
  if (dropFace >= 0) {
    const deleted = deleteFaces(splitMesh, [dropFace]);
    const paired = pairSubsegmentRim(deleted, [aPrime, bPrime], [hit.p, hit.q], mean);
    if (paired) {
      let zipped = mergeVertexGroups(deleted, paired);
      zipped = dropLocalLeftoverFlaps(zipped, leftoverLoose);
      zipped = dropDisconnectedLeftover(zipped, earFaces, splitMesh);
      const collapsed = collapseOneShortUnmatched(zipped);
      variants.push(collapsed && isSafer(zipped, collapsed) ? collapsed : zipped);
    }
  }
  {
    const paired = pairSubsegmentRim(splitMesh, [aPrime, bPrime], [hit.p, hit.q], mean);
    if (paired) {
      const zipped = mergeVertexGroups(splitMesh, paired);
      const nm = buildTopology(zipped).nonManifoldEdgeCount;
      let cleaned = zipped;
      if (nm > buildTopology(mesh).nonManifoldEdgeCount) {
        const extra = facesOfEdge(zipped, Math.min(hit.p, aPrime), Math.min(hit.q, bPrime));
        const mid = extra.filter((face) => onesOnFace(zipped, face, new EdgeIncidence(zipped)) >= 1);
        if (mid.length > 0) cleaned = deleteFaces(zipped, mid.slice(0, 1));
        else if (leftoverMid.length > 0) {
          const mapped = leftoverMid.map((f) => f);
          cleaned = deleteFaces(zipped, mapped.slice(0, 1));
        }
      }
      cleaned = dropLocalLeftoverFlaps(cleaned, leftoverLoose);
      cleaned = dropDisconnectedLeftover(cleaned, earFaces, splitMesh);
      variants.push(cleaned);
    }
  }
  if (leftoverMid.length > 0 && dropFace >= 0) {
    const deleted = deleteFaces(splitMesh, [...leftoverMid.slice(0, 1), dropFace]);
    const paired = pairSubsegmentRim(deleted, [aPrime, bPrime], [hit.p, hit.q], mean);
    if (paired) variants.push(dropLocalLeftoverFlaps(mergeVertexGroups(deleted, paired), leftoverLoose));
  }

  let safest: MeshData | null = null;
  let after1 = 0;
  const before1 = buildTopology(mesh).boundaryEdgeCount;
  const beforeNm = buildTopology(mesh).nonManifoldEdgeCount;
  for (const next of variants) {
    if (!isSafer(mesh, next)) continue;
    const top = buildTopology(next);
    if (!safest || top.boundaryEdgeCount < after1) {
      safest = next;
      after1 = top.boundaryEdgeCount;
    }
  }
  if (safest) return { mesh: safest, reason: 'ok', extra: { after1, before1 } };
  if (variants.length === 0) return { mesh: null, reason: 'zip', extra: { before1, beforeNm } };
  const afters = variants.map((v) => buildTopology(v).boundaryEdgeCount);
  const nms = variants.map((v) => buildTopology(v).nonManifoldEdgeCount);
  return {
    mesh: null,
    reason: 'safer',
    extra: {
      before1,
      after1: Math.min(...afters),
      beforeNm,
      afterNm: Math.min(...nms),
      nVariants: variants.length,
      afters: afters.join(','),
      nms: nms.join(','),
    },
  };
}

function pairSubsegmentRim(mesh: MeshData, a: [number, number], b: [number, number], mean: number): number[][] | null {
  const pa = vertexAt(mesh.positions, a[0]);
  const pb = vertexAt(mesh.positions, a[1]);
  const p0 = vertexAt(mesh.positions, b[0]);
  const p1 = vertexAt(mesh.positions, b[1]);
  const d00 = dist2(pa, p0) + dist2(pb, p1);
  const d01 = dist2(pa, p1) + dist2(pb, p0);
  const pairs = d00 <= d01 ? [[a[0], b[0]], [a[1], b[1]]] : [[a[0], b[1]], [a[1], b[0]]];
  const cap = (mean * SUB_DIST * 1.5) ** 2;
  for (const [u, v] of pairs) {
    if (dist2(vertexAt(mesh.positions, u), vertexAt(mesh.positions, v)) > cap) return null;
  }
  return pairs;
}

function splitSegmentTwice(
  mesh: MeshData,
  a: number,
  b: number,
  t0: number,
  t1: number,
): { mesh: MeshData; left: number; right: number } | null {
  const lo = Math.min(t0, t1);
  const hi = Math.max(t0, t1);
  let working = mesh;
  let left = a;
  let right = b;
  if (lo > SUB_TMIN && lo < SUB_TMAX) {
    const one = splitEdgeAt(working, a, b, lo);
    if (!one) return null;
    working = one.mesh;
    left = one.newIndex;
  }
  if (hi > SUB_TMIN && hi < SUB_TMAX) {
    const tRel = left !== a ? (hi - lo) / Math.max(1e-9, 1 - lo) : hi;
    const one = splitEdgeAt(working, left, b, tRel);
    if (!one) return null;
    working = one.mesh;
    right = one.newIndex;
  }
  if (left === a && right === b) return null;
  if (facesOfEdge(working, left, right).length === 0) return null;
  return { mesh: working, left, right };
}

function splitEdgeAt(mesh: MeshData, u: number, v: number, t: number): { mesh: MeshData; newIndex: number } | null {
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
    if ((ia === u || ib === u || ic === u) && (ia === v || ib === v || ic === v)) faces.push(t0 / 3);
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
  return { mesh: { positions, indices: new Uint32Array(out) }, newIndex };
}

function facesOfEdge(mesh: MeshData, a: number, b: number): number[] {
  const out: number[] = [];
  for (let t = 0; t < mesh.indices.length; t += 3) {
    if (hasEdge(mesh.indices[t], mesh.indices[t + 1], mesh.indices[t + 2], a, b)) out.push(t / 3);
  }
  return out;
}

function facesTouchingEdge(mesh: MeshData, a: number, b: number): number[] {
  if (a === b) return [];
  return facesOfEdge(mesh, a, b);
}

function pickCloserFace(mesh: MeshData, faces: number[], a: number, b: number): number {
  if (faces.length === 0) return -1;
  const pa = vertexAt(mesh.positions, a);
  const pb = vertexAt(mesh.positions, b);
  let best = faces[0];
  let bestD = Infinity;
  for (const face of faces) {
    const c = faceCentroid(mesh, face);
    const d = pointSegDist(c, pa, pb);
    if (d < bestD) {
      bestD = d;
      best = face;
    }
  }
  return best;
}

function projectSegT(p: Vec3, a: Vec3, b: Vec3): { tClamp: number; dist: number } {
  const ab = sub(b, a);
  const denom = dot(ab, ab);
  const t = denom > 0 ? dot(sub(p, a), ab) / denom : 0;
  const tClamp = Math.max(0, Math.min(1, t));
  const q: Vec3 = [a[0] + ab[0] * tClamp, a[1] + ab[1] * tClamp, a[2] + ab[2] * tClamp];
  return { tClamp, dist: Math.sqrt(dist2(p, q)) };
}

function growOpenFaceCluster(mesh: MeshData, seed: number): number[] {
  const incidence = new EdgeIncidence(mesh);
  const out = [seed];
  const used = new Set<number>([seed]);
  let grew = true;
  while (grew) {
    grew = false;
    const verts = vertsOfFaces(mesh, out);
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const face = t / 3;
      if (used.has(face)) continue;
      const vs = faceVerts(mesh, face);
      if (!vs.some((v) => verts.has(v))) continue;
      if (onesOnFace(mesh, face, incidence) < 1) continue;
      used.add(face);
      out.push(face);
      grew = true;
    }
  }
  return out;
}

function dropLocalLeftoverFlaps(mesh: MeshData, disconnected: boolean): MeshData {
  let working = mesh;
  for (let iter = 0; iter < 8; iter++) {
    const incidence = new EdgeIncidence(working);
    const drop: number[] = [];
    for (let t = 0; t < working.indices.length; t += 3) {
      const face = t / 3;
      const ones = onesOnFace(working, face, incidence);
      if (ones >= 3) {
        drop.push(face);
        continue;
      }
      if (ones < 2) continue;
      if (disconnected) {
        drop.push(face);
        continue;
      }
      const vs = faceVerts(working, face);
      let hinge3 = false;
      for (let k = 0; k < 3; k++) {
        if (incidence.count(vs[k], vs[(k + 1) % 3]) >= 3) hinge3 = true;
      }
      if (hinge3) drop.push(face);
    }
    if (drop.length === 0) break;
    const next = deleteFaces(working, drop);
    if (buildTopology(next).nonManifoldEdgeCount > buildTopology(working).nonManifoldEdgeCount) break;
    working = next;
  }
  return working;
}

function dropDisconnectedLeftover(mesh: MeshData, candidateFaces: number[], beforeSplit: MeshData): MeshData {
  const drop: number[] = [];
  for (const face of candidateFaces) {
    if (face * 3 + 2 >= beforeSplit.indices.length) continue;
    const vs = faceVerts(beforeSplit, face);
    let used = false;
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const ia = mesh.indices[t];
      const ib = mesh.indices[t + 1];
      const ic = mesh.indices[t + 2];
      if (t / 3 === face) continue;
      if (vs.includes(ia) || vs.includes(ib) || vs.includes(ic)) {
        const shared = [ia, ib, ic].filter((v) => vs.includes(v)).length;
        if (shared >= 2) {
          used = true;
          break;
        }
      }
    }
    if (!used) drop.push(face);
  }
  return drop.length > 0 ? deleteFaces(mesh, drop) : mesh;
}

export function collapseOneShortUnmatched(mesh: MeshData): MeshData | null {
  const topology = buildTopology(mesh);
  if (topology.fillFrom.length === 0) return null;
  const incidence = new EdgeIncidence(mesh);
  const cap = incidence.meanLength * SHORT_RATIO;
  if (cap <= 0) return null;

  const candidates: { a: number; b: number; len: number }[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < topology.fillFrom.length; i++) {
    const a = topology.fillFrom[i];
    const b = topology.fillTo[i];
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const pa = vertexAt(mesh.positions, a);
    const pb = vertexAt(mesh.positions, b);
    const len = length(sub(pb, pa));
    if (len <= 0 || len > cap) continue;
    candidates.push({ a, b, len });
  }
  candidates.sort((x, y) => x.len - y.len);
  const limit = Math.min(candidates.length, 12);
  for (let k = 0; k < limit; k++) {
    const next = mergeVertexGroups(mesh, [[candidates[k].a, candidates[k].b]]);
    if (isSafer(mesh, next)) return next;
  }
  return null;
}

export function replaceOneOverlap(mesh: MeshData): MeshData | null {
  const topology = buildTopology(mesh);
  if (topology.fillFrom.length === 0) return null;
  const incidence = new EdgeIncidence(mesh);
  const cap = incidence.meanLength * OVERLAP_DIST;
  if (cap <= 0) return null;

  const interiors: { face: number; a: number; b: number; c: number; pa: Vec3; pb: Vec3; pc: Vec3; normal: Vec3 }[] = [];
  const { indices, positions } = mesh;
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
    interiors.push({ face: t / 3, a, b, c, pa, pb, pc, normal: normalize(n) });
  }
  if (interiors.length === 0) return null;

  const leftoverFaces = new Set<number>();
  for (let i = 0; i < topology.fillFace.length; i++) leftoverFaces.add(topology.fillFace[i]);

  let best: { leftover: number; interior: number; pairs: number[][]; d2: number } | null = null;
  for (const face of leftoverFaces) {
    const o = face * 3;
    const ia = indices[o];
    const ib = indices[o + 1];
    const ic = indices[o + 2];
    const pa = vertexAt(positions, ia);
    const pb = vertexAt(positions, ib);
    const pc = vertexAt(positions, ic);
    const centroid: Vec3 = [(pa[0] + pb[0] + pc[0]) / 3, (pa[1] + pb[1] + pc[1]) / 3, (pa[2] + pb[2] + pc[2]) / 3];
    const n = normalize(triangleNormalRaw(pa, pb, pc));
    const leftoverVerts: [number, Vec3][] = [
      [ia, pa],
      [ib, pb],
      [ic, pc],
    ];
    for (const tri of interiors) {
      if (tri.face === face) continue;
      if (tri.a === ia || tri.a === ib || tri.a === ic || tri.b === ia || tri.b === ib || tri.b === ic || tri.c === ia || tri.c === ib || tri.c === ic) {
        continue;
      }
      if (dot(n, tri.normal) < OVERLAP_NORMAL) continue;
      const hit = closestOnTriangle(centroid, tri.pa, tri.pb, tri.pc);
      if (hit.kind !== 'face' || hit.d2 > cap * cap) continue;
      const assign = assignVerts(leftoverVerts, [
        [tri.a, tri.pa],
        [tri.b, tri.pb],
        [tri.c, tri.pc],
      ]);
      if (!assign || assign.maxDist > cap) continue;
      if (!best || assign.d2 < best.d2) {
        best = { leftover: face, interior: tri.face, pairs: assign.pairs, d2: assign.d2 };
      }
    }
  }
  if (!best) return null;

  const kept: number[] = [];
  for (let t = 0; t < indices.length; t += 3) {
    if (t / 3 === best.interior) continue;
    kept.push(indices[t], indices[t + 1], indices[t + 2]);
  }
  const deleted: MeshData = { positions: mesh.positions, indices: new Uint32Array(kept) };
  const next = mergeVertexGroups(deleted, best.pairs);
  return isSafer(mesh, next) ? next : null;
}

function assignVerts(
  src: [number, Vec3][],
  dst: [number, Vec3][],
): { pairs: number[][]; d2: number; maxDist: number } | null {
  const perms = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
  ];
  let best: { pairs: number[][]; d2: number; maxDist: number } | null = null;
  for (const perm of perms) {
    let d2 = 0;
    let maxDist = 0;
    const pairs: number[][] = [];
    for (let i = 0; i < 3; i++) {
      const d = dist2(src[i][1], dst[perm[i]][1]);
      d2 += d;
      maxDist = Math.max(maxDist, Math.sqrt(d));
      if (src[i][0] !== dst[perm[i]][0]) pairs.push([src[i][0], dst[perm[i]][0]]);
    }
    if (!best || d2 < best.d2) best = { pairs, d2, maxDist };
  }
  return best;
}

function isSafer(before: MeshData, after: MeshData): boolean {
  if (!isSaferOneFace(before, after)) return false;
  if (maxLeftoverChain(after) > Math.max(3, maxLeftoverChain(before))) return false;
  return true;
}

function isSaferOneFace(before: MeshData, after: MeshData): boolean {
  const a = buildTopology(before);
  const b = buildTopology(after);
  if (b.boundaryEdgeCount >= a.boundaryEdgeCount) return false;
  if (b.nonManifoldEdgeCount > a.nonManifoldEdgeCount) return false;
  return true;
}

function maxLeftoverChain(mesh: MeshData): number {
  const topology = buildTopology(mesh);
  const adj = new Map<number, number[]>();
  const add = (a: number, b: number) => {
    const list = adj.get(a);
    if (list) {
      if (!list.includes(b)) list.push(b);
    } else adj.set(a, [b]);
  };
  const seenE = new Set<string>();
  for (let i = 0; i < topology.fillFrom.length; i++) {
    const a = topology.fillFrom[i];
    const b = topology.fillTo[i];
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (seenE.has(key)) continue;
    seenE.add(key);
    add(a, b);
    add(b, a);
  }
  let best = 0;
  const seen = new Set<number>();
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const stack = [start];
    let n = 0;
    seen.add(start);
    while (stack.length > 0) {
      const v = stack.pop()!;
      n++;
      for (const w of adj.get(v) ?? []) {
        if (seen.has(w)) continue;
        seen.add(w);
        stack.push(w);
      }
    }
    if (n > best) best = n;
  }
  return best;
}

function closestOnTriangle(
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
  const denom = va + vb + vc;
  const q: Vec3 = [a[0] + ab[0] * (vb / denom) + ac[0] * (vc / denom), a[1] + ab[1] * (vb / denom) + ac[1] * (vc / denom), a[2] + ab[2] * (vb / denom) + ac[2] * (vc / denom)];
  return { d2: dist2(p, q), kind: 'face' };
}

function dist2(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

export interface LeftoverSpatialStats {
  leftoverOneFace: number;
  isolatedTwoVert: number;
  meanEdge: number;
  tried: number;
  grabbedOtherLayer: number;
  twoLoops: number;
  zipFail: number;
  fillFail: number;
  saferFail: number;
  wouldCommit: number;
  samples: { reason: string; stencil: number; otherLayer: number; loops: number; [k: string]: number | string }[];
  zipReasons: Record<string, number>;
}

export function leftoverSpatialStats(mesh: MeshData): LeftoverSpatialStats {
  const empty: LeftoverSpatialStats = {
    leftoverOneFace: 0,
    isolatedTwoVert: 0,
    meanEdge: 0,
    tried: 0,
    grabbedOtherLayer: 0,
    twoLoops: 0,
    zipFail: 0,
    fillFail: 0,
    saferFail: 0,
    wouldCommit: 0,
    samples: [],
    zipReasons: {},
  };
  const trials = collectSpatialTrials(mesh, { stopAtFirst: false, limit: 40 });
  if (!trials) return empty;
  return {
    leftoverOneFace: trials.leftoverOneFace,
    isolatedTwoVert: trials.isolatedTwoVert,
    meanEdge: trials.meanEdge,
    tried: trials.results.length,
    grabbedOtherLayer: trials.results.filter((r) => Number(r.otherLayer) > 0).length,
    twoLoops: trials.results.filter((r) => Number(r.loops) >= 2).length,
    zipFail: trials.results.filter((r) => r.reason === 'zip').length,
    fillFail: trials.results.filter((r) => r.reason === 'fill').length,
    saferFail: trials.results.filter((r) => r.reason === 'safer').length,
    wouldCommit: trials.results.filter((r) => r.reason === 'ok').length,
    samples: trials.results.slice(0, 8),
    zipReasons: countZipReasons(trials.results),
  };
}

function countZipReasons(results: { reason: string; [k: string]: number | string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of results) {
    if (r.reason !== 'zip') continue;
    const key = String(r.zipFail ?? 'pair');
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

/**
 * 공유 에지가 없는 겹친 층을 거리로 한 스텐실에 넣고, 지운 뒤 생긴 루프를 지퍼한다.
 */
export function remeshOneSpatialCavity(mesh: MeshData): MeshData | null {
  const trials = collectSpatialTrials(mesh, { stopAtFirst: true, limit: 80 });
  return trials?.commit ?? null;
}

function collectSpatialTrials(
  mesh: MeshData,
  options: { stopAtFirst: boolean; limit: number },
): {
  leftoverOneFace: number;
  isolatedTwoVert: number;
  meanEdge: number;
  commit: MeshData | null;
  results: { reason: string; stencil: number; otherLayer: number; loops: number; [k: string]: number | string }[];
} | null {
  const topology = buildTopology(mesh);
  if (topology.fillFrom.length === 0) return null;
  const incidence = new EdgeIncidence(mesh);
  const mean = incidence.meanLength;
  if (mean <= 0) return null;

  const leftoverFaces = uniqueFaces(topology.fillFace);
  const valence = leftoverValence(topology, mesh.positions.length / 3);
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

  const results: { reason: string; stencil: number; otherLayer: number; loops: number; [k: string]: number | string }[] = [];
  let isolatedTwoVert = 0;
  for (const cand of candidates) if (cand.isolated) isolatedTwoVert++;
  let commit: MeshData | null = null;
  const limit = Math.min(candidates.length, options.limit);

  for (let k = 0; k < limit; k++) {
    const cand = candidates[k];
    const gathered = gatherSpatialStencil(mesh, cand.a, cand.b, cand.face, leftoverFaces, incidence, mean);
    if (!gathered || gathered.stencil.length < 2 || gathered.stencil.length > STENCIL_MAX) {
      results.push({ reason: 'stencil', stencil: gathered?.stencil.length ?? 0, otherLayer: gathered?.otherLayer.length ?? 0, loops: 0 });
      continue;
    }
    const leftoverVerts = vertsOfFaces(mesh, gathered.leftoverLayer);
    const otherVerts = vertsOfFaces(mesh, gathered.otherLayer);
    const hint = faceNormal(mesh, cand.face);
    let next: MeshData | null = null;
    let reason = 'loop';
    let afterLoops = 0;

    if (layerDisconnected(mesh, gathered.leftoverLayer)) {
      const dropped = deleteFaces(mesh, gathered.leftoverLayer);
      if (isSafer(mesh, dropped)) {
        next = dropped;
        reason = 'ok';
      }
    }

    if (!next) {
      const deleted = deleteFaces(mesh, gathered.stencil);
      if (isSafer(mesh, deleted)) {
        next = deleted;
        reason = 'ok';
      } else {
        const leftoverLoops = layerCutChains(mesh, deleted, gathered.leftoverLayer);
        const otherLoops = layerCutChains(mesh, deleted, gathered.otherLayer);
        afterLoops = leftoverLoops.length + otherLoops.length;
        if (leftoverLoops.length >= 1 && otherLoops.length >= 1) {
          const bridged = fillStitchedCuts(deleted, leftoverLoops, otherLoops, hint);
          if (bridged && isSafer(mesh, bridged)) {
            next = bridged;
            reason = 'ok';
          }
          const zipped = next ? null : zipLayerLoops(deleted, leftoverLoops, otherLoops, mean, hint, [cand.a, cand.b]);
          if (next) {
            // already committed a stitch
          } else if (!zipped || !zipped.mesh) {
            reason = next ? 'ok' : 'zip';
            if (!next) {
              results.push({
                reason,
                stencil: gathered.stencil.length,
                otherLayer: gathered.otherLayer.length,
                loops: afterLoops,
                leftoverLoops: leftoverLoops.length,
                otherLoops: otherLoops.length,
                leftoverLen: leftoverLoops[0]?.length ?? 0,
                otherLen: otherLoops[0]?.length ?? 0,
                zipFail: zipped?.fail ?? 'pair',
                otherDist: +(faceDistToSegs(mesh, gathered.otherLayer[0] ?? gathered.leftoverLayer[0], [[vertexAt(mesh.positions, cand.a), vertexAt(mesh.positions, cand.b)]]) / mean).toFixed(3),
              });
              continue;
            }
          } else if (isSafer(mesh, zipped.mesh)) {
            next = zipped.mesh;
            reason = 'ok';
          } else {
            const filled =
              fillAfterZip(zipped.mesh, leftoverLoops, otherLoops, zipped.pairs, hint) ??
              fillLayerLoops(zipped.mesh, leftoverVerts, otherVerts, hint);
            if (!filled) reason = 'fill';
            else if (!isSafer(mesh, filled)) {
              reason = 'safer';
              const after = buildTopology(filled);
              results.push({
                reason,
                stencil: gathered.stencil.length,
                otherLayer: gathered.otherLayer.length,
                loops: afterLoops,
                leftoverLoops: leftoverLoops.length,
                otherLoops: otherLoops.length,
                before1: topology.boundaryEdgeCount,
                after1: after.boundaryEdgeCount,
                beforeNm: topology.nonManifoldEdgeCount,
                afterNm: after.nonManifoldEdgeCount,
              });
              continue;
            } else {
              next = filled;
              reason = 'ok';
            }
          }
        } else if (afterLoops === 1) {
          const only = leftoverLoops[0] ?? otherLoops[0];
          if (only.length >= LOOP_MIN && only.length <= 12 && gathered.stencil.length <= 12) {
            const filled = fillLoop(deleted, only, hint);
            if (!filled) reason = 'fill';
            else if (!isSafer(mesh, filled)) {
              const after = buildTopology(filled);
              results.push({
                reason: 'safer',
                stencil: gathered.stencil.length,
                otherLayer: gathered.otherLayer.length,
                loops: 1,
                before1: topology.boundaryEdgeCount,
                after1: after.boundaryEdgeCount,
                beforeNm: topology.nonManifoldEdgeCount,
                afterNm: after.nonManifoldEdgeCount,
              });
              continue;
            } else {
              next = filled;
              reason = 'ok';
            }
          } else {
            reason = 'loop';
          }
        }
      }
    }

    results.push({
      reason,
      stencil: gathered.stencil.length,
      otherLayer: gathered.otherLayer.length,
      loops: afterLoops,
    });
    if (next && reason === 'ok') {
      if (!commit) commit = next;
      if (options.stopAtFirst) break;
    }
  }
  return {
    leftoverOneFace: topology.fillFrom.length,
    isolatedTwoVert,
    meanEdge: mean,
    commit,
    results,
  };
}

function gatherSpatialStencil(
  mesh: MeshData,
  a: number,
  b: number,
  seed: number,
  leftoverFaces: Set<number>,
  incidence: EdgeIncidence,
  mean: number,
): { leftoverLayer: number[]; otherLayer: number[]; stencil: number[] } | null {
  const pa = vertexAt(mesh.positions, a);
  const pb = vertexAt(mesh.positions, b);
  const leftoverLayer = growLeftoverLayer(mesh, seed, leftoverFaces, incidence, pa, pb, mean);
  const leftoverVerts = vertsOfFaces(mesh, leftoverLayer);
  const otherLayer = growOtherLayer(mesh, leftoverVerts, faceNormal(mesh, seed), pa, pb, mean, incidence);
  const stencil = [...leftoverLayer, ...otherLayer];
  if (stencil.length < 2) return null;
  return { leftoverLayer, otherLayer, stencil };
}

function growLeftoverLayer(
  mesh: MeshData,
  seed: number,
  leftoverFaces: Set<number>,
  incidence: EdgeIncidence,
  pa: Vec3,
  pb: Vec3,
  mean: number,
): number[] {
  const seedN = faceNormal(mesh, seed);
  const cap = mean * STENCIL_DIST;
  const out = [seed];
  const used = new Set<number>([seed]);
  let grew = true;
  while (grew && out.length < LAYER_CAP) {
    grew = false;
    const cluster = vertsOfFaces(mesh, out);
    for (const face of leftoverFaces) {
      if (used.has(face) || out.length >= LAYER_CAP) continue;
      const vs = faceVerts(mesh, face);
      if (!vs.some((v) => cluster.has(v))) continue;
      if (dot(faceNormal(mesh, face), seedN) < OVERLAP_NORMAL) continue;
      if (faceDistToSegs(mesh, face, leftoverProbeSegs(mesh, seed, pa, pb)) > cap) continue;
      if (onesOnFace(mesh, face, incidence) === 3 && face !== seed) continue;
      used.add(face);
      out.push(face);
      grew = true;
    }
  }
  return out;
}

function growOtherLayer(
  mesh: MeshData,
  leftoverVerts: Set<number>,
  seedN: Vec3,
  pa: Vec3,
  pb: Vec3,
  mean: number,
  incidence: EdgeIncidence,
): number[] {
  const cap = mean * STENCIL_DIST;
  const byEdge = new Map<string, { dist: number; faces: number[] }>();
  const { indices } = mesh;
  for (let t = 0; t < indices.length; t += 3) {
    const face = t / 3;
    const vs = faceVerts(mesh, face);
    if (vs.some((v) => leftoverVerts.has(v))) continue;
    if (dot(faceNormal(mesh, face), seedN) < OVERLAP_NORMAL) continue;
    for (let k = 0; k < 3; k++) {
      const a = vs[k];
      const b = vs[(k + 1) % 3];
      if (incidence.count(a, b) !== 2) continue;
      const qa = vertexAt(mesh.positions, a);
      const qb = vertexAt(mesh.positions, b);
      const dist = segmentSegmentDist(pa, pb, qa, qb);
      if (dist > cap) continue;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const cur = byEdge.get(key);
      if (cur) cur.faces.push(face);
      else byEdge.set(key, { dist, faces: [face] });
    }
  }
  let best: { dist: number; faces: number[] } | null = null;
  for (const hit of byEdge.values()) {
    if (!best || hit.dist < best.dist) best = hit;
  }
  return best ? best.faces.slice(0, OTHER_CAP) : [];
}

function leftoverProbeSegs(mesh: MeshData, seed: number, pa: Vec3, pb: Vec3): [Vec3, Vec3][] {
  return [[pa, pb], ...leftoverTriangleEdges(mesh, seed)];
}

function faceDistToSegs(mesh: MeshData, face: number, segs: [Vec3, Vec3][]): number {
  const [ia, ib, ic] = faceVerts(mesh, face);
  const qa = vertexAt(mesh.positions, ia);
  const qb = vertexAt(mesh.positions, ib);
  const qc = vertexAt(mesh.positions, ic);
  const centroid: Vec3 = [(qa[0] + qb[0] + qc[0]) / 3, (qa[1] + qb[1] + qc[1]) / 3, (qa[2] + qb[2] + qc[2]) / 3];
  let dist = Infinity;
  for (const [u, v] of segs) {
    dist = Math.min(dist, pointSegDist(centroid, u, v), pointSegDist(qa, u, v), pointSegDist(qb, u, v), pointSegDist(qc, u, v));
  }
  return dist;
}

function layerDisconnected(mesh: MeshData, layer: number[]): boolean {
  const verts = vertsOfFaces(mesh, layer);
  const drop = new Set(layer);
  for (let t = 0; t < mesh.indices.length; t += 3) {
    if (drop.has(t / 3)) continue;
    if (verts.has(mesh.indices[t]) || verts.has(mesh.indices[t + 1]) || verts.has(mesh.indices[t + 2])) return false;
  }
  return true;
}

function layerCutChains(original: MeshData, deleted: MeshData, layer: number[]): number[][] {
  if (layer.length === 0) return [];
  const after = new EdgeIncidence(deleted);
  const edges: [number, number][] = [];
  const seen = new Set<string>();
  for (const face of layer) {
    const [ia, ib, ic] = faceVerts(original, face);
    const vs: [number, number][] = [
      [ia, ib],
      [ib, ic],
      [ic, ia],
    ];
    for (const [a, b] of vs) {
      if (after.count(a, b) !== 1) continue;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push([a, b]);
    }
  }
  return stitchChains(edges);
}

function stitchChains(edges: [number, number][]): number[][] {
  if (edges.length === 0) return [];
  const adj = new Map<number, number[]>();
  const add = (u: number, v: number) => {
    const list = adj.get(u);
    if (list) {
      if (!list.includes(v)) list.push(v);
    } else adj.set(u, [v]);
  };
  for (const [a, b] of edges) {
    add(a, b);
    add(b, a);
  }
  const used = new Set<string>();
  const keyOf = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  const out: number[][] = [];
  const starts: number[] = [];
  for (const [v, ns] of adj) {
    if (ns.length === 1) starts.push(v);
  }
  const seeds = starts.length > 0 ? starts : [...adj.keys()];
  for (const seed of seeds) {
    for (const nb of adj.get(seed) ?? []) {
      if (used.has(keyOf(seed, nb))) continue;
      const chain = [seed];
      let cur = nb;
      used.add(keyOf(seed, cur));
      chain.push(cur);
      while (true) {
        const ns = (adj.get(cur) ?? []).filter((v) => !used.has(keyOf(cur, v)));
        if (ns.length === 0) break;
        const next = ns[0];
        used.add(keyOf(cur, next));
        if (next === seed) break;
        chain.push(next);
        cur = next;
        if (chain.length > LOOP_MAX) break;
      }
      if (chain.length >= 2 && chain.length <= LOOP_MAX) out.push(chain);
    }
  }
  return out;
}

function leftoverTriangleEdges(mesh: MeshData, face: number): [Vec3, Vec3][] {
  const [ia, ib, ic] = faceVerts(mesh, face);
  const a = vertexAt(mesh.positions, ia);
  const b = vertexAt(mesh.positions, ib);
  const c = vertexAt(mesh.positions, ic);
  return [
    [a, b],
    [b, c],
    [c, a],
  ];
}

function deleteFaces(mesh: MeshData, faces: number[]): MeshData {
  const drop = new Set(faces);
  const kept: number[] = [];
  for (let t = 0; t < mesh.indices.length; t += 3) {
    if (drop.has(t / 3)) continue;
    kept.push(mesh.indices[t], mesh.indices[t + 1], mesh.indices[t + 2]);
  }
  return { positions: mesh.positions, indices: new Uint32Array(kept) };
}

function vertsOfFaces(mesh: MeshData, faces: number[]): Set<number> {
  const out = new Set<number>();
  for (const face of faces) {
    const [a, b, c] = faceVerts(mesh, face);
    out.add(a);
    out.add(b);
    out.add(c);
  }
  return out;
}

function zipLayerLoops(
  mesh: MeshData,
  leftoverLoops: number[][],
  otherLoops: number[][],
  mean: number,
  hint: Vec3,
  rim: [number, number],
): { mesh: MeshData; pairs: number[][]; fail?: undefined } | { mesh: null; pairs?: undefined; fail: string } {
  let best: { pairs: number[][]; score: number } | null = null;
  let fail = 'pair';
  for (const a of leftoverLoops) {
    for (const b of otherLoops) {
      const match = matchLoops(mesh, a, b, mean, hint, rim);
      if ('fail' in match) {
        fail = match.fail;
        continue;
      }
      if (!best || match.score < best.score) best = match;
    }
  }
  if (!best || best.pairs.length === 0) return { mesh: null, fail };
  return { mesh: mergeVertexGroups(mesh, best.pairs), pairs: best.pairs };
}

function matchLoops(
  mesh: MeshData,
  a: number[],
  b: number[],
  mean: number,
  hint: Vec3,
  rim: [number, number],
): { pairs: number[][]; score: number } | { fail: string } {
  const pa = a.map((v) => vertexAt(mesh.positions, v));
  const pb = b.map((v) => vertexAt(mesh.positions, v));
  let nb = newellNormal(pb);
  let na = newellNormal(pa);
  if (length(na) < 1e-18) na = hint;
  else na = normalize(na);
  if (length(nb) < 1e-18) nb = hint;
  else nb = normalize(nb);
  let vertsB = b.slice();
  let ptsB = pb;
  if (dot(na, nb) < 0) {
    vertsB = b.slice().reverse();
    ptsB = vertsB.map((v) => vertexAt(mesh.positions, v));
    nb = scale(nb, -1);
  }
  if (Math.abs(dot(na, nb)) < 0.15 && a.length >= 4 && b.length >= 4) return { fail: 'orient' };
  const periA = loopPeri(pa);
  const periB = loopPeri(ptsB);
  if (Math.min(periA, periB) < 1e-12) return { fail: 'peri0' };
  const periRatio = Math.min(periA, periB) / Math.max(periA, periB);
  if (periRatio < 0.15 && Math.min(a.length, b.length) >= 4) return { fail: 'peri' };
  const rimVerts = [rim[0], rim[1]].filter((v) => a.includes(v) || b.includes(v));
  const rimPts = (rimVerts.length === 2 ? rimVerts : a.length <= 3 ? [a[0], a[a.length - 1]] : a).map((v) => vertexAt(mesh.positions, v));
  const oneSided = oneSidedLoopDistance(rimPts, ptsB);
  const edgeMin = minSegToLoop(rimPts[0] ?? pa[0], rimPts[1] ?? pa[pa.length - 1], ptsB);
  if (oneSided > mean * ZIP_DIST && edgeMin > mean * ZIP_DIST) return { fail: 'dist' };
  const rimPairs = pairRim(mesh, rim, vertsB, ptsB, mean * ZIP_DIST * 1.25);
  if (rimPairs.length >= 2) return { pairs: rimPairs, score: oneSided };
  const aligned = alignAndPair(a, vertsB, pa, ptsB);
  const maxPair = mean * ZIP_DIST * 1.25;
  const pairs = aligned.pairs.filter(([u, v]) => Math.sqrt(dist2(vertexAt(mesh.positions, u), vertexAt(mesh.positions, v))) <= maxPair);
  if (pairs.length < 2) return { fail: 'pairs' };
  return { pairs, score: aligned.score };
}

function pairRim(mesh: MeshData, rim: [number, number], other: number[], otherPts: Vec3[], cap: number): number[][] {
  const pairs: number[][] = [];
  const used = new Set<number>();
  for (const u of rim) {
    const pu = vertexAt(mesh.positions, u);
    let bj = -1;
    let bd = Infinity;
    for (let j = 0; j < other.length; j++) {
      if (used.has(j)) continue;
      const d = Math.sqrt(dist2(pu, otherPts[j]));
      if (d < bd) {
        bd = d;
        bj = j;
      }
    }
    if (bj < 0 || bd > cap) continue;
    used.add(bj);
    pairs.push([u, other[bj]]);
  }
  return pairs;
}

function loopPeri(pts: Vec3[]): number {
  let p = 0;
  for (let i = 0; i < pts.length; i++) p += length(sub(pts[(i + 1) % pts.length], pts[i]));
  return p;
}

function oneSidedLoopDistance(a: Vec3[], b: Vec3[]): number {
  if (a.length === 0) return Infinity;
  let s = 0;
  for (const p of a) s += minToLoop(p, b);
  return s / a.length;
}

function minSegToLoop(a: Vec3, b: Vec3, loop: Vec3[]): number {
  let best = Infinity;
  for (let i = 0; i < loop.length; i++) {
    best = Math.min(best, segmentSegmentDist(a, b, loop[i], loop[(i + 1) % loop.length]));
  }
  return best;
}

function segmentSegmentDist(a: Vec3, b: Vec3, c: Vec3, d: Vec3): number {
  const mid: Vec3 = [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5, (a[2] + b[2]) * 0.5];
  return Math.min(pointSegDist(a, c, d), pointSegDist(b, c, d), pointSegDist(c, a, b), pointSegDist(d, a, b), pointSegDist(mid, c, d));
}

function minToLoop(p: Vec3, loop: Vec3[]): number {
  let best = Infinity;
  for (let i = 0; i < loop.length; i++) {
    best = Math.min(best, pointSegDist(p, loop[i], loop[(i + 1) % loop.length]));
  }
  return best;
}

function alignAndPair(a: number[], b: number[], pa: Vec3[], pb: Vec3[]): { pairs: number[][]; score: number } {
  const nA = a.length;
  const nB = b.length;
  let bestPairs: number[][] = [];
  let bestScore = Infinity;
  for (let off = 0; off < nB; off++) {
    const pairs: number[][] = [];
    let score = 0;
    const used = new Uint8Array(nB);
    for (let i = 0; i < nA; i++) {
      const j = Math.round((i * nB) / nA + off) % nB;
      pairs.push([a[i], b[j]]);
      used[j] = 1;
      score += dist2(pa[i], pb[j]);
    }
    for (let j = 0; j < nB; j++) {
      if (used[j]) continue;
      let bi = 0;
      let bd = Infinity;
      for (let i = 0; i < nA; i++) {
        const d = dist2(pb[j], pa[i]);
        if (d < bd) {
          bd = d;
          bi = i;
        }
      }
      pairs.push([b[j], a[bi]]);
      score += bd;
    }
    if (score < bestScore) {
      bestScore = score;
      bestPairs = pairs;
    }
  }
  return { pairs: bestPairs, score: bestScore };
}

function fillStitchedCuts(mesh: MeshData, leftoverLoops: number[][], otherLoops: number[][], hint: Vec3): MeshData | null {
  let best: { left: number[]; right: number[]; score: number } | null = null;
  for (const left of leftoverLoops) {
    for (const right of otherLoops) {
      const aligned = alignCuts(mesh, left, right);
      if (!aligned) continue;
      if (!best || aligned.score < best.score) best = { left, right, score: aligned.score };
    }
  }
  if (!best) return null;
  const explicit = addBridgeTris(mesh, best.left, best.right);
  if (explicit) return explicit;
  const hole = alignCuts(mesh, best.left, best.right);
  return hole ? fillLoop(mesh, hole.hole, hint) : null;
}

function addBridgeTris(mesh: MeshData, left: number[], right: number[]): MeshData | null {
  const incidence = new EdgeIncidence(mesh);
  const tris: number[] = [];
  const tryAdd = (u: number, v: number, w: number) => {
    if (u === v || v === w || w === u) return;
    if (incidence.wouldCreateNonManifold(u, v, w)) return;
    if (incidence.count(u, v) > 0 && incidence.count(v, w) > 0 && incidence.count(w, u) > 0) {
      if (incidence.count(u, v) >= 2 || incidence.count(v, w) >= 2 || incidence.count(w, u) >= 2) return;
    }
    incidence.addTriangle(u, v, w);
    tris.push(u, v, w);
  };
  if (left.length === 3 && right.length >= 2) {
    const [b, c, a] = [left[0], left[1], left[left.length - 1]];
    tryAdd(a, c, right[0]);
    for (let i = 0; i < right.length - 1; i++) tryAdd(c, right[i], right[i + 1]);
    tryAdd(c, right[right.length - 1], b);
  } else if (left.length >= 2 && right.length >= 2) {
    const a = left[0];
    const b = left[left.length - 1];
    tryAdd(a, b, right[0]);
    for (let i = 0; i < right.length - 1; i++) tryAdd(a, right[i], right[i + 1]);
    if (right.length === 2) tryAdd(a, right[1], b);
  }
  if (tris.length < 3) return null;
  return { positions: mesh.positions, indices: concatIndices(mesh.indices, tris) };
}

function alignCuts(mesh: MeshData, left: number[], right: number[]): { hole: number[]; score: number } | null {
  if (left.length < 2 || right.length < 2) return null;
  const lp = left.map((v) => vertexAt(mesh.positions, v));
  const rp = right.map((v) => vertexAt(mesh.positions, v));
  let best: { hole: number[]; score: number } | null = null;
  for (const rev of [false, true]) {
    const verts = rev ? right.slice().reverse() : right.slice();
    const pts = rev ? rp.slice().reverse() : rp.slice();
    for (let off = 0; off < verts.length; off++) {
      const rot = verts.slice(off).concat(verts.slice(0, off));
      const rotP = pts.slice(off).concat(pts.slice(0, off));
      const score = dist2(lp[0], rotP[0]) + dist2(lp[lp.length - 1], rotP[rotP.length - 1]);
      const hole = [...left, ...rot.slice().reverse()];
      const uniq: number[] = [];
      for (const v of hole) {
        if (uniq.length === 0 || uniq[uniq.length - 1] !== v) uniq.push(v);
      }
      if (uniq.length > 1 && uniq[0] === uniq[uniq.length - 1]) uniq.pop();
      if (uniq.length < LOOP_MIN || uniq.length > 12) continue;
      if (!best || score < best.score) best = { hole: uniq, score };
    }
  }
  return best;
}

function fillAfterZip(
  mesh: MeshData,
  leftoverLoops: number[][],
  otherLoops: number[][],
  pairs: number[][],
  hint: Vec3,
): MeshData | null {
  const remap = new Map<number, number>();
  for (const [u, v] of pairs) {
    const dest = Math.min(u, v);
    remap.set(u, dest);
    remap.set(v, dest);
  }
  const apply = (loop: number[]) => {
    const out: number[] = [];
    for (const v of loop) {
      const w = remap.get(v) ?? v;
      if (out.length === 0 || out[out.length - 1] !== w) out.push(w);
    }
    if (out.length > 1 && out[0] === out[out.length - 1]) out.pop();
    return out;
  };
  let working = mesh;
  let changed = false;
  for (const left of leftoverLoops) {
    for (const right of otherLoops) {
      const hole = cycleFromCuts(apply(left), apply(right));
      if (!hole || hole.length < LOOP_MIN || hole.length > 12) continue;
      const filled = fillLoop(working, hole, hint);
      if (!filled) continue;
      working = filled;
      changed = true;
    }
  }
  return changed ? working : null;
}

function cycleFromCuts(left: number[], right: number[]): number[] | null {
  const shared = left.filter((v) => right.includes(v));
  if (shared.length >= 2) {
    const s0 = shared[0];
    const s1 = shared[shared.length - 1];
    if (s0 === s1) return null;
    const midL = left.filter((v) => v !== s0 && v !== s1);
    const midR = right.filter((v) => v !== s0 && v !== s1);
    const hole = [s0, ...midL, s1, ...midR];
    return hole.length >= LOOP_MIN ? hole : null;
  }
  const hole = [...left];
  for (const v of right) if (!hole.includes(v)) hole.push(v);
  return hole.length >= LOOP_MIN && hole.length <= 12 ? hole : null;
}

function fillLayerLoops(mesh: MeshData, leftoverVerts: Set<number>, otherVerts: Set<number>, hint: Vec3): MeshData | null {
  const topology = buildTopology(mesh);
  const loops = traceFillableLoops(topology, LOOP_MIN);
  let working = mesh;
  let changed = false;
  for (const loop of loops) {
    if (!loop.closed || loop.vertices.length < LOOP_MIN || loop.vertices.length > 12) continue;
    const touches = loop.vertices.some((v) => leftoverVerts.has(v) || otherVerts.has(v));
    if (!touches) continue;
    const filled = fillLoop(working, loop.vertices, hint);
    if (!filled) continue;
    working = filled;
    changed = true;
  }
  return changed ? working : null;
}

/**
 * 미매칭 1-face 주변의 작은 시트 스텐실을 지우고, 시트 쪽 외곽 루프만 기존 뚜껑으로 깐다.
 * 남는 1-face 변은 루프에 넣지 않아 패치가 그 변을 다시 만들지 않는다.
 */
export interface LeftoverCavityStats {
  leftoverOneFace: number;
  isolatedTwoVert: number;
  meanEdge: number;
  tried: number;
  stencilFail: number;
  loopFail: number;
  fillFail: number;
  saferFail: number;
  wouldCommit: number;
  medianInteriors: number;
  medianLoop: number;
  samples: { reason: string; interiors: number; loop: number; [k: string]: number | string }[];
}

export function leftoverCavityStats(mesh: MeshData): LeftoverCavityStats {
  const empty: LeftoverCavityStats = {
    leftoverOneFace: 0,
    isolatedTwoVert: 0,
    meanEdge: 0,
    tried: 0,
    stencilFail: 0,
    loopFail: 0,
    fillFail: 0,
    saferFail: 0,
    wouldCommit: 0,
    medianInteriors: 0,
    medianLoop: 0,
    samples: [],
  };
  const trials = collectCavityTrials(mesh, { stopAtFirst: false, limit: 40 });
  if (!trials) return empty;
  const interiors: number[] = [];
  const loops: number[] = [];
  for (const trial of trials.results) {
    if (trial.interiors > 0) interiors.push(trial.interiors);
    if (trial.loop > 0) loops.push(trial.loop);
  }
  interiors.sort((a, b) => a - b);
  loops.sort((a, b) => a - b);
  return {
    leftoverOneFace: trials.leftoverOneFace,
    isolatedTwoVert: trials.isolatedTwoVert,
    meanEdge: trials.meanEdge,
    tried: trials.results.length,
    stencilFail: trials.results.filter((r) => r.reason === 'stencil').length,
    loopFail: trials.results.filter((r) => r.reason === 'loop').length,
    fillFail: trials.results.filter((r) => r.reason === 'fill').length,
    saferFail: trials.results.filter((r) => r.reason === 'safer').length,
    wouldCommit: trials.results.filter((r) => r.reason === 'ok').length,
    medianInteriors: interiors.length ? interiors[Math.floor(interiors.length / 2)] : 0,
    medianLoop: loops.length ? loops[Math.floor(loops.length / 2)] : 0,
    samples: trials.results.slice(0, 8),
  };
}

export function remeshOneCavity(mesh: MeshData): MeshData | null {
  return remeshOneSpatialCavity(mesh) ?? collectCavityTrials(mesh, { stopAtFirst: true, limit: 80 })?.commit ?? null;
}

function collectCavityTrials(
  mesh: MeshData,
  options: { stopAtFirst: boolean; limit: number },
): {
  leftoverOneFace: number;
  isolatedTwoVert: number;
  meanEdge: number;
  commit: MeshData | null;
  results: { reason: string; interiors: number; loop: number; [k: string]: number | string }[];
} | null {
  const topology = buildTopology(mesh);
  if (topology.fillFrom.length === 0) return null;
  const incidence = new EdgeIncidence(mesh);
  const mean = incidence.meanLength;
  if (mean <= 0) return null;

  const leftoverFaces = uniqueFaces(topology.fillFace);
  const valence = leftoverValence(topology, mesh.positions.length / 3);
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

  const vertFaces = facesByVertex(mesh);
  const limit = Math.min(candidates.length, options.limit);
  const results: { reason: string; interiors: number; loop: number; [k: string]: number | string }[] = [];
  let isolatedTwoVert = 0;
  for (const cand of candidates) {
    if (cand.isolated) isolatedTwoVert++;
  }
  let commit: MeshData | null = null;
  for (let k = 0; k < limit; k++) {
    const cand = candidates[k];
    const gathered = gatherStencil(mesh, cand.a, cand.b, cand.face, leftoverFaces, vertFaces, incidence, mean);
    if (!gathered || gathered.interiors.length < 1 || gathered.stencil.length > STENCIL_MAX) {
      results.push({ reason: 'stencil', interiors: gathered?.interiors.length ?? 0, loop: 0 });
      continue;
    }
    let seedResult: { reason: string; interiors: number; loop: number; [k: string]: number | string } | null = null;
    for (let size = 1; size <= gathered.interiors.length; size++) {
      const interiors = gathered.interiors.slice(0, size);
      const stencil = [cand.face, ...interiors];
      const kept: number[] = [];
      const drop = new Set(stencil);
      for (let t = 0; t < mesh.indices.length; t += 3) {
        if (drop.has(t / 3)) continue;
        kept.push(mesh.indices[t], mesh.indices[t + 1], mesh.indices[t + 2]);
      }
      const deleted: MeshData = { positions: mesh.positions, indices: new Uint32Array(kept) };
      if (isSafer(mesh, deleted)) {
        seedResult = { reason: 'ok', interiors: interiors.length, loop: 0 };
        if (!commit) commit = deleted;
        break;
      }
      const loop = sheetBoundaryLoop(mesh, interiors);
      if (!loop || loop.length < LOOP_MIN || loop.length > LOOP_MAX) {
        seedResult = { reason: 'loop', interiors: interiors.length, loop: loop?.length ?? 0 };
        continue;
      }
      const filled = fillLoop(deleted, loop, faceNormal(mesh, interiors[0] ?? cand.face));
      if (!filled) {
        seedResult = { reason: 'fill', interiors: interiors.length, loop: loop.length };
        continue;
      }
      if (!isSafer(mesh, filled)) {
        const before = buildTopology(mesh);
        const after = buildTopology(filled);
        seedResult = {
          reason: 'safer',
          interiors: interiors.length,
          loop: loop.length,
          before1: before.boundaryEdgeCount,
          after1: after.boundaryEdgeCount,
          beforeNm: before.nonManifoldEdgeCount,
          afterNm: after.nonManifoldEdgeCount,
          beforeChain: maxLeftoverChain(mesh),
          afterChain: maxLeftoverChain(filled),
        };
        continue;
      }
      seedResult = { reason: 'ok', interiors: interiors.length, loop: loop.length };
      if (!commit) commit = filled;
      break;
    }
    results.push(seedResult ?? { reason: 'stencil', interiors: 0, loop: 0 });
    if (commit && options.stopAtFirst) break;
  }
  return {
    leftoverOneFace: topology.fillFrom.length,
    isolatedTwoVert,
    meanEdge: mean,
    commit,
    results,
  };
}

function leftoverValence(topology: { fillFrom: Uint32Array; fillTo: Uint32Array }, vertexCount: number): Uint8Array {
  const valence = new Uint8Array(vertexCount);
  for (let i = 0; i < topology.fillFrom.length; i++) {
    valence[topology.fillFrom[i]]++;
    valence[topology.fillTo[i]]++;
  }
  return valence;
}

function facesByVertex(mesh: MeshData): number[][] {
  const out: number[][] = Array.from({ length: mesh.positions.length / 3 }, () => []);
  const { indices } = mesh;
  for (let t = 0; t < indices.length; t += 3) {
    const face = t / 3;
    out[indices[t]].push(face);
    out[indices[t + 1]].push(face);
    out[indices[t + 2]].push(face);
  }
  return out;
}

function gatherStencil(
  mesh: MeshData,
  a: number,
  b: number,
  seed: number,
  leftoverFaces: Set<number>,
  vertFaces: number[][],
  incidence: EdgeIncidence,
  mean: number,
): { stencil: number[]; interiors: number[] } | null {
  const pa = vertexAt(mesh.positions, a);
  const pb = vertexAt(mesh.positions, b);
  const seedN = faceNormal(mesh, seed);
  const cap = mean * STENCIL_DIST;
  const { indices } = mesh;

  const candidates = new Set<number>([seed]);
  for (let t = 0; t < indices.length; t += 3) {
    const face = t / 3;
    if (face === seed) continue;
    const ia = indices[t];
    const ib = indices[t + 1];
    const ic = indices[t + 2];
    const qa = vertexAt(mesh.positions, ia);
    const qb = vertexAt(mesh.positions, ib);
    const qc = vertexAt(mesh.positions, ic);
    const n = normalize(triangleNormalRaw(qa, qb, qc));
    if (dot(n, seedN) < OVERLAP_NORMAL) continue;
    const centroid: Vec3 = [(qa[0] + qb[0] + qc[0]) / 3, (qa[1] + qb[1] + qc[1]) / 3, (qa[2] + qb[2] + qc[2]) / 3];
    const dist = Math.min(pointSegDist(centroid, pa, pb), pointSegDist(qa, pa, pb), pointSegDist(qb, pa, pb), pointSegDist(qc, pa, pb));
    if (dist > cap) continue;
    if (leftoverFaces.has(face) && onesOnFace(mesh, face, incidence) === 3) continue;
    candidates.add(face);
  }
  for (const v of faceVerts(mesh, seed)) {
    for (const face of vertFaces[v]) {
      if (candidates.has(face) || face === seed) continue;
      const n = faceNormal(mesh, face);
      if (dot(n, seedN) < OVERLAP_NORMAL) continue;
      const [ia, ib, ic] = faceVerts(mesh, face);
      const qa = vertexAt(mesh.positions, ia);
      const qb = vertexAt(mesh.positions, ib);
      const qc = vertexAt(mesh.positions, ic);
      const centroid: Vec3 = [(qa[0] + qb[0] + qc[0]) / 3, (qa[1] + qb[1] + qc[1]) / 3, (qa[2] + qb[2] + qc[2]) / 3];
      if (Math.min(pointSegDist(centroid, pa, pb), pointSegDist(qa, pa, pb), pointSegDist(qb, pa, pb), pointSegDist(qc, pa, pb)) > cap) {
        continue;
      }
      if (leftoverFaces.has(face) && onesOnFace(mesh, face, incidence) === 3) continue;
      candidates.add(face);
    }
  }

  const component = connectedFaces(mesh, seed, candidates, cap);
  if (component.length < 2 || component.length > STENCIL_MAX) return null;
  // 시드 1-face만 루프에서 빼고, 옆의 2+2+1은 시트 컷에 넣어 외곽이 한 고리가 되게 한다.
  const interiors = growEdgeDisk(mesh, seed, component);
  if (interiors.length < 1) return null;
  return { stencil: [...new Set([seed, ...interiors])], interiors };
}

function growEdgeDisk(mesh: MeshData, seed: number, component: number[]): number[] {
  const others = component.filter((face) => face !== seed);
  if (others.length === 0) return [];
  const wings = others.filter((face) => sharedEdgeCount(mesh, face, [seed]) === 1);
  const start = wings[0] ?? others[0];
  const working = [start];
  let grew = true;
  while (grew && working.length < STENCIL_MAX - 1) {
    grew = false;
    for (const face of others) {
      if (working.includes(face)) continue;
      if (sharedEdgeCount(mesh, face, working) !== 1) continue;
      working.push(face);
      grew = true;
      break;
    }
  }
  return working;
}

function sharedEdgeCount(mesh: MeshData, face: number, others: number[]): number {
  const vs = faceVerts(mesh, face);
  let n = 0;
  for (const other of others) {
    const ow = faceVerts(mesh, other);
    for (let i = 0; i < 3; i++) {
      if (hasEdge(ow[0], ow[1], ow[2], vs[i], vs[(i + 1) % 3])) n++;
    }
  }
  return n;
}

function connectedFaces(mesh: MeshData, seed: number, candidates: Set<number>, spatial: number): number[] {
  const adj = new Map<number, number[]>();
  const add = (u: number, v: number) => {
    const list = adj.get(u);
    if (list) {
      if (!list.includes(v)) list.push(v);
    } else adj.set(u, [v]);
  };
  const faces = [...candidates];
  const verts = faces.map((face) => new Set(faceVerts(mesh, face)));
  const cents = faces.map((face) => faceCentroid(mesh, face));
  for (let i = 0; i < faces.length; i++) {
    for (let j = i + 1; j < faces.length; j++) {
      let share = false;
      for (const v of verts[i]) {
        if (verts[j].has(v)) {
          share = true;
          break;
        }
      }
      if (!share && Math.sqrt(dist2(cents[i], cents[j])) > spatial) continue;
      add(faces[i], faces[j]);
      add(faces[j], faces[i]);
    }
  }
  const out: number[] = [];
  const seen = new Set<number>();
  const stack = [seed];
  seen.add(seed);
  while (stack.length > 0) {
    const face = stack.pop()!;
    out.push(face);
    for (const next of adj.get(face) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      stack.push(next);
    }
  }
  return out;
}

function sheetBoundaryLoop(mesh: MeshData, interiors: number[]): number[] | null {
  const { indices } = mesh;
  const stencil = new Set(interiors);
  const counts = new Map<string, { a: number; b: number; n: number }>();
  for (const face of interiors) {
    const o = face * 3;
    const vs = [indices[o], indices[o + 1], indices[o + 2]];
    for (let k = 0; k < 3; k++) {
      const a = vs[k];
      const b = vs[(k + 1) % 3];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const cur = counts.get(key);
      if (cur) cur.n++;
      else counts.set(key, { a, b, n: 1 });
    }
  }
  const adj = new Map<number, number[]>();
  const add = (u: number, v: number) => {
    const list = adj.get(u);
    if (list) list.push(v);
    else adj.set(u, [v]);
  };
  let edges = 0;
  for (const e of counts.values()) {
    if (e.n !== 1) continue;
    if (outsideFaceCount(mesh, e.a, e.b, stencil) < 1) continue;
    add(e.a, e.b);
    add(e.b, e.a);
    edges++;
  }
  if (edges < LOOP_MIN || adj.size < LOOP_MIN) return null;
  for (const ns of adj.values()) {
    if (ns.length !== 2) return null;
  }
  const start = adj.keys().next().value!;
  const loop = [start];
  let prev = -1;
  let cur = start;
  for (let i = 0; i < edges + 1; i++) {
    const ns = adj.get(cur) ?? [];
    const next = ns[0] === prev ? ns[1] : ns[0];
    if (next === undefined) return null;
    if (next === start) {
      return loop.length >= LOOP_MIN && loop.length <= LOOP_MAX && loop.length === edges ? loop : null;
    }
    if (loop.includes(next)) return null;
    loop.push(next);
    prev = cur;
    cur = next;
  }
  return null;
}

function outsideFaceCount(mesh: MeshData, a: number, b: number, stencil: Set<number>): number {
  const { indices } = mesh;
  let n = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const face = t / 3;
    if (stencil.has(face)) continue;
    const ia = indices[t];
    const ib = indices[t + 1];
    const ic = indices[t + 2];
    if (hasEdge(ia, ib, ic, a, b)) n++;
  }
  return n;
}

function hasEdge(ia: number, ib: number, ic: number, a: number, b: number): boolean {
  return (ia === a && ib === b) || (ib === a && ic === b) || (ic === a && ia === b) || (ia === b && ib === a) || (ib === b && ic === a) || (ic === b && ia === a);
}

function fillLoop(mesh: MeshData, loop: number[], hintNormal: Vec3, closed = true, strictManifold = false): MeshData | null {
  const points = loop.map((v) => vertexAt(mesh.positions, v));
  const raw = newellNormal(points);
  let capNormal = length(raw) > 1e-18 ? scale(normalize(raw), -1) : hintNormal;
  if (dot(capNormal, hintNormal) < 0) capNormal = scale(capNormal, -1);
  const centroid = centroidOf(points);
  let peri = 0;
  const last = closed ? points.length : points.length - 1;
  for (let i = 0; i < last; i++) peri += length(sub(points[(i + 1) % points.length], points[i]));
  const bounds = computeBounds(mesh.positions);
  const incidence = new EdgeIncidence(mesh);
  const metrics = {
    id: 0,
    vertices: loop,
    closed,
    perimeter: peri,
    area: 0,
    capNormal,
    centroid,
    planarity: 0.04,
    relativeSize: bounds.diagonal > 0 ? peri / bounds.diagonal : 0,
    bottomFacing: false,
    strategy: (loop.length <= 8 && closed ? 'planar' : 'front') as CapStrategy,
  };
  const outcome = applyCap({
    mesh,
    metrics,
    baseVertexCount: mesh.positions.length / 3,
    bounds,
    upIndex: 1,
    edgeExists: (u, v) => incidence.count(u, v) > 0,
    wouldCreateNonManifold: (u, v, w) => incidence.wouldCreateNonManifold(u, v, w),
    commitTriangle: (u, v, w) => incidence.addTriangle(u, v, w),
    edgeFaceCount: (u, v) => incidence.count(u, v),
          vertexMeanEdge: computeVertexMeanEdge(mesh),
    strictManifold,
  });
  if (outcome.triangles.length === 0) return null;
  const positions = outcome.newPositions.length === 0 ? mesh.positions : concatPositions(mesh.positions, outcome.newPositions);
  return { positions, indices: concatIndices(mesh.indices, outcome.triangles) };
}

function uniqueFaces(fillFace: Uint32Array): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < fillFace.length; i++) out.add(fillFace[i]);
  return out;
}

function onesOnFace(mesh: MeshData, face: number, incidence: EdgeIncidence): number {
  const [ia, ib, ic] = faceVerts(mesh, face);
  return [incidence.count(ia, ib), incidence.count(ib, ic), incidence.count(ic, ia)].filter((c) => c === 1).length;
}

function faceVerts(mesh: MeshData, face: number): [number, number, number] {
  const o = face * 3;
  return [mesh.indices[o], mesh.indices[o + 1], mesh.indices[o + 2]];
}

function faceCentroid(mesh: MeshData, face: number): Vec3 {
  const [ia, ib, ic] = faceVerts(mesh, face);
  const a = vertexAt(mesh.positions, ia);
  const b = vertexAt(mesh.positions, ib);
  const c = vertexAt(mesh.positions, ic);
  return [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
}

function faceNormal(mesh: MeshData, face: number): Vec3 {
  const [ia, ib, ic] = faceVerts(mesh, face);
  return normalize(triangleNormalRaw(vertexAt(mesh.positions, ia), vertexAt(mesh.positions, ib), vertexAt(mesh.positions, ic)));
}

function pointSegDist(p: Vec3, a: Vec3, b: Vec3): number {
  const ab = sub(b, a);
  const denom = dot(ab, ab);
  const t = denom > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / denom)) : 0;
  const q: Vec3 = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
  return Math.sqrt(dist2(p, q));
}

function concatPositions(base: Float32Array, extra: number[]): Float32Array {
  const out = new Float32Array(base.length + extra.length);
  out.set(base);
  out.set(extra, base.length);
  return out;
}

function concatIndices(base: Uint32Array, extra: number[]): Uint32Array {
  const out = new Uint32Array(base.length + extra.length);
  out.set(base);
  out.set(extra, base.length);
  return out;
}
