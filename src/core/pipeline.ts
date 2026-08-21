import { weldVertices, type WeldOptions } from './weld.ts';
import { buildTopology } from './halfEdge.ts';
import { traceFillableLoops } from './boundary.ts';
import { listDrawnLeftoverEdges } from './leftoverSurgery.ts';
import {
  classifyLoops,
  DEFAULT_CLASSIFY_OPTIONS,
  type CapStrategy,
  type ClassifyOptions,
  type LoopMetrics,
} from './classify.ts';
import { applyCap } from './cap/index.ts';
import { wrapLoops, wrapBoundaryClusters, BROWSER_WRAP_RESOLUTION } from './cap/voxelWrap.ts';
import { bridgeLeftoverTears } from './bridge.ts';
import { orientOutward } from './normals.ts';
import { validateMesh, type ValidationReport } from './validate.ts';
import { scorePrintability, type PrintabilityScore } from './score.ts';
import { computeBounds, type MeshData } from './types.ts';
import { normalize, triangleNormalRaw, vertexAt, type Vec3 } from './geom.ts';
import { computeVertexMeanEdge, EdgeIncidence } from './incidence.ts';
import { splitNonManifold } from './splitNonManifold.ts';
import { closeGaps, zipLeftoverSlits } from './gapClose.ts';
import { canCollapse, collapseMicroHoles } from './collapse.ts';
import { attachToExistingSurface, dropOverlappingFlaps } from './surfaceSnap.ts';

export interface PipelineOptions extends ClassifyOptions {
  weld?: WeldOptions;
  /** 법선 재정렬을 건너뛴다. 대조 실험용이다. */
  skipOrient?: boolean;
  /** 구멍을 메우지 않고 진단만 한다. */
  diagnoseOnly?: boolean;
  selfIntersectionLimit?: number;
  /** 바닥 받침을 만들 때 최저점보다 더 내릴 거리, bbox 대각선 대비 비율. */
  flatBaseOffsetRatio?: number;
  /** 뚜껑을 붙이고 남은 틈을 다시 메우는 최대 반복 횟수. */
  maxCapPasses?: number;
  /**
   * true면 면이 둘인 대각선이 하나라도 있으면 패치 전체를 버린다.
   * 기본(시각 부착)은 문제 삼각형만 건너뛴다.
   */
  strictManifold?: boolean;
  /** 로컬 복셀 랩 격자 한 변. 브라우저 기본 96, 서버는 160. */
  wrapResolution?: number;
  /** 로컬 채움 뒤 남은 테두리 랩을 끈다. 절제 실험용. */
  disableWrap?: boolean;
}

const DEFAULT_MAX_CAP_PASSES = 4;

export interface HoleReport {
  id: number;
  vertexCount: number;
  closed: boolean;
  perimeter: number;
  area: number;
  planarity: number;
  relativeSize: number;
  bottomFacing: boolean;
  centroid: Vec3;
  capNormal: Vec3;
  plannedStrategy: CapStrategy;
  appliedStrategy: CapStrategy;
  fellBack: boolean;
  addedTriangles: number;
  addedVertices: number;
  /** 테두리 정점 인덱스. 뷰어에서 하이라이트할 때 쓴다. */
  loop: number[];
}

export interface PipelineTimings {
  weld: number;
  prepare: number;
  analyze: number;
  cap: number;
  orient: number;
  validate: number;
  total: number;
}

export interface PipelineResult {
  /** 손대지 않은 원본. 정점 분리 때문에 구멍이 크게 과대 계상된다. */
  raw: ValidationReport;
  /** 용접만 적용한 상태. 실제 결함을 재는 기준선이다. */
  welded: ValidationReport;
  /** 구멍을 메우고 법선까지 정렬한 최종 상태. */
  repaired: ValidationReport;
  weldedScore: PrintabilityScore;
  repairedScore: PrintabilityScore;
  /** 보정된 메시. */
  mesh: MeshData;
  /** 용접만 끝난 메시. Before/After 비교에 쓴다. */
  weldedMesh: MeshData;
  holes: HoleReport[];
  /** 보정 뒤에도 남은 1-face 에지. 루프가 안 되는 2정점 찢김 포함. */
  remainingFillEdges: number[][];
  /** 이 인덱스부터가 새로 만든 삼각형이다. */
  capTriangleStart: number;
  /** 구멍 메우기를 몇 번 반복했는지. 2 이상이면 뚜껑이 또 다른 틈을 남겼다는 뜻이다. */
  capPasses: number;
  weldSummary: {
    epsilon: number;
    mergedVertices: number;
    unreferencedVertices: number;
    removedDegenerateTriangles: number;
    removedInvalidTriangles: number;
    removedDuplicateTriangles: number;
  };
  repairSummary: {
    splitEdges: number;
    clonedVertices: number;
    gapMergedPairs: number;
    gapSnappedToEdge: number;
    collapsedHoles: number;
    bridgedTriangles: number;
    wrappedTriangles: number;
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
  };
  orientSummary: {
    flippedTriangles: number;
    invertedShells: number;
    conflicts: number;
  };
  timings: PipelineTimings;
}

export type PipelineStage =
  | 'diagnose'
  | 'weld'
  | 'orient'
  | 'prepare'
  | 'analyze'
  | 'cap'
  | 'finalize'
  | 'validate';

export const STAGE_LABEL: Record<PipelineStage, string> = {
  diagnose: '원본 상태를 재는 중',
  weld: '겹친 점을 합치는 중',
  orient: '면의 방향을 맞추는 중',
  prepare: '찢어진 자리와 틈을 맞추는 중',
  analyze: '구멍을 찾는 중',
  cap: '구멍을 메우는 중',
  finalize: '바깥 방향을 맞추는 중',
  validate: '점수를 매기는 중',
};

const AXIS_INDEX = { x: 0, y: 1, z: 2 } as const;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * 진단부터 보정까지 한 번에 실행한다.
 *
 * 순서 자체가 이 도구의 핵심이다. 용접을 먼저 하지 않으면 구멍이 오탐되고,
 * 법선 정렬을 구멍 메우기보다 먼저 하면 껍질별 부피 판정이 열린 면 때문에
 * 엉뚱한 답을 낸다.
 */
export function runPipeline(
  input: MeshData,
  options: PipelineOptions = {},
  onStage?: (stage: PipelineStage) => void,
): PipelineResult {
  const t0 = now();
  const stage = (name: PipelineStage) => onStage?.(name);

  stage('diagnose');
  const raw = validateMesh(input, { selfIntersectionLimit: options.selfIntersectionLimit });

  stage('weld');
  const tWeld = now();
  const weld = weldVertices(input, options.weld);
  const weldedMesh = weld.mesh;
  const weldEnd = now();

  const welded = validateMesh(weldedMesh, { selfIntersectionLimit: options.selfIntersectionLimit });

  // 테두리를 추적하기 전에 감는 방향부터 통일한다. 뒤집힌 면이 구멍에 닿아 있으면
  // 그 자리에서 경계 진행 방향이 반전되어 멀쩡한 표면이 구멍으로 보인다.
  stage('orient');
  const tOrientFirst = now();
  const consistent = options.skipOrient
    ? { mesh: weldedMesh, flippedTriangles: 0, conflicts: 0, invertedShells: 0, volume: 0 }
    : orientOutward(weldedMesh, { alignOutward: false });
  const orientFirstEnd = now();
  const analysisMesh = consistent.mesh;

  let repairedMesh = analysisMesh;
  const repairSummary = {
    splitEdges: 0,
    clonedVertices: 0,
    gapMergedPairs: 0,
    gapSnappedToEdge: 0,
    collapsedHoles: 0,
    bridgedTriangles: 0,
    wrappedTriangles: 0,
    collapsedSlits: 0,
    snappedToInterior: 0,
    deletedFlaps: 0,
    snappedTJunctions: 0,
    zippedCracks: 0,
    collapsedShort: 0,
    overlapReplaces: 0,
    cavityCommits: 0,
    spatialZipCommits: 0,
    subsegmentZipCommits: 0,
    polylineZipCommits: 0,
    sliverCutCommits: 0,
    insertCommits: 0,
    stripCommits: 0,
    stripMultiCommits: 0,
    stripFarCommits: 0,
    leftoverZipCommits: 0,
    sheetSplitCommits: 0,
    stripBowCommits: 0,
    chainRecapCommits: 0,
    stripBudgetHit: false,
  };

  stage('prepare');
  const tPrepare = now();
  if (!options.diagnoseOnly) {
    const split = splitNonManifold(repairedMesh);
    repairedMesh = split.mesh;
    repairSummary.splitEdges = split.splitEdges;
    repairSummary.clonedVertices = split.clonedVertices;

    const gap = closeGaps(repairedMesh);
    repairedMesh = gap.mesh;
    repairSummary.gapMergedPairs = gap.mergedPairs;
    repairSummary.gapSnappedToEdge = gap.snappedToEdge;

    const flaps = dropOverlappingFlaps(repairedMesh);
    repairedMesh = flaps.mesh;
    repairSummary.deletedFlaps = flaps.count;
  }
  const prepareEnd = now();

  stage('analyze');
  const tAnalyze = now();
  const bounds = computeBounds(repairedMesh.positions);
  let incidence = new EdgeIncidence(repairedMesh);
  let passTopology = buildTopology(repairedMesh);
  let passMetrics = classifyLoops(
    repairedMesh,
    traceFillableLoops(passTopology),
    options,
    bounds,
    incidence.meanLength,
  );
  downgradeInvalidCollapses(passMetrics, incidence);

  const holes: HoleReport[] = [];
  if (!options.diagnoseOnly) {
    const collapseTargets = passMetrics.filter((metric) => metric.strategy === 'collapse');
    if (collapseTargets.length > 0) {
      const collapsed = collapseMicroHoles(repairedMesh, collapseTargets, incidence);
      repairedMesh = collapsed.mesh;
      repairSummary.collapsedHoles = collapsed.collapsed;
      const collapsedSet = new Set(collapsed.ids);
      for (const metric of passMetrics) {
        if (!collapsedSet.has(metric.id)) continue;
        holes.push(toHoleReport(metric, 'collapse', false, { newPositions: [], triangles: [] }));
      }
      incidence = new EdgeIncidence(repairedMesh);
      passTopology = buildTopology(repairedMesh);
      passMetrics = classifyLoops(
        repairedMesh,
        traceFillableLoops(passTopology),
        options,
        bounds,
        incidence.meanLength,
      );
      downgradeInvalidCollapses(passMetrics, incidence);
    }
  }
  const analyzeEnd = now();

  const upAxis = options.upAxis ?? DEFAULT_CLASSIFY_OPTIONS.upAxis;
  const upIndex = AXIS_INDEX[upAxis];

  stage('cap');
  const tCap = now();
  const capTriangleStart = repairedMesh.indices.length / 3;
  let capPasses = 0;

  if (options.diagnoseOnly) {
    for (const metric of passMetrics) {
      holes.push(toHoleReport(metric, 'skip', false, { newPositions: [], triangles: [] }));
    }
  } else {
    /*
     * 뚜껑을 한 번 붙이는 것으로 끝나지 않는다. 새로 만든 면의 테두리가 기존 표면과
     * 완전히 맞물리지 않으면 그 자리에 다시 작은 틈이 남는데, 비다양체 지점 근처에서
     * 특히 자주 생긴다. 남은 틈이 없어지거나 더 줄지 않을 때까지 반복한다.
     */
    for (let pass = 0; pass < (options.maxCapPasses ?? DEFAULT_MAX_CAP_PASSES); pass++) {
      if (pass === 0) {
        for (const metric of passMetrics) {
          if (metric.strategy === 'skip') {
            holes.push(toHoleReport(metric, 'skip', false, { newPositions: [], triangles: [] }));
          }
        }
      }

      const fillable = passMetrics
        .map(fillStrategy)
        .filter((metric) => metric.strategy !== 'skip' && metric.strategy !== 'collapse')
        // 작은 1-face 사슬을 먼저 붙여, 큰 패치가 공유 에지를 선점하지 않게 한다.
        .sort((a, b) => a.vertices.length - b.vertices.length);
      if (fillable.length === 0) break;

      const extraPositions: number[] = [];
      const extraTriangles: number[] = [];
      const lookup = buildBoundaryFaceLookup(passTopology, repairedMesh.positions.length / 3);
      incidence = new EdgeIncidence(repairedMesh);
      const vertexMeanEdge = computeVertexMeanEdge(repairedMesh);
      const baseCount = repairedMesh.positions.length / 3;

      for (const metric of fillable) {
        const outcome = applyCap({
          mesh: repairedMesh,
          metrics: metric,
          baseVertexCount: baseCount + extraPositions.length / 3,
          bounds,
          upIndex,
          adjacentNormals: collectAdjacentNormals(repairedMesh, metric, lookup),
          flatBaseOffsetRatio: options.flatBaseOffsetRatio,
          edgeExists: (a, b) => incidence.count(a, b) > 0,
          wouldCreateNonManifold: (a, b, c) => incidence.wouldCreateNonManifold(a, b, c),
          commitTriangle: (a, b, c) => incidence.addTriangle(a, b, c),
          edgeFaceCount: (a, b) => incidence.count(a, b),
          vertexMeanEdge,
          strictManifold: options.strictManifold === true,
          wrapResolution: options.wrapResolution ?? BROWSER_WRAP_RESOLUTION,
        });

        appendAll(extraPositions, outcome.newPositions);
        appendAll(extraTriangles, outcome.triangles);

        // 사용자가 보는 구멍 목록은 첫 회차, 즉 모델이 원래 갖고 있던 구멍이다.
        // 이후 회차는 우리가 만든 뚜껑을 마무리하는 과정이라 목록에 넣지 않는다.
        if (pass === 0) {
          holes.push(toHoleReport(metric, outcome.appliedStrategy, outcome.fellBack, outcome));
        }
      }

      if (extraTriangles.length === 0) break;

      const trial: MeshData = {
        positions: concatFloat32(repairedMesh.positions, extraPositions),
        indices: concatUint32(repairedMesh.indices, extraTriangles),
      };
      const trialTopology = buildTopology(trial);
      // 구멍 개수가 아니라 보이는 1-face 테두리가 줄었는지로 회차를 판단한다.
      if (trialTopology.boundaryEdgeCount >= passTopology.boundaryEdgeCount) break;

      repairedMesh = trial;
      capPasses++;
      passTopology = trialTopology;
      if (passTopology.boundaryEdgeCount === 0) break;

      const nextIncidence = new EdgeIncidence(repairedMesh);
      const nextMetrics = classifyLoops(
        repairedMesh,
        traceFillableLoops(passTopology),
        options,
        bounds,
        nextIncidence.meanLength,
      );
      downgradeInvalidCollapses(nextMetrics, nextIncidence);
      passMetrics = nextMetrics;
    }

    const leftover = attachLeftoverTears(repairedMesh, bounds, options);
    repairedMesh = leftover.mesh;
    repairSummary.bridgedTriangles = leftover.bridgedTriangles;
    repairSummary.wrappedTriangles = leftover.wrappedTriangles;
    repairSummary.collapsedSlits = leftover.collapsedSlits;
    repairSummary.snappedToInterior = leftover.snappedToInterior;
    repairSummary.deletedFlaps += leftover.deletedFlaps;
    repairSummary.snappedTJunctions = leftover.snappedTJunctions;
    repairSummary.zippedCracks = leftover.zippedCracks;
    repairSummary.collapsedShort = leftover.collapsedShort;
    repairSummary.overlapReplaces = leftover.overlapReplaces;
    repairSummary.cavityCommits = leftover.cavityCommits;
    repairSummary.spatialZipCommits = leftover.spatialZipCommits;
    repairSummary.subsegmentZipCommits = leftover.subsegmentZipCommits;
    repairSummary.polylineZipCommits = leftover.polylineZipCommits;
    repairSummary.sliverCutCommits = leftover.sliverCutCommits;
    repairSummary.insertCommits = leftover.insertCommits;
    repairSummary.stripCommits = leftover.stripCommits;
    repairSummary.stripMultiCommits = leftover.stripMultiCommits;
    repairSummary.stripFarCommits = leftover.stripFarCommits;
    repairSummary.leftoverZipCommits = leftover.leftoverZipCommits;
    repairSummary.sheetSplitCommits = leftover.sheetSplitCommits;
    repairSummary.stripBowCommits = leftover.stripBowCommits;
    repairSummary.chainRecapCommits = leftover.chainRecapCommits;
    repairSummary.stripBudgetHit = leftover.stripBudgetHit;
    if (leftover.addedPasses > 0) capPasses += leftover.addedPasses;
    updateUnfilledHoles(holes, leftover.closedEverything, leftover.wrappedTriangles > 0);
  }
  const capEnd = now();

  stage('finalize');
  const tOrient = now();
  let orientSummary = {
    flippedTriangles: consistent.flippedTriangles,
    invertedShells: 0,
    conflicts: consistent.conflicts,
  };

  if (!options.skipOrient && !options.diagnoseOnly) {
    // 이제 메시가 닫혔으므로 껍질별 부피 부호로 안팎을 가릴 수 있다.
    const oriented = orientOutward(repairedMesh);
    repairedMesh = oriented.mesh;
    orientSummary = {
      flippedTriangles: consistent.flippedTriangles + oriented.flippedTriangles,
      invertedShells: oriented.invertedShells,
      conflicts: oriented.conflicts,
    };
  }
  const orientEnd = now();

  stage('validate');
  const tValidate = now();
  const repaired = validateMesh(repairedMesh, {
    capTriangleStart,
    selfIntersectionLimit: options.selfIntersectionLimit,
  });
  const validateEnd = now();

  for (let i = 0; i < holes.length; i++) holes[i].id = i;

  return {
    raw,
    welded,
    repaired,
    weldedScore: scorePrintability(welded),
    repairedScore: scorePrintability(repaired),
    mesh: repairedMesh,
    // 감는 방향을 통일한 쪽을 넘긴다. 형상은 그대로이고, 뒤집힌 면이 뷰어에서
    // 후면 컬링으로 사라져 구멍처럼 보이는 오해를 막을 수 있다.
    weldedMesh: analysisMesh,
    holes,
    remainingFillEdges: listDrawnLeftoverEdges(repairedMesh),
    capTriangleStart,
    capPasses,
    weldSummary: {
      epsilon: weld.epsilon,
      mergedVertices: weld.mergedVertices,
      unreferencedVertices: weld.unreferencedVertices,
      removedDegenerateTriangles: weld.removedDegenerateTriangles,
      removedInvalidTriangles: weld.removedInvalidTriangles,
      removedDuplicateTriangles: weld.removedDuplicateTriangles,
    },
    repairSummary,
    orientSummary,
    timings: {
      weld: weldEnd - tWeld,
      prepare: prepareEnd - tPrepare,
      analyze: analyzeEnd - tAnalyze,
      cap: capEnd - tCap,
      orient: orientFirstEnd - tOrientFirst + (orientEnd - tOrient),
      validate: validateEnd - tValidate,
      total: validateEnd - t0,
    },
  };
}

function attachLeftoverTears(
  mesh: MeshData,
  bounds: ReturnType<typeof computeBounds>,
  options: PipelineOptions,
): {
  mesh: MeshData;
  bridgedTriangles: number;
  wrappedTriangles: number;
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
  addedPasses: number;
  closedEverything: boolean;
} {
  let working = mesh;
  let bridgedTriangles = 0;
  let wrappedTriangles = 0;
  let addedPasses = 0;

  for (let cycle = 0; cycle < 3; cycle++) {
    const before = buildTopology(working).boundaryEdgeCount;
    if (before === 0) break;

    const zipped = zipLeftoverSlits(working);
    working = zipped.mesh;

    const topology = buildTopology(working);
    const incidence = new EdgeIncidence(working);
    const leftover = classifyLoops(
      working,
      traceFillableLoops(topology),
      options,
      bounds,
      incidence.meanLength,
    )
      .map(fillStrategy)
      .filter((metric) => metric.strategy !== 'skip' && metric.strategy !== 'collapse')
      .sort((a, b) => a.vertices.length - b.vertices.length);

    if (leftover.length > 0) {
      const extraPositions: number[] = [];
      const extraTriangles: number[] = [];
      const lookup = buildBoundaryFaceLookup(topology, working.positions.length / 3);
      const vertexMeanEdge = computeVertexMeanEdge(working);
      const baseCount = working.positions.length / 3;
      const upIndex = AXIS_INDEX[options.upAxis ?? DEFAULT_CLASSIFY_OPTIONS.upAxis];
      for (const metric of leftover) {
        const outcome = applyCap({
          mesh: working,
          metrics: metric,
          baseVertexCount: baseCount + extraPositions.length / 3,
          bounds,
          upIndex,
          adjacentNormals: collectAdjacentNormals(working, metric, lookup),
          flatBaseOffsetRatio: options.flatBaseOffsetRatio,
          edgeExists: (a, b) => incidence.count(a, b) > 0,
          wouldCreateNonManifold: (a, b, c) => incidence.wouldCreateNonManifold(a, b, c),
          commitTriangle: (a, b, c) => incidence.addTriangle(a, b, c),
          edgeFaceCount: (a, b) => incidence.count(a, b),
          vertexMeanEdge,
          strictManifold: options.strictManifold === true,
          wrapResolution: options.wrapResolution ?? BROWSER_WRAP_RESOLUTION,
        });
        appendAll(extraPositions, outcome.newPositions);
        appendAll(extraTriangles, outcome.triangles);
      }
      if (extraTriangles.length > 0) {
        const trial: MeshData = {
          positions: concatFloat32(working.positions, extraPositions),
          indices: concatUint32(working.indices, extraTriangles),
        };
        if (buildTopology(trial).boundaryEdgeCount < topology.boundaryEdgeCount) {
          working = trial;
          addedPasses++;
        }
      }
    }

    const bridged = bridgeLeftoverTears(working);
    working = bridged.mesh;
    bridgedTriangles += bridged.addedTriangles;
    if (bridged.addedTriangles > 0) addedPasses++;

    const after = buildTopology(working).boundaryEdgeCount;
    if (after >= before) break;
  }

  if (!options.disableWrap && buildTopology(working).boundaryEdgeCount > 0) {
    const clustered = wrapBoundaryClusters(
      working,
      options.wrapResolution ?? BROWSER_WRAP_RESOLUTION,
      options.strictManifold === true,
    );
    working = clustered.mesh;
    wrappedTriangles += clustered.addedTriangles;
    if (clustered.addedTriangles > 0) addedPasses++;

    const leftoverLoops = classifyLoops(
      working,
      traceFillableLoops(buildTopology(working)),
      options,
      bounds,
      new EdgeIncidence(working).meanLength,
    ).some((metric) => metric.vertices.length >= 12);
    if (leftoverLoops) {
      const loopWrap = applyLeftoverWrap(working, bounds, options);
      working = loopWrap.mesh;
      wrappedTriangles += loopWrap.addedTriangles;
      if (loopWrap.addedTriangles > 0) addedPasses++;
    }

    const afterWrap = bridgeLeftoverTears(working);
    working = afterWrap.mesh;
    bridgedTriangles += afterWrap.addedTriangles;
  }

  const surface = attachToExistingSurface(working);
  working = surface.mesh;
  wrappedTriangles += surface.wrappedTriangles;
  if (surface.collapsedSlits + surface.snappedToInterior + surface.deletedFlaps + surface.snappedTJunctions + surface.zippedCracks + surface.collapsedShort + surface.overlapReplaces + surface.cavityCommits + surface.spatialZipCommits + surface.subsegmentZipCommits + surface.polylineZipCommits + surface.sliverCutCommits + surface.insertCommits + surface.stripCommits + surface.leftoverZipCommits + surface.sheetSplitCommits + surface.stripBowCommits + surface.chainRecapCommits + surface.wrappedTriangles > 0) addedPasses++;

  return {
    mesh: working,
    bridgedTriangles,
    wrappedTriangles,
    collapsedSlits: surface.collapsedSlits,
    snappedToInterior: surface.snappedToInterior,
    deletedFlaps: surface.deletedFlaps,
    snappedTJunctions: surface.snappedTJunctions,
    zippedCracks: surface.zippedCracks,
    collapsedShort: surface.collapsedShort,
    overlapReplaces: surface.overlapReplaces,
    cavityCommits: surface.cavityCommits,
    spatialZipCommits: surface.spatialZipCommits,
    subsegmentZipCommits: surface.subsegmentZipCommits,
    polylineZipCommits: surface.polylineZipCommits,
    sliverCutCommits: surface.sliverCutCommits,
    insertCommits: surface.insertCommits,
    stripCommits: surface.stripCommits,
    stripMultiCommits: surface.stripMultiCommits,
    stripFarCommits: surface.stripFarCommits,
    leftoverZipCommits: surface.leftoverZipCommits,
    sheetSplitCommits: surface.sheetSplitCommits,
    stripBowCommits: surface.stripBowCommits,
    chainRecapCommits: surface.chainRecapCommits,
    stripBudgetHit: surface.stripBudgetHit,
    addedPasses,
    closedEverything: buildTopology(working).boundaryEdgeCount === 0,
  };
}

function applyLeftoverWrap(
  mesh: MeshData,
  bounds: ReturnType<typeof computeBounds>,
  options: PipelineOptions,
): { mesh: MeshData; addedTriangles: number; closedEverything: boolean } {
  const topology = buildTopology(mesh);
  if (topology.boundaryEdgeCount === 0) {
    return { mesh, addedTriangles: 0, closedEverything: true };
  }

  const incidence = new EdgeIncidence(mesh);
  const leftover = classifyLoops(
    mesh,
    traceFillableLoops(topology),
    options,
    bounds,
    incidence.meanLength,
  )
    .filter((metric) => metric.vertices.length >= 3 && metric.strategy !== 'collapse')
    .sort((a, b) => b.perimeter - a.perimeter)
    .slice(0, 80);

  if (leftover.length === 0) {
    return { mesh, addedTriangles: 0, closedEverything: topology.boundaryEdgeCount === 0 };
  }

  const wrapTargets = leftover.map((metric) => ({ ...metric, strategy: 'wrap' as const }));
  const targetOneFaceBefore = countOneFaceLoopEdges(wrapTargets, (a, b) => incidence.count(a, b));
  const patch = wrapLoops(
    mesh,
    wrapTargets,
    options.wrapResolution ?? BROWSER_WRAP_RESOLUTION,
    mesh.positions.length / 3,
    (a, b) => incidence.count(a, b),
    options.strictManifold === true ? (a, b, c) => incidence.wouldCreateNonManifold(a, b, c) : undefined,
    (a, b, c) => incidence.addTriangle(a, b, c),
  );

  if (patch.triangles.length === 0) {
    return { mesh, addedTriangles: 0, closedEverything: false };
  }

  const next: MeshData = {
    positions: concatFloat32(mesh.positions, patch.newPositions),
    indices: concatUint32(mesh.indices, patch.triangles),
  };
  const after = buildTopology(next);
  const afterIncidence = new EdgeIncidence(next);
  const targetOneFaceAfter = countOneFaceLoopEdges(wrapTargets, (a, b) => afterIncidence.count(a, b));
  // 면이 하나인 테두리가 줄면 받아들인다. 짝을 못 맞춘 half-edge 총량이
  // 늘어도(비다양체·방향 불일치) 보이는 찢김이 줄면 유지한다.
  const oneFaceReduced = after.boundaryEdgeCount < topology.boundaryEdgeCount;
  const targetReduced =
    targetOneFaceAfter < targetOneFaceBefore &&
    after.boundaryEdgeCount <= topology.boundaryEdgeCount + Math.max(8, targetOneFaceBefore - targetOneFaceAfter);
  if (!oneFaceReduced && !targetReduced) {
    return { mesh, addedTriangles: 0, closedEverything: false };
  }
  return {
    mesh: next,
    addedTriangles: patch.triangles.length / 3,
    closedEverything: after.boundaryEdgeCount === 0,
  };
}

function countOneFaceLoopEdges(
  loops: LoopMetrics[],
  faceCount: (a: number, b: number) => number,
): number {
  let n = 0;
  for (const loop of loops) {
    const v = loop.vertices;
    const last = loop.closed ? v.length : Math.max(0, v.length - 1);
    for (let i = 0; i < last; i++) {
      if (faceCount(v[i], v[(i + 1) % v.length]) === 1) n++;
    }
  }
  return n;
}

function updateUnfilledHoles(holes: HoleReport[], closedEverything: boolean, wrapped: boolean): void {
  if (!wrapped || !closedEverything) return;
  for (const hole of holes) {
    if (hole.addedTriangles > 0) continue;
    if (hole.appliedStrategy === 'collapse') continue;
    hole.appliedStrategy = 'wrap';
    hole.fellBack = hole.plannedStrategy !== 'wrap';
  }
}

function toHoleReport(
  metric: LoopMetrics,
  appliedStrategy: CapStrategy,
  fellBack: boolean,
  patch: { newPositions: number[]; triangles: number[] },
): HoleReport {
  return {
    id: metric.id,
    vertexCount: metric.vertices.length,
    closed: metric.closed,
    perimeter: metric.perimeter,
    area: metric.area,
    planarity: metric.planarity,
    relativeSize: metric.relativeSize,
    bottomFacing: metric.bottomFacing,
    centroid: metric.centroid,
    capNormal: metric.capNormal,
    plannedStrategy: metric.strategy,
    appliedStrategy,
    fellBack,
    addedTriangles: patch.triangles.length / 3,
    addedVertices: patch.newPositions.length / 3,
    loop: metric.vertices,
  };
}

function downgradeInvalidCollapses(metrics: LoopMetrics[], incidence: EdgeIncidence): void {
  for (const metric of metrics) {
    if (metric.strategy !== 'collapse') continue;
    if (canCollapse(metric, incidence)) continue;
    metric.strategy = metric.vertices.length === 3 ? 'single' : 'fan';
  }
}

function fillStrategy(metric: LoopMetrics): LoopMetrics {
  if (metric.strategy !== 'collapse') return metric;
  return {
    ...metric,
    strategy: metric.vertices.length === 3 ? 'single' : 'fan',
  };
}

/** 방향 있는 경계 에지에서 그 에지에 접한 면을 찾을 수 있게 한다. */
function buildBoundaryFaceLookup(
  topology: ReturnType<typeof buildTopology>,
  vertexCount: number,
): Map<number, number> {
  const lookup = new Map<number, number>();
  for (let i = 0; i < topology.fillFrom.length; i++) {
    lookup.set(topology.fillFrom[i] * vertexCount + topology.fillTo[i], topology.fillFace[i]);
  }
  return lookup;
}

/** 루프의 각 에지에 접한 기존 면의 바깥 방향 법선을 모은다. */
function collectAdjacentNormals(
  mesh: MeshData,
  metric: LoopMetrics,
  lookup: Map<number, number>,
): Vec3[] | undefined {
  const V = mesh.positions.length / 3;
  const loop = metric.vertices;
  const n = loop.length;
  const normals: Vec3[] = [];
  let found = 0;

  for (let i = 0; i < n; i++) {
    const from = loop[i];
    const to = loop[(i + 1) % n];
    const face = lookup.get(from * V + to);

    if (face === undefined) {
      normals.push([0, 0, 0]);
      continue;
    }

    const o = face * 3;
    const a = vertexAt(mesh.positions, mesh.indices[o]);
    const b = vertexAt(mesh.positions, mesh.indices[o + 1]);
    const c = vertexAt(mesh.positions, mesh.indices[o + 2]);
    normals.push(normalize(triangleNormalRaw(a, b, c)));
    found++;
  }

  return found > 0 ? normals : undefined;
}

/** push(...arr)는 인자 수가 많으면 스택을 넘기므로 직접 이어 붙인다. */
function appendAll(target: number[], source: number[]): void {
  for (let i = 0; i < source.length; i++) target.push(source[i]);
}

function concatFloat32(base: Float32Array, extra: number[]): Float32Array {
  if (extra.length === 0) return base;
  const out = new Float32Array(base.length + extra.length);
  out.set(base, 0);
  out.set(extra, base.length);
  return out;
}

function concatUint32(base: Uint32Array, extra: number[]): Uint32Array {
  if (extra.length === 0) return base;
  const out = new Uint32Array(base.length + extra.length);
  out.set(base, 0);
  out.set(extra, base.length);
  return out;
}
