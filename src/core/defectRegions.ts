import { buildTopology } from './halfEdge.ts';
import { countSelfIntersections } from './intersect.ts';
import { computeBounds, type MeshData } from './types.ts';
import { triangleArea, vertexAt, type Vec3 } from './geom.ts';

/**
 * 결함이 메시 어디에 몰려 있는지 찾는다.
 *
 * 솔리드화는 지금까지 결함이 하나라도 있으면 메시 전체를 다시 뽑았다. 결함 부위만
 * 손보려면 먼저 "어디가 결함인가"가 목록으로 있어야 한다. 진단 경로는 개수만 세도록
 * 짜여 있지만(그 이유는 validate.ts의 주석에 있다), 국소 수리는 위치를 알아야 시작한다.
 *
 * 비다양체 에지는 보통 드물고, 관통 쌍은 상한을 두고 모은다. 그래서 목록을 만들어도
 * 큰 모델에서 감당이 된다.
 */

export interface DefectRegionOptions {
  /** 결함 면에서 몇 링까지 함께 담을지. 새 표면이 붙을 여유다. 기본 1. */
  ringLayers?: number;
  /** 관통 쌍 수집 상한. 넘으면 개수만 보고한다. 기본 200,000. */
  maxPairs?: number;
  /** 이보다 큰 지역은 국소 수리 대상으로 보지 않는다. 기본 20,000면. */
  localMaxTriangles?: number;
  /**
   * 면 하나짜리 에지(뚫린 자리)도 결함으로 볼지. 기본 true.
   *
   * 구멍은 구멍 메우기가 다루는 결함이라, 겹친 모서리·관통만 국소 수리 대상으로
   * 볼 때는 false로 둔다. 둘을 섞으면 구멍 많은 모델이 통째로 결함으로 잡힌다.
   */
  includeOpenEdges?: boolean;
}

export interface DefectCause {
  /** 세 면 이상이 접한 에지에 연루된 면. */
  nonManifold: number;
  /** 서로 뚫고 지나가는 쌍에 연루된 면. */
  intersecting: number;
  /** 면 하나짜리 에지에 연루된 면. 뚫린 자리다. */
  open: number;
}

export interface DefectRegion {
  id: number;
  /** 결함 면 + 여유 링. 오름차순. */
  triangles: number[];
  triangleCount: number;
  area: number;
  min: Vec3;
  max: Vec3;
  diagonal: number;
  /** 여유 링을 빼고, 실제로 결함에 연루된 면만 센 값. */
  causes: DefectCause;
  /** 결함 면 수가 localMaxTriangles를 넘어 국소 수리 대상이 아니다. */
  tooBig: boolean;
}

export interface DefectSummary {
  triangleCount: number;
  surfaceArea: number;
  /** 모델 전체 bbox 대각. 지역 크기를 견줄 기준이다. */
  modelDiagonal: number;
  nonManifoldEdges: number;
  openEdges: number;
  intersectingPairs: number;
  /** 관통 쌍을 끝까지 모았는지. false면 개수는 하한이다. */
  pairsComplete: boolean;
  /** 관통 쌍에 연루된 삼각형 수(중복 제거). */
  intersectingTriangles: number;
  regions: DefectRegion[];
  /** 결함 연루 면적 / 전체 표면적. */
  areaRatio: number;
  /** 가장 큰 지역의 대각 / 모델 대각. */
  maxRegionDiagonalRatio: number;
}

export interface LocalizationThresholds {
  /** 이 개수 이하면 국소적이다. 기본 8. */
  maxRegions?: number;
  /** 지역 대각 / 모델 대각 상한. 기본 0.35. */
  maxRegionDiagonalRatio?: number;
  /** 결함 면적 비율 상한. 기본 0.2. */
  maxAreaRatio?: number;
}

export const DEFAULT_LOCALIZATION: Required<LocalizationThresholds> = {
  maxRegions: 8,
  maxRegionDiagonalRatio: 0.35,
  maxAreaRatio: 0.2,
};

class UnionFind {
  private parent: Int32Array;

  constructor(size: number) {
    this.parent = new Int32Array(size);
  }

  add(x: number): void {
    this.parent[x] = x;
  }

  find(x: number): number {
    let root = x;
    while (this.parent[root] !== root) root = this.parent[root];
    let cur = x;
    while (this.parent[cur] !== root) {
      const next = this.parent[cur];
      this.parent[cur] = root;
      cur = next;
    }
    return root;
  }

  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }
}

/** 결함 요약을 만든다. 큰 모델에서도 정점·삼각형 수에 비례하는 메모리만 쓴다. */
export function summarizeDefects(mesh: MeshData, options: DefectRegionOptions = {}): DefectSummary {
  const { positions, indices } = mesh;
  const V = positions.length / 3;
  const F = indices.length / 3;
  const ringLayers = Math.max(0, options.ringLayers ?? 1);
  const localMax = options.localMaxTriangles ?? 20_000;
  const bounds = computeBounds(positions);

  const topology = buildTopology(mesh);

  const pairs: number[] = [];
  const intersection = F >= 2 ? countSelfIntersections(mesh, { cap: options.maxPairs ?? 200_000, pairs }) : null;
  const intersectingTriangles = new Uint8Array(F);
  for (let i = 0; i < pairs.length; i += 2) {
    intersectingTriangles[pairs[i]] = 1;
    intersectingTriangles[pairs[i + 1]] = 1;
  }
  let intersectingCount = 0;
  for (let t = 0; t < F; t++) if (intersectingTriangles[t]) intersectingCount++;

  const nonManifoldTriangles = new Uint8Array(F);
  for (let i = 0; i < topology.nonManifoldFace.length; i++) {
    nonManifoldTriangles[topology.nonManifoldFace[i]] = 1;
  }

  const openTriangles = new Uint8Array(F);
  if (options.includeOpenEdges ?? true) {
    for (let i = 0; i < topology.fillFace.length; i++) {
      openTriangles[topology.fillFace[i]] = 1;
    }
  }

  const seeded = new Uint8Array(F);
  let seedCount = 0;
  for (let t = 0; t < F; t++) {
    if (!nonManifoldTriangles[t] && !intersectingTriangles[t] && !openTriangles[t]) continue;
    seeded[t] = 1;
    seedCount++;
  }

  // 여유 링까지 넣어 둔다. 새 표면이 붙을 자리이므로 결함 면만으로는 이을 수 없다.
  const selected = seeded.slice();
  if (seedCount > 0 && ringLayers > 0) {
    const touched = new Uint8Array(V);
    for (let layer = 0; layer < ringLayers; layer++) {
      touched.fill(0);
      for (let t = 0; t < F; t++) {
        if (!selected[t]) continue;
        touched[indices[t * 3]] = 1;
        touched[indices[t * 3 + 1]] = 1;
        touched[indices[t * 3 + 2]] = 1;
      }
      let added = 0;
      for (let t = 0; t < F; t++) {
        if (selected[t]) continue;
        if (!touched[indices[t * 3]] && !touched[indices[t * 3 + 1]] && !touched[indices[t * 3 + 2]]) continue;
        selected[t] = 1;
        added++;
      }
      if (added === 0) break;
    }
  }

  // 정점을 공유하는 삼각형끼리 묶는다. 정점마다 처음 만난 삼각형 하나만 기억하면 된다.
  const uf = new UnionFind(F);
  const vertexOwner = new Int32Array(V).fill(-1);
  for (let t = 0; t < F; t++) {
    if (!selected[t]) continue;
    uf.add(t);
  }
  for (let t = 0; t < F; t++) {
    if (!selected[t]) continue;
    for (let k = 0; k < 3; k++) {
      const v = indices[t * 3 + k];
      const owner = vertexOwner[v];
      if (owner < 0) vertexOwner[v] = t;
      else uf.union(t, owner);
    }
  }

  const groups = new Map<number, number[]>();
  for (let t = 0; t < F; t++) {
    if (!selected[t]) continue;
    const root = uf.find(t);
    const list = groups.get(root);
    if (list) list.push(t);
    else groups.set(root, [t]);
  }

  let surfaceArea = 0;
  for (let t = 0; t < F; t++) {
    surfaceArea += triangleArea(vertexAt(positions, indices[t * 3]), vertexAt(positions, indices[t * 3 + 1]), vertexAt(positions, indices[t * 3 + 2]));
  }

  const modelDiagonal = bounds.diagonal || 1;
  const regions: DefectRegion[] = [];
  let defectArea = 0;
  let maxRegionDiagonalRatio = 0;
  let id = 0;
  for (const list of groups.values()) {
    list.sort((a, b) => a - b);
    let area = 0;
    const min: Vec3 = [Infinity, Infinity, Infinity];
    const max: Vec3 = [-Infinity, -Infinity, -Infinity];
    const causes: DefectCause = { nonManifold: 0, intersecting: 0, open: 0 };
    let seededInRegion = 0;
    for (const t of list) {
      const a = vertexAt(positions, indices[t * 3]);
      const b = vertexAt(positions, indices[t * 3 + 1]);
      const c = vertexAt(positions, indices[t * 3 + 2]);
      if (seeded[t]) {
        defectArea += triangleArea(a, b, c);
        seededInRegion++;
        if (nonManifoldTriangles[t]) causes.nonManifold++;
        if (intersectingTriangles[t]) causes.intersecting++;
        if (openTriangles[t]) causes.open++;
      }
      area += triangleArea(a, b, c);
      for (const p of [a, b, c]) {
        for (let k = 0; k < 3; k++) {
          if (p[k] < min[k]) min[k] = p[k];
          if (p[k] > max[k]) max[k] = p[k];
        }
      }
    }
    const diagonal = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
    if (diagonal / modelDiagonal > maxRegionDiagonalRatio) maxRegionDiagonalRatio = diagonal / modelDiagonal;
    regions.push({
      id: id++,
      triangles: list,
      triangleCount: list.length,
      area,
      min,
      max,
      diagonal,
      causes,
      tooBig: seededInRegion > localMax,
    });
  }
  regions.sort((a, b) => b.area - a.area);

  return {
    triangleCount: F,
    surfaceArea,
    modelDiagonal,
    nonManifoldEdges: topology.nonManifoldEdgeCount,
    openEdges: topology.boundaryEdgeCount,
    intersectingPairs: intersection?.count ?? 0,
    pairsComplete: intersection?.complete ?? true,
    intersectingTriangles: intersectingCount,
    regions,
    areaRatio: surfaceArea > 0 ? defectArea / surfaceArea : 0,
    maxRegionDiagonalRatio,
  };
}

/** 국소 수리로 감당할 만한 범위인지 판정한다. */
export function localizationVerdict(
  summary: DefectSummary,
  thresholds: LocalizationThresholds = {},
): { localized: boolean; reasons: string[] } {
  const limit = { ...DEFAULT_LOCALIZATION, ...thresholds };
  const reasons: string[] = [];

  if (summary.nonManifoldEdges === 0 && summary.intersectingPairs === 0) {
    return { localized: true, reasons: ['겹친 모서리와 관통이 없습니다.'] };
  }

  const usable = summary.regions.filter((region) => !region.tooBig);
  if (summary.regions.some((region) => region.tooBig)) {
    const biggest = summary.regions.find((region) => region.tooBig);
    reasons.push(
      `결함 한 덩어리가 ${biggest?.triangleCount.toLocaleString('ko-KR')}면이라 국소 범위를 넘습니다.`,
    );
  }
  if (usable.length > limit.maxRegions) {
    reasons.push(`결함이 ${usable.length}곳에 흩어져 있습니다.`);
  }
  if (summary.maxRegionDiagonalRatio > limit.maxRegionDiagonalRatio) {
    reasons.push(
      `가장 큰 덩어리가 모델 대각의 ${(summary.maxRegionDiagonalRatio * 100).toFixed(0)}%를 차지합니다.`,
    );
  }
  if (summary.areaRatio > limit.maxAreaRatio) {
    reasons.push(`결함이 붙은 면적이 전체의 ${(summary.areaRatio * 100).toFixed(1)}%입니다.`);
  }
  if (!summary.pairsComplete) reasons.push('관통 쌍이 너무 많아 끝까지 세지 못했습니다.');

  return { localized: reasons.length === 0, reasons };
}
