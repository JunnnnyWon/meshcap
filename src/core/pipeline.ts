import { weldVertices, type WeldOptions } from './weld.ts';
import { buildTopology } from './halfEdge.ts';
import { traceBoundaryLoops } from './boundary.ts';
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

export interface PipelineOptions extends ClassifyOptions {
  weld?: WeldOptions;
  /** 법선 재정렬을 건너뛴다. 대조 실험용이다. */
  skipOrient?: boolean;
  /** 구멍을 메우지 않고 진단만 한다. */
  diagnoseOnly?: boolean;
  selfIntersectionLimit?: number;
  /** 바닥 받침을 만들 때 최저점보다 더 내릴 거리, bbox 대각선 대비 비율. */
  flatBaseOffsetRatio?: number;
}

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
  weldSummary: {
    epsilon: number;
    mergedVertices: number;
    unreferencedVertices: number;
    removedDegenerateTriangles: number;
    removedInvalidTriangles: number;
    removedDuplicateTriangles: number;
  };
  orientSummary: {
    flippedTriangles: number;
    invertedShells: number;
    conflicts: number;
  };
  timings: PipelineTimings;
}

const AXIS_INDEX = { x: 0, y: 1, z: 2 } as const;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * 진단부터 보정까지 한 번에 실행한다.
 *
 * 순서 자체가 이 도구의 핵심이다. 용접을 먼저 하지 않으면 구멍이 오탐되고,
 * 법선 정렬을 구멍 메우기보다 먼저 하면 껍질별 부피 판정이 열린 면 때문에
 * 엉뚱한 답을 낸다.
 */
export function runPipeline(input: MeshData, options: PipelineOptions = {}): PipelineResult {
  const t0 = now();

  const raw = validateMesh(input, { selfIntersectionLimit: options.selfIntersectionLimit });

  const tWeld = now();
  const weld = weldVertices(input, options.weld);
  const weldedMesh = weld.mesh;
  const weldEnd = now();

  const welded = validateMesh(weldedMesh, { selfIntersectionLimit: options.selfIntersectionLimit });

  // 테두리를 추적하기 전에 감는 방향부터 통일한다. 뒤집힌 면이 구멍에 닿아 있으면
  // 그 지점에서 경계 진행 방향이 반전되어 테두리가 여러 조각으로 끊긴다.
  const tOrientFirst = now();
  const consistent = options.skipOrient
    ? { mesh: weldedMesh, flippedTriangles: 0, conflicts: 0, invertedShells: 0, volume: 0 }
    : orientOutward(weldedMesh, { alignOutward: false });
  const orientFirstEnd = now();
  const analysisMesh = consistent.mesh;

  const tAnalyze = now();
  const topology = buildTopology(analysisMesh);
  const loops = traceBoundaryLoops(topology);
  const bounds = computeBounds(analysisMesh.positions);
  const metrics = classifyLoops(analysisMesh, loops, options, bounds);
  const analyzeEnd = now();

  const upAxis = options.upAxis ?? DEFAULT_CLASSIFY_OPTIONS.upAxis;
  const upIndex = AXIS_INDEX[upAxis];

  const tCap = now();
  const capTriangleStart = analysisMesh.indices.length / 3;

  const extraPositions: number[] = [];
  const extraTriangles: number[] = [];
  const holes: HoleReport[] = [];

  if (!options.diagnoseOnly) {
    const boundaryFaceLookup = buildBoundaryFaceLookup(topology, analysisMesh.positions.length / 3);

    for (const metric of metrics) {
      const baseVertexCount = analysisMesh.positions.length / 3 + extraPositions.length / 3;
      const adjacentNormals = collectAdjacentNormals(analysisMesh, metric, boundaryFaceLookup);

      const outcome = applyCap({
        mesh: analysisMesh,
        metrics: metric,
        baseVertexCount,
        bounds,
        upIndex,
        adjacentNormals,
        flatBaseOffsetRatio: options.flatBaseOffsetRatio,
      });

      extraPositions.push(...outcome.newPositions);
      extraTriangles.push(...outcome.triangles);

      holes.push(toHoleReport(metric, outcome.appliedStrategy, outcome.fellBack, outcome));
    }
  } else {
    for (const metric of metrics) {
      holes.push(toHoleReport(metric, 'skip', false, { newPositions: [], triangles: [] }));
    }
  }
  const capEnd = now();

  let repairedMesh: MeshData = {
    positions: concatFloat32(analysisMesh.positions, extraPositions),
    indices: concatUint32(analysisMesh.indices, extraTriangles),
  };

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

  const tValidate = now();
  const repaired = validateMesh(repairedMesh, {
    capTriangleStart,
    selfIntersectionLimit: options.selfIntersectionLimit,
  });
  const validateEnd = now();

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
    weldSummary: {
      epsilon: weld.epsilon,
      mergedVertices: weld.mergedVertices,
      unreferencedVertices: weld.unreferencedVertices,
      removedDegenerateTriangles: weld.removedDegenerateTriangles,
      removedInvalidTriangles: weld.removedInvalidTriangles,
      removedDuplicateTriangles: weld.removedDuplicateTriangles,
    },
    orientSummary,
    timings: {
      weld: weldEnd - tWeld,
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

/** 방향 있는 경계 에지에서 그 에지에 접한 면을 찾을 수 있게 한다. */
function buildBoundaryFaceLookup(
  topology: ReturnType<typeof buildTopology>,
  vertexCount: number,
): Map<number, number> {
  const lookup = new Map<number, number>();
  for (let i = 0; i < topology.boundaryFrom.length; i++) {
    lookup.set(topology.boundaryFrom[i] * vertexCount + topology.boundaryTo[i], topology.boundaryFace[i]);
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
