import { weldExact, weldVertices, type WeldOptions } from './weld.ts';
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
import { listDefectEdges } from './defectEdges.ts';
import {
  buildSoup,
  computeWindingSlab,
  longestExtent,
  measureFidelity,
  planSolidGrid,
  solidify,
  solidifyWithField,
  TriangleBVH,
  type Fidelity,
  type SolidGrid,
  type SoupStats,
  type SolidStats,
} from './solid/index.ts';

/** 어떤 방식으로 고칠지. */
export type RepairEngine = 'auto' | 'solid' | 'patch';

export interface SolidEngineOptions {
  /** 가장 긴 축의 격자 칸 수. 기본 256. */
  resolution?: number;
  /** 두께 없는 면에 줄 두께의 절반, 격자 칸 단위. 기본 0.9. */
  finRadiusVoxels?: number;
  /** 전체 부피 대비 이보다 작은 떠 있는 조각은 버린다. 기본 0.001. */
  minShellVolumeRatio?: number;
  /** 속 빈 공간을 채운다. 기본 true. */
  fillVoids?: boolean;
}

export interface PipelineOptions extends ClassifyOptions {
  /** 기본 'auto'. 겹친 모서리나 관통이 있으면 솔리드화, 아니면 구멍 메우기부터 해 본다. */
  engine?: RepairEngine;
  solid?: SolidEngineOptions;
  /** 원본과 결과의 형상 차이를 잰다. 기본 true. */
  measureFidelity?: boolean;
  weld?: WeldOptions;
  /** 법선 재정렬을 건너뛴다. 대조 실험용이다. */
  skipOrient?: boolean;
  /** 구멍 메우기에서 구멍을 메우지 않고 진단만 한다. */
  diagnoseOnly?: boolean;
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
  /**
   * 구멍 메우기 단계의 벽시계 상한(ms). 넘으면 남은 선택적 정리(남은 테두리
   * 랩·표면 부착)를 생략하고 여기까지의 결과를 돌려준다. 병적인 입력에서
   * 이 정리가 혼자 수 분을 먹을 수 있어 상한이 없으면 요청이 죽는다.
   */
  capBudgetMs?: number;
  /**
   * 남은 1-면을 주변 표면에 붙이는 마지막 정리. 17만 삼각형 예제에서 혼자 2~4분을
   * 쓰면서 점수와 슬라이서 결과를 바꾸지 못해, 기본(auto)은 작은 모델에서만 켠다.
   */
  surfaceAttach?: boolean | 'auto';
}

const DEFAULT_MAX_CAP_PASSES = 4;
const DEFAULT_CAP_BUDGET_MS = 120_000;
/** surfaceAttach: 'auto'에서 표면 부착을 켜는 삼각형 수 상한. */
const SURFACE_ATTACH_AUTO_TRIANGLES = 60_000;

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
  /** 테두리 정점 인덱스(구멍 메우기 내부 메시 기준). */
  loop: number[];
}

export interface TimingPhase {
  id: string;
  label: string;
  ms: number;
}

export interface PipelineTimings {
  phases: TimingPhase[];
  total: number;
}

export interface InputSummary {
  /** 업로드한 삼각형 수. */
  inputTriangles: number;
  /** 좌표가 완전히 같아 합친 정점 수. */
  mergedVertices: number;
  /** 꼭짓점이 겹쳐 면적이 0인 삼각형 수. 점수에서 찌그러진 면으로 센다. */
  removedDegenerateTriangles: number;
  /** 잘못된 좌표를 쓴 삼각형 수. 점수에서 찌그러진 면으로 센다. */
  removedInvalidTriangles: number;
}

export interface PatchDetails {
  weldSummary: {
    epsilon: number;
    mergedVertices: number;
    unreferencedVertices: number;
    removedDegenerateTriangles: number;
    removedInvalidTriangles: number;
    removedDuplicateTriangles: number;
  };
  /** 허용오차 용접과 중복 면 제거까지 한 상태. 진단용이며 점수의 기준이 아니다. */
  welded: ValidationReport;
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
  /** 구멍 메우기를 몇 번 반복했는지. */
  capPasses: number;
  /** 표면 부착 단계를 실행했는지. */
  surfaceAttach: boolean;
}

export interface SolidDetails extends SolidStats {
  soup: SoupStats;
}

export interface PipelineResult {
  /** 실제로 쓴 방식. */
  engine: 'patch' | 'solid';
  requestedEngine: RepairEngine;
  /** 그 방식을 고른 이유. */
  engineReason: string;
  /** 자동 선택에서 함께 돌려 본 다른 방식의 점수. */
  alternative: { engine: 'patch' | 'solid'; score: number } | null;
  /** 업로드 그대로. 좌표가 완전히 같은 점만 합치고 면은 하나도 빼지 않았다. */
  input: ValidationReport;
  inputScore: PrintabilityScore;
  inputSummary: InputSummary;
  /** 보정 결과. */
  repaired: ValidationReport;
  repairedScore: PrintabilityScore;
  /** 보정된 메시. */
  mesh: MeshData;
  /** 보정 전 뷰어용 메시. 업로드 그대로에서 감는 방향만 맞췄다. */
  inputMesh: MeshData;
  /** 보정 전의 열린 모서리와 겹친 모서리. inputMesh 정점 기준 [a, b] 쌍. */
  beforeDefectEdges: Uint32Array;
  /** 보정 후에 남은 열린 모서리와 겹친 모서리. mesh 정점 기준 [a, b] 쌍. */
  afterDefectEdges: Uint32Array;
  /** mesh에서 이 인덱스부터가 새로 만든 면이다. */
  newTriangleStart: number;
  /** 구멍 메우기로 메운 자리. 솔리드화에서는 비어 있다. */
  holes: HoleReport[];
  patch: PatchDetails | null;
  solid: SolidDetails | null;
  /** 원본과 결과의 형상 차이. 점수에는 넣지 않는다. */
  fidelity: Fidelity | null;
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
  | 'soup'
  | 'field'
  | 'thicken'
  | 'fill'
  | 'march'
  | 'shells'
  | 'validate'
  | 'fidelity';

export const STAGE_LABEL: Record<PipelineStage, string> = {
  diagnose: '업로드한 상태를 재는 중',
  weld: '겹친 점을 합치는 중',
  orient: '면의 방향을 맞추는 중',
  prepare: '찢어진 자리와 틈을 맞추는 중',
  analyze: '구멍을 찾는 중',
  cap: '구멍을 메우는 중',
  finalize: '바깥 방향을 맞추는 중',
  soup: '겹친 면을 정리하는 중',
  field: '안과 밖을 가르는 중',
  thicken: '얇은 면에 두께를 주는 중',
  fill: '속 빈 곳을 채우는 중',
  march: '새 표면을 뽑는 중',
  shells: '떠 있는 조각을 정리하는 중',
  validate: '점수를 매기는 중',
  fidelity: '원본과 형상을 비교하는 중',
};

const AXIS_INDEX = { x: 0, y: 1, z: 2 } as const;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

interface MeasuredInput {
  asIs: ReturnType<typeof weldExact>;
  report: ValidationReport;
  score: PrintabilityScore;
  display: MeshData;
  defects: Uint32Array;
}

interface EngineRun {
  engine: 'patch' | 'solid';
  mesh: MeshData;
  newTriangleStart: number;
  holes: HoleReport[];
  patch: PatchDetails | null;
  solid: SolidDetails | null;
  report: ValidationReport;
  score: PrintabilityScore;
  /** 솔리드화가 만든 입력 BVH. 형상 비교에 다시 쓴다. */
  inputBvh: TriangleBVH | null;
}

interface Clock {
  /** fn을 실행하며 걸린 시간을 단계로 남긴다. */
  time<T>(id: string, label: string, fn: () => T): T;
  /** 따로 잰 시간을 단계로 남긴다. */
  add(id: string, label: string, ms: number): void;
}

/**
 * 업로드한 모델을 재고, 고치고, 같은 잣대로 다시 잰다.
 *
 * 보정 전 점수는 업로드한 파일 그대로를 잰다. 좌표가 비트 단위로 같은 점만 합치고
 * 면은 하나도 빼지 않는다. 허용오차 용접이나 중복 면 제거는 보정의 일부로 본다.
 * 관통 검사도 보정 전후 모두 메시 전체에 똑같이 한다.
 *
 * 고치는 방식은 둘이다. 구멍 메우기(patch)는 원본 삼각형을 지키고 구멍만 막는다.
 * 솔리드화(solid)는 와인딩 넘버로 안팎을 다시 정해 닫힌 표면을 새로 뽑는다.
 * 자동(auto)은 겹친 모서리나 관통이 있으면 솔리드화를, 없으면 구멍 메우기를 먼저
 * 해 보고 결과가 깨끗하지 않을 때만 솔리드화와 점수를 비교한다.
 */
export function runPipeline(
  input: MeshData,
  options: PipelineOptions = {},
  onStage?: (stage: PipelineStage) => void,
): PipelineResult {
  const steps = pipelineSteps(input, options, onStage);
  let next = steps.next();
  while (!next.done) next = steps.next(evaluateFieldHere(next.value));
  return next.value;
}

/** 솔리드화가 바깥에 맡기는 계산. 격자 z층을 나눠 여러 스레드에서 돌릴 수 있다. */
export interface FieldRequest {
  bvh: TriangleBVH;
  grid: SolidGrid;
}

/** FieldRequest를 받아 격자 전체의 f = |w| - 0.5를 돌려준다. 어디서 계산해도 값은 같아야 한다. */
export type FieldEvaluator = (request: FieldRequest) => Promise<Float32Array>;

/**
 * runPipeline과 같지만, 와인딩 넘버 격자를 evaluate에 맡긴다. 브라우저 워커와 연산 서버는
 * 여기에 여러 스레드로 나눠 계산하는 함수를 넘긴다. 격자점마다 독립이라 결과는 같다.
 */
export async function runPipelineAsync(
  input: MeshData,
  options: PipelineOptions = {},
  onStage?: (stage: PipelineStage) => void,
  evaluate?: FieldEvaluator,
): Promise<PipelineResult> {
  const steps = pipelineSteps(input, options, onStage);
  let next = steps.next();
  while (!next.done) {
    const field = evaluate ? await evaluate(next.value) : evaluateFieldHere(next.value);
    next = steps.next(field);
  }
  return next.value;
}

export function evaluateFieldHere(request: FieldRequest): Float32Array {
  const { grid } = request;
  const field = new Float32Array(grid.gx * grid.gy * grid.gz);
  computeWindingSlab(request.bvh, grid, 0, grid.gz, field, 0);
  return field;
}

function* pipelineSteps(
  input: MeshData,
  options: PipelineOptions,
  onStage?: (stage: PipelineStage) => void,
): Generator<FieldRequest, PipelineResult, Float32Array> {
  const t0 = now();
  const stage = (name: PipelineStage) => onStage?.(name);
  const phases: TimingPhase[] = [];
  const clock: Clock = {
    time(id, label, fn) {
      const start = now();
      const value = fn();
      phases.push({ id, label, ms: now() - start });
      return value;
    },
    add(id, label, ms) {
      phases.push({ id, label, ms });
    },
  };

  stage('diagnose');
  const before = clock.time('diagnose', '업로드 그대로 재기', () => measureInput(input));

  const requested = options.engine ?? 'auto';
  let chosen: EngineRun;
  let alternative: PipelineResult['alternative'] = null;
  let reason: string;

  const runPatch = () => runPatchEngine(input, options, stage, clock);
  const runSolid = () => runSolidEngine(before.asIs.mesh, options, stage, clock);

  if (requested === 'patch') {
    chosen = runPatch();
    reason = '구멍 메우기를 직접 골랐습니다.';
  } else if (requested === 'solid') {
    chosen = yield* runSolid();
    reason = '솔리드화를 직접 골랐습니다.';
  } else {
    const r = before.report;
    const tangled = r.nonManifoldEdgeCount > 0 || !r.selfIntersectionChecked || r.selfIntersections > 0;
    if (!tangled) {
      const patch = runPatch();
      if (isClean(patch.report)) {
        chosen = patch;
        reason = '겹친 모서리와 관통이 없어 원본 삼각형을 지키는 구멍 메우기로 끝냈습니다.';
      } else {
        const solid = yield* runSolid();
        if (solid.score.total > patch.score.total) {
          chosen = solid;
          alternative = { engine: 'patch', score: patch.score.total };
          reason = `구멍 메우기(${patch.score.total}점)가 모두 닫지 못해 솔리드화(${solid.score.total}점)를 골랐습니다.`;
        } else {
          chosen = patch;
          alternative = { engine: 'solid', score: solid.score.total };
          reason = `솔리드화(${solid.score.total}점)가 구멍 메우기(${patch.score.total}점)보다 낫지 않아 원본 삼각형을 지켰습니다.`;
        }
      }
    } else {
      chosen = yield* runSolid();
      const parts: string[] = [];
      if (r.nonManifoldEdgeCount > 0) parts.push(`겹친 모서리 ${r.nonManifoldEdgeCount.toLocaleString('ko-KR')}개`);
      if (r.selfIntersections > 0) parts.push(`서로 뚫고 지나가는 면 ${r.selfIntersections.toLocaleString('ko-KR')}쌍${r.selfIntersectionCapped ? ' 이상' : ''}`);
      if (!r.selfIntersectionChecked) parts.push('관통 여부를 끝까지 확인할 수 없는 면');
      reason = `${parts.join(', ')}이 있어 솔리드화로 처리했습니다. 구멍만 메워서는 풀리지 않는 결함입니다.`;
    }
  }

  let fidelity: Fidelity | null = null;
  if (options.measureFidelity ?? true) {
    stage('fidelity');
    fidelity = clock.time('fidelity', '원본과 형상 비교', () => {
      const bvh = chosen.inputBvh ?? inputBvhOf(before.asIs.mesh);
      return measureFidelity(bvh, chosen.mesh, longestExtent(bvh.coords));
    });
  }

  const afterDefectEdges = clock.time('defects', '남은 결함 모서리 찾기', () => listDefectEdges(chosen.mesh));
  for (let i = 0; i < chosen.holes.length; i++) chosen.holes[i].id = i;

  return {
    engine: chosen.engine,
    requestedEngine: requested,
    engineReason: reason,
    alternative,
    input: before.report,
    inputScore: before.score,
    inputSummary: {
      inputTriangles: before.asIs.inputTriangles,
      mergedVertices: before.asIs.mergedVertices,
      removedDegenerateTriangles: before.asIs.removedDegenerateTriangles,
      removedInvalidTriangles: before.asIs.removedInvalidTriangles,
    },
    repaired: chosen.report,
    repairedScore: chosen.score,
    mesh: chosen.mesh,
    inputMesh: before.display,
    beforeDefectEdges: before.defects,
    afterDefectEdges,
    newTriangleStart: chosen.newTriangleStart,
    holes: chosen.holes,
    patch: chosen.patch,
    solid: chosen.solid,
    fidelity,
    timings: { phases, total: now() - t0 },
  };
}

/** 자동 선택에서 더 볼 것 없이 받아들여도 되는 상태인지. */
export function isClean(report: ValidationReport): boolean {
  return (
    report.watertight &&
    report.nonManifoldEdgeCount === 0 &&
    report.inconsistentEdgeCount === 0 &&
    report.selfIntersectionChecked &&
    report.selfIntersections === 0
  );
}

/** 업로드 그대로를 잰다. 뷰어용으로는 감는 방향만 맞춘 사본을 따로 만든다. */
export function measureInput(input: MeshData): MeasuredInput {
  const asIs = weldExact(input);
  const report = validateMesh(asIs.mesh, {
    extraDegenerateTriangles: asIs.removedDegenerateTriangles + asIs.removedInvalidTriangles,
  });
  return {
    asIs,
    report,
    score: scorePrintability(report),
    // 형상은 그대로다. 뒤집힌 면이 후면 컬링으로 사라져 구멍처럼 보이는 것만 막는다.
    display: orientOutward(asIs.mesh, { alignOutward: false }).mesh,
    defects: listDefectEdges(asIs.mesh),
  };
}

function inputBvhOf(asIs: MeshData): TriangleBVH {
  return new TriangleBVH(buildSoup(orientOutward(asIs).mesh).soup);
}

function* runSolidEngine(
  asIs: MeshData,
  options: PipelineOptions,
  stage: (name: PipelineStage) => void,
  clock: Clock,
): Generator<FieldRequest, EngineRun, Float32Array> {
  stage('soup');
  const { stats: soupStats, bvh } = clock.time('soup', '방향 맞추고 겹친 면 정리', () => {
    // 껍질마다 바깥을 보게 맞춰야, 겹친 덩어리의 와인딩 넘버가 서로 상쇄되지 않는다.
    const oriented = orientOutward(asIs).mesh;
    const built = buildSoup(oriented);
    return { ...built, bvh: new TriangleBVH(built.soup) };
  });
  const solidOptions = { ...options.solid, onPhase: (phase: PipelineStage) => stage(phase) };
  const grid = planSolidGrid(bvh.coords, bvh.count, solidOptions);
  let solid: ReturnType<typeof solidify>;
  if (!grid) {
    solid = solidify(bvh, solidOptions);
  } else {
    stage('field');
    const tField = now();
    // 가장 무거운 단계라 바깥(여러 스레드)에 맡길 수 있게 여기서 멈춘다.
    const field: Float32Array = yield { bvh, grid };
    const fieldMs = now() - tField;
    solid = solidifyWithField(bvh, grid, field, solidOptions);
    solid.timings.field = fieldMs;
  }
  clock.add('solid-field', '안팎 가르기 (와인딩 넘버)', solid.timings.field);
  clock.add('solid-thicken', '얇은 면 두께 주기', solid.timings.thicken);
  clock.add('solid-fill', '속 빈 곳 채우기', solid.timings.fill);
  clock.add('solid-march', '새 표면 뽑기', solid.timings.march);
  clock.add('solid-shells', '떠 있는 조각 정리', solid.timings.shells);
  stage('validate');
  const report = clock.time('validate', '점수 매기기', () => validateMesh(solid.mesh));
  return {
    engine: 'solid',
    mesh: solid.mesh,
    newTriangleStart: solid.newTriangleStart,
    holes: [],
    patch: null,
    solid: { ...solid.stats, soup: soupStats },
    report,
    score: scorePrintability(report),
    inputBvh: bvh,
  };
}

/**
 * 구멍 메우기. 원본 삼각형을 지키고, 찾은 구멍을 모양에 맞는 방법으로 막는다.
 *
 * 순서 자체가 핵심이다. 용접을 먼저 하지 않으면 구멍이 오탐되고, 법선 정렬을 구멍
 * 메우기보다 먼저 하면 껍질별 부피 판정이 열린 면 때문에 엉뚱한 답을 낸다.
 */
function runPatchEngine(
  input: MeshData,
  options: PipelineOptions,
  stage: (name: PipelineStage) => void,
  clock: Clock,
): EngineRun {
  const surfaceAttach =
    options.surfaceAttach === true ||
    ((options.surfaceAttach ?? 'auto') === 'auto' && input.indices.length / 3 <= SURFACE_ATTACH_AUTO_TRIANGLES);

  stage('weld');
  const tWeld = now();
  const weld = weldVertices(input, options.weld);
  const weldedMesh = weld.mesh;
  const weldEnd = now();
  clock.add('patch-weld', '점 합치기와 중복 면 제거', weldEnd - tWeld);

  const welded = validateMesh(weldedMesh, { intersections: 'none' });

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
  const capDeadline = tCap + (options.capBudgetMs ?? DEFAULT_CAP_BUDGET_MS);
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
      if (now() >= capDeadline) break;
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
        if (now() >= capDeadline) break;
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

    const leftover = attachLeftoverTears(
      repairedMesh,
      bounds,
      options,
      Math.max(0, capDeadline - now()),
      surfaceAttach,
    );
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

  clock.add('patch-prepare', '찢어진 자리와 틈 맞추기', prepareEnd - tPrepare);
  clock.add('patch-analyze', '구멍 찾기', analyzeEnd - tAnalyze);
  clock.add('patch-cap', '구멍 메우기', capEnd - tCap);
  clock.add('patch-orient', '면 방향 맞추기', orientFirstEnd - tOrientFirst + (orientEnd - tOrient));

  stage('validate');
  const report = clock.time('validate', '점수 매기기', () => validateMesh(repairedMesh));

  return {
    engine: 'patch',
    mesh: repairedMesh,
    newTriangleStart: capTriangleStart,
    holes,
    patch: {
      weldSummary: {
        epsilon: weld.epsilon,
        mergedVertices: weld.mergedVertices,
        unreferencedVertices: weld.unreferencedVertices,
        removedDegenerateTriangles: weld.removedDegenerateTriangles,
        removedInvalidTriangles: weld.removedInvalidTriangles,
        removedDuplicateTriangles: weld.removedDuplicateTriangles,
      },
      welded,
      repairSummary,
      orientSummary,
      capPasses,
      surfaceAttach,
    },
    solid: null,
    report,
    score: scorePrintability(report),
    inputBvh: null,
  };
}

function attachLeftoverTears(
  mesh: MeshData,
  bounds: ReturnType<typeof computeBounds>,
  options: PipelineOptions,
  budgetMs = Number.POSITIVE_INFINITY,
  surfaceAttach = true,
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
  const t0 = Date.now();
  const over = () => Date.now() - t0 >= budgetMs;
  const left = () => Math.max(0, budgetMs - (Date.now() - t0));

  for (let cycle = 0; cycle < 3; cycle++) {
    if (over()) break;
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

    if (leftover.length > 0 && !over()) {
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

    const bridged = over() ? { mesh: working, addedTriangles: 0 } : bridgeLeftoverTears(working);
    working = bridged.mesh;
    bridgedTriangles += bridged.addedTriangles;
    if (bridged.addedTriangles > 0) addedPasses++;

    const after = buildTopology(working).boundaryEdgeCount;
    if (after >= before) break;
  }

  if (!options.disableWrap && !over() && buildTopology(working).boundaryEdgeCount > 0) {
    const clustered = wrapBoundaryClusters(
      working,
      options.wrapResolution ?? BROWSER_WRAP_RESOLUTION,
      options.strictManifold === true,
      left(),
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
    if (leftoverLoops && !over()) {
      const loopWrap = applyLeftoverWrap(working, bounds, options, left());
      working = loopWrap.mesh;
      wrappedTriangles += loopWrap.addedTriangles;
      if (loopWrap.addedTriangles > 0) addedPasses++;
    }

    const afterWrap = bridgeLeftoverTears(working);
    working = afterWrap.mesh;
    bridgedTriangles += afterWrap.addedTriangles;
  }

  const surface = over() || !surfaceAttach
    ? {
        mesh: working,
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
        wrappedTriangles: 0,
      }
    : attachToExistingSurface(working, left());
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
  budgetMs = Number.POSITIVE_INFINITY,
): { mesh: MeshData; addedTriangles: number; closedEverything: boolean } {
  const tEntry = Date.now();
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
    budgetMs - (Date.now() - tEntry),
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
