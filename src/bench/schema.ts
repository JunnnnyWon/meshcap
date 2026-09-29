import type { UpAxis } from '../core/classify.ts';

export const VARIANT_IDS = ['raw', 'naiveFan', 'patch', 'solid', 'meshcap'] as const;
export type VariantId = (typeof VARIANT_IDS)[number];

export const VARIANT_LABEL: Record<VariantId, string> = {
  raw: '올린 그대로',
  naiveFan: '그냥 부채꼴',
  patch: '구멍 메우기',
  solid: '솔리드화',
  meshcap: 'MeshCap 자동',
};

export const VARIANT_DESCRIPTION: Record<VariantId, string> = {
  raw: '올린 파일 그대로. 좌표가 완전히 같은 점만 합치고 면은 하나도 빼지 않는다. 보정 전 점수의 기준이다.',
  naiveFan: '점을 합친 뒤 남은 구멍을 전부 가운데에서 부채꼴로 메운다. 구멍 종류와 면 방향은 빼 둔다.',
  patch: '원래 삼각형을 지키고, 구멍 종류에 따라 나눠 메우고 면 방향까지 맞춘 결과.',
  solid: '와인딩 넘버로 안팎을 다시 정해 닫힌 표면을 새로 뽑은 결과. 두께 없는 면에는 최소 두께를 준다.',
  meshcap: '입력을 보고 둘 중 하나를 고른 결과. 화면에서 기본으로 쓰는 값이다.',
};

export type ModelSource = 'meshy' | 'tripo' | 'synthetic';

export const SOURCE_LABEL: Record<ModelSource, string> = {
  meshy: '3D AI A',
  tripo: '3D AI B',
  synthetic: '합성 대조군',
};

export interface VariantMetrics {
  vertices: number;
  triangles: number;
  addedTriangles: number;
  boundaryEdges: number;
  holes: number;
  nonManifoldEdges: number;
  inconsistentEdges: number;
  components: number;
  degenerateTriangles: number;
  /** 서로 뚫고 지나가는 면 쌍. 1만 쌍에서 세기를 멈춘다. */
  selfIntersections: number;
  watertight: boolean;
  volume: number;
  score: number;
  grade: string;
  elapsedMs: number;
  /** 원래 바깥 표면이 가장 긴 축의 0.5% 안에 남은 비율. 보정하지 않은 상태는 1이다. */
  shapeKept: number;
  /** 실제로 쓴 방식. 자동에서만 의미가 있다. */
  engine?: 'patch' | 'solid';
}

export interface ModelBenchmark {
  id: string;
  /** 화면에 표시할 이름. */
  label: string;
  source: ModelSource;
  /** 같은 콘셉트를 서로 다른 서비스로 생성했을 때 묶는 키. */
  concept: string;
  fileName: string;
  fileBytes: number;
  upAxis: UpAxis;
  variants: Record<VariantId, VariantMetrics>;
  /** MeshCap이 각 전략을 몇 번 적용했는지. */
  strategyCounts: Record<string, number>;
  weld: {
    mergedVertices: number;
    /** 원본 정점 중 병합된 비율. 정점 분리가 얼마나 심한지 보여준다. */
    mergedRatio: number;
  };
  /** 가장 큰 구멍의 테두리 길이를 bbox 대각선으로 나눈 값. */
  largestHoleRelativeSize: number;
}

export interface BenchmarkFile {
  generatedAt: string;
  note: string;
  models: ModelBenchmark[];
}
