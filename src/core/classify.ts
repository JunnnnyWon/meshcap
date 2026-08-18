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
  | 'flatBase' // 바닥 개구부를 평평한 받침으로 마감
  | 'skip'; // 닫히지 않아 안전하게 메울 수 없음

export interface ClassifyOptions {
  upAxis?: UpAxis;
  /** 이 정점 수 이하면 부채꼴로 처리한다. */
  fanMaxVertices?: number;
  /** 등가 반지름 대비 평면 이탈 RMS가 이 값 미만이면 평면으로 본다. */
  planarityThreshold?: number;
  /** Liepa 삼각화를 시도할 최대 정점 수. O(n^3)이라 상한이 필요하다. */
  liepaMaxVertices?: number;
  /** bbox 대각선 대비 이 비율보다 둘레가 길어야 바닥 받침 후보가 된다. */
  flatBaseMinRelativeSize?: number;
  /** 바닥 받침으로 처리하지 않고 일반 구멍으로 둘 때 사용한다. */
  disableFlatBase?: boolean;
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

export const DEFAULT_CLASSIFY_OPTIONS: Required<Omit<ClassifyOptions, 'upAxis'>> & { upAxis: UpAxis } = {
  upAxis: 'y',
  fanMaxVertices: 8,
  planarityThreshold: 0.06,
  liepaMaxVertices: 250,
  flatBaseMinRelativeSize: 0.04,
  disableFlatBase: false,
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

    const strategy = pickStrategy(loop, points.length, planarity, bottomFacing, opts);

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
  n: number,
  planarity: number,
  bottomFacing: boolean,
  opts: Required<ClassifyOptions>,
): CapStrategy {
  if (!loop.closed || n < 3) return 'skip';
  if (n === 3) return 'single';
  if (bottomFacing) return 'flatBase';
  if (n <= opts.fanMaxVertices) return 'fan';
  if (planarity < opts.planarityThreshold) return 'planar';
  // O(n^3)이라 큰 루프는 평면 투영으로 넘긴다. 품질보다 응답성이 우선이다.
  if (n <= opts.liepaMaxVertices) return 'liepa';
  return 'planar';
}
