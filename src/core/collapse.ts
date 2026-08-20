import type { LoopMetrics } from './classify.ts';
import { mergeVertexGroups } from './compact.ts';
import type { EdgeIncidence } from './incidence.ts';
import { UnionFind } from './unionFind.ts';
import type { MeshData } from './types.ts';

export interface CollapseResult {
  mesh: MeshData;
  /** 한 점으로 모은 구멍 수. */
  collapsed: number;
  ids: number[];
}

/**
 * 둘레가 아주 짧은 구멍을 삼각화하지 않고 테두리 정점을 무게중심으로 붕괴한다.
 *
 * 생성형 헤어를 줄이는 과정에서 생기는 핀홀에 삼각형을 덧붙이면 면이 겹치거나
 * 비다양체가 늘어난다. 진짜 경계(면이 하나인 에지)이면서 모델에 비해 작은
 * 구멍만 대상으로 한다.
 */
export function collapseMicroHoles(
  mesh: MeshData,
  holes: LoopMetrics[],
  incidence: EdgeIncidence,
): CollapseResult {
  const candidates = holes.filter((hole) => hole.strategy === 'collapse' && canCollapse(hole, incidence));
  if (candidates.length === 0) {
    return { mesh, collapsed: 0, ids: [] };
  }

  const V = mesh.positions.length / 3;
  const uf = new UnionFind(V);
  for (const hole of candidates) {
    const verts = hole.vertices;
    for (let i = 1; i < verts.length; i++) uf.union(verts[0], verts[i]);
  }

  const buckets = new Map<number, number[]>();
  for (const hole of candidates) {
    for (const v of hole.vertices) {
      const root = uf.find(v);
      const list = buckets.get(root);
      if (list) {
        if (!list.includes(v)) list.push(v);
      } else buckets.set(root, [v]);
    }
  }

  const groups = [...buckets.values()].filter((g) => g.length >= 2);
  return {
    mesh: mergeVertexGroups(mesh, groups),
    collapsed: candidates.length,
    ids: candidates.map((h) => h.id),
  };
}

/** 테두리 에지가 모두 면 하나짜리 진짜 구멍일 때만 붕괴한다. */
export function canCollapse(hole: LoopMetrics, incidence: EdgeIncidence): boolean {
  const v = hole.vertices;
  const n = v.length;
  if (n < 3 || !hole.closed) return false;
  for (let i = 0; i < n; i++) {
    if (incidence.count(v[i], v[(i + 1) % n]) !== 1) return false;
  }
  return true;
}
