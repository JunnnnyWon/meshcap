import type { UpAxis } from '../core/classify.ts';

export const VARIANT_IDS = ['raw', 'weldOnly', 'naiveFan', 'meshcap'] as const;
export type VariantId = (typeof VARIANT_IDS)[number];

export const VARIANT_LABEL: Record<VariantId, string> = {
  raw: '무처리',
  weldOnly: '용접만',
  naiveFan: '그냥 부채꼴',
  meshcap: 'MeshCap',
};

export const VARIANT_DESCRIPTION: Record<VariantId, string> = {
  raw: '받은 파일 그대로. 슬라이서가 처음 받는 상태다.',
  weldOnly: '위치가 같은 점만 합친 상태. 여기서 줄어든 구멍은 처음부터 없던 것이다.',
  naiveFan: '남은 구멍을 전부 가운데에서 부채꼴로 메운다. 구멍 종류와 면 방향은 빼 둔다.',
  meshcap: '구멍 종류에 따라 나눠 메우고 면 방향까지 맞춘 결과.',
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
  watertight: boolean;
  volume: number;
  score: number;
  grade: string;
  elapsedMs: number;
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
