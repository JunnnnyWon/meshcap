import { weldVertices, type WeldOptions } from './weld.ts';
import { buildTopology } from './halfEdge.ts';
import { traceFillableLoops } from './boundary.ts';
import {
  classifyLoops,
  DEFAULT_CLASSIFY_OPTIONS,
  type CapStrategy,
  type ClassifyOptions,
  type LoopMetrics,
} from './classify.ts';
import { applyCap } from './cap/index.ts';
import { orientOutward } from './normals.ts';
import { validateMesh, type ValidationReport } from './validate.ts';
import { scorePrintability, type PrintabilityScore } from './score.ts';
import { computeBounds, type MeshData } from './types.ts';
import { normalize, triangleNormalRaw, vertexAt, type Vec3 } from './geom.ts';
import { computeVertexMeanEdge, EdgeIncidence } from './incidence.ts';
import { splitNonManifold } from './splitNonManifold.ts';
import { closeGaps } from './gapClose.ts';
import { canCollapse, collapseMicroHoles } from './collapse.ts';

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
        .filter((metric) => metric.strategy !== 'skip' && metric.strategy !== 'collapse');
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

      repairedMesh = {
        positions: concatFloat32(repairedMesh.positions, extraPositions),
        indices: concatUint32(repairedMesh.indices, extraTriangles),
      };
      capPasses++;

      passTopology = buildTopology(repairedMesh);
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
      // 더 줄지 않으면 같은 자리를 맴돌고 있는 것이므로 멈춘다.
      if (nextMetrics.length >= passMetrics.length) break;
      passMetrics = nextMetrics;
    }
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
