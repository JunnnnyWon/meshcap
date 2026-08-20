import type { LoopMetrics } from '../classify.ts';
import type { Bounds, MeshData } from '../types.ts';
import type { Vec3 } from '../geom.ts';

/** 구멍 하나를 메운 결과. 기존 메시에 덧붙이기만 하면 된다. */
export interface CapPatch {
  /** 새로 추가할 정점 좌표를 xyz 순으로 나열한다. */
  newPositions: number[];
  /**
   * 삼각형 인덱스. 기존 정점은 원래 인덱스를 그대로 쓰고,
   * 새 정점은 baseVertexCount + (newPositions 안에서의 순번)으로 참조한다.
   */
  triangles: number[];
}

export interface CapContext {
  mesh: MeshData;
  metrics: LoopMetrics;
  /** 새 정점 인덱스가 시작될 위치. */
  baseVertexCount: number;
  bounds: Bounds;
  /** 위 방향 축의 인덱스. 0=x, 1=y, 2=z */
  upIndex: number;
  /**
   * 루프의 i번째 에지에 접한 기존 면의 바깥 방향 법선.
   * Liepa 삼각화가 이면각을 계산할 때 쓴다.
   */
  adjacentNormals?: Vec3[];
  /** 바닥 받침을 만들 때 원래 최저점보다 얼마나 더 내릴지, bbox 대각선 대비 비율. */
  flatBaseOffsetRatio?: number;
  /**
   * 두 정점이 이미 메시에서 에지로 이어져 있는지 묻는다.
   * 삼각화가 그런 쌍을 대각선으로 다시 만들면 그 에지에 면이 하나 더 붙어
   * 비다양체가 되므로, 가능하면 피해서 자르기 위한 질의다.
   */
  edgeExists?: (a: number, b: number) => boolean;
  /**
   * 이 삼각형을 붙이면 면이 셋 모이는 에지가 생기는지.
   * 생기면 그 삼각형은 커밋하지 않는다.
   */
  wouldCreateNonManifold?: (a: number, b: number, c: number) => boolean;
  /** 뚜껑 삼각형을 실제로 붙인 뒤에 면 수를 갱신한다. */
  commitTriangle?: (a: number, b: number, c: number) => void;
  /** 무향 에지에 지금 접한 면 수. 패치 전체를 가상으로 붙여 보기 위해 쓴다. */
  edgeFaceCount?: (a: number, b: number) => number;
  /** 정점마다 접한 에지의 평균 길이. Liepa 세분이 주변 밀도를 맞출 때 쓴다. */
  vertexMeanEdge?: Float32Array;
}

export const EMPTY_PATCH: CapPatch = { newPositions: [], triangles: [] };
