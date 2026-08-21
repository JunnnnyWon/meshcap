import type { BoundaryLoop } from './boundary.ts';
import { computeBounds, type Bounds, type MeshData } from './types.ts';
import {
  centroidOf,
  dot,
  length,
  newellNormal,
  normalize,
  scale,
  sub,
  vertexAt,
  type Vec3,
} from './geom.ts';

export type UpAxis = 'x' | 'y' | 'z';

export type CapStrategy =
  | 'single' // 정점 3개짜리 구멍은 삼각형 하나로 끝난다
  | 'fan' // 중심점 부채꼴
  | 'planar' // 최적 평면에 투영 후 earcut
  | 'liepa' // 최소 이면각·면적 동적계획 삼각화
  | 'front' // Zhao식 전진 전면. 중형 비평면·열린 사슬
  | 'wrap' // 로컬 복셀 랩. 로컬 삼각화가 버거운 큰 구멍·남은 테두리
  | 'flatBase' // 바닥 개구부를 평평한 받침으로 마감
  | 'collapse' // 아주 작은 구멍을 한 점으로 모은다
  | 'skip'; // 끝까지 못 메운 최후 수단

export interface ClassifyOptions {
  upAxis?: UpAxis;
  /** 이 정점 수 이하면 부채꼴로 처리한다. */
  fanMaxVertices?: number;
  /** 등가 반지름 대비 평면 이탈 RMS가 이 값 미만이면 평면으로 본다. */
  planarityThreshold?: number;
  /** Liepa 삼각화를 시도할 최대 정점 수. O(n^3)이라 상한이 필요하다. */
  liepaMaxVertices?: number;
  /**
   * 전진 전면을 시도할 최대 정점 수.
   * 이보다 큰 비평면 구멍은 로컬 복셀 랩으로 넘긴다.
   */
  frontMaxVertices?: number;
  /**
   * 열린 사슬 양 끝 거리가 국소 평균 에지의 이 배수 이하면
   * 가상 에지로 닫힌 루프처럼 분류한다.
   */
  virtualCloseEdgeMultiple?: number;
  /** bbox 대각선 대비 이 비율보다 둘레가 길어야 바닥 받침 후보가 된다. */
  flatBaseMinRelativeSize?: number;
  /** 바닥 받침으로 처리하지 않고 일반 구멍으로 둘 때 사용한다. */
  disableFlatBase?: boolean;
  /**
   * bbox 대각선 대비 이 비율보다 둘레가 짧고, 평균 에지 몇 배 안이면
   * 삼각화 대신 한 점으로 붕괴한다.
   */
  collapseMaxRelativeSize?: number;
  /** 국소 평균 에지 길이 대비 둘레 상한. */
  collapseEdgeMultiple?: number;
  /** 붕괴를 시도할 최대 정점 수. */
  collapseMaxVertices?: number;
  /**
   * 분류를 무시하고 모든 구멍에 같은 전략을 강제한다.
   * 분류기가 실제로 기여하는 몫을 재는 절제 실험에 쓴다.
   */
  forceStrategy?: CapStrategy;
}

export interface LoopMetrics {
  id: number;
  vertices: number[];
  closed: boolean;
  /** 테두리 길이. */
  perimeter: number;
  /** 최적 평면에 투영한 넓이. */
  area: number;
  /** 이 구멍을 메운 면들이 향해야 할 방향. */
  capNormal: Vec3;
  centroid: Vec3;
  /** 0이면 완전한 평면. 등가 원 반지름으로 정규화한 무차원 값이다. */
  planarity: number;
  /** bbox 대각선 대비 둘레. */
  relativeSize: number;
  /** 모델 아래쪽에서 아래를 향해 열린 개구부인지. */
  bottomFacing: boolean;
  strategy: CapStrategy;
}

const AXIS_INDEX: Record<UpAxis, number> = { x: 0, y: 1, z: 2 };

export const DEFAULT_CLASSIFY_OPTIONS: Required<Omit<ClassifyOptions, 'upAxis' | 'forceStrategy'>> & {
  upAxis: UpAxis;
  forceStrategy: CapStrategy | undefined;
} = {
  upAxis: 'y',
  fanMaxVertices: 8,
  planarityThreshold: 0.06,
  liepaMaxVertices: 250,
  frontMaxVertices: 400,
  virtualCloseEdgeMultiple: 4,
  flatBaseMinRelativeSize: 0.04,
  disableFlatBase: false,
  collapseMaxRelativeSize: 0.008,
  collapseEdgeMultiple: 3.5,
  collapseMaxVertices: 8,
  forceStrategy: undefined,
};

/**
 * 구멍마다 형상 특징을 재고 어떤 방식으로 메울지 정한다.
 *
 * 모든 구멍을 같은 방법으로 메우면 반드시 어딘가가 망가진다. 피규어 바닥의 큰
 * 개구부를 부채꼴로 메우면 가운데가 원뿔처럼 솟아 서포트가 붙고, 반대로 머리카락
 * 사이의 작은 구멍을 평면으로 메우면 표면 밖으로 튀어나온다. 그래서 크기·평면성·
 * 방향을 먼저 재고 전략을 나눈다.
 */
export function classifyLoops(
  mesh: MeshData,
  loops: BoundaryLoop[],
  options: ClassifyOptions = {},
  precomputedBounds?: Bounds,
  meanEdgeLength = 0,
): LoopMetrics[] {
  const opts = { ...DEFAULT_CLASSIFY_OPTIONS, ...options };
  const bounds = precomputedBounds ?? computeBounds(mesh.positions);
  const upIndex = AXIS_INDEX[opts.upAxis];

  const down: Vec3 = [0, 0, 0];
  down[upIndex] = -1;

  const bottomBand = bounds.min[upIndex] + bounds.size[upIndex] * 0.25;
  const diagonal = bounds.diagonal || 1;

  return loops.map((loop, id) => {
    const points = loop.vertices.map((v) => vertexAt(mesh.positions, v));

    let perimeter = 0;
    for (let i = 0; i < points.length; i++) {
      perimeter += length(sub(points[(i + 1) % points.length], points[i]));
    }

    const raw = newellNormal(points);
    const area = length(raw) / 2;
    // 루프는 인접 면이 순회한 방향을 따르므로 Newell 법선은 안쪽을 가리킨다.
    // 구멍을 메운 면은 그 반대를 향해야 기존 표면과 법선이 이어진다.
    const capNormal = scale(normalize(raw), -1);
    const centroid = centroidOf(points);

    let sumSquared = 0;
    for (const p of points) {
      const d = dot(sub(p, centroid), capNormal);
      sumSquared += d * d;
    }
    const rms = Math.sqrt(sumSquared / points.length);
    // 둘레가 같은 원의 반지름으로 나눠 크기와 무관한 지표로 만든다.
    const equivalentRadius = perimeter / (2 * Math.PI);
    const planarity = equivalentRadius > 0 ? rms / equivalentRadius : 0;

    const relativeSize = perimeter / diagonal;

    const bottomFacing =
      !opts.disableFlatBase &&
      dot(capNormal, down) > 0.5 &&
      centroid[upIndex] <= bottomBand &&
      relativeSize >= opts.flatBaseMinRelativeSize;

    const strategy = pickStrategy(
      loop,
      points,
      planarity,
      bottomFacing,
      relativeSize,
      perimeter,
      meanEdgeLength,
      opts,
    );

    return {
      id,
      vertices: loop.vertices,
      closed: loop.closed,
      perimeter,
      area,
      capNormal,
      centroid,
      planarity,
      relativeSize,
      bottomFacing,
      strategy,
    };
  });
}

function pickStrategy(
  loop: BoundaryLoop,
  points: Vec3[],
  planarity: number,
  bottomFacing: boolean,
  relativeSize: number,
  perimeter: number,
  meanEdge: number,
  opts: typeof DEFAULT_CLASSIFY_OPTIONS,
): CapStrategy {
  const n = points.length;
  if (n < 3) return 'skip';

  const treatClosed = loop.closed || canVirtualClose(points, meanEdge, opts.virtualCloseEdgeMultiple);

  if (opts.forceStrategy) return n === 3 ? 'single' : opts.forceStrategy;

  if (!treatClosed) {
    // 끝점이 멀어도 사슬을 따라 전면을 전진시킨다. skip은 최후 수단만.
    if (n <= opts.frontMaxVertices) return 'front';
    return 'wrap';
  }

  if (bottomFacing) return 'flatBase';
  if (
    n <= opts.collapseMaxVertices &&
    relativeSize < opts.collapseMaxRelativeSize &&
    meanEdge > 0 &&
    perimeter < opts.collapseEdgeMultiple * meanEdge
  ) {
    return 'collapse';
  }
  if (n === 3) return 'single';

  const planar = planarity < opts.planarityThreshold;
  if (n <= opts.fanMaxVertices) {
    // 작은 구멍도 휘어 있으면 원뿔 부채꼴 대신 곡면 삼각화.
    if (planar) return 'fan';
    return n <= opts.liepaMaxVertices ? 'liepa' : 'front';
  }
  if (planar) return 'planar';
  // 닫힌 비평면은 Liepa가 버틸 때까지 쓰고, 그 다음 전면, 그 다음 랩.
  if (n <= opts.liepaMaxVertices) return 'liepa';
  if (n <= opts.frontMaxVertices) return 'front';
  return 'wrap';
}

/**
 * 열린 사슬의 양 끝이 국소 에지 몇 배 안이면 가상 에지로 닫아
 * 기존 닫힌 구멍 전략을 그대로 쓸 수 있다.
 */
export function canVirtualClose(points: Vec3[], meanEdge: number, multiple: number): boolean {
  if (points.length < 3) return false;
  const gap = length(sub(points[0], points[points.length - 1]));
  let local = meanEdge;
  if (local <= 0) {
    let sum = 0;
    for (let i = 0; i + 1 < points.length; i++) {
      sum += length(sub(points[i + 1], points[i]));
    }
    local = sum / Math.max(1, points.length - 1);
  }
  return local > 0 && gap <= multiple * local;
}
