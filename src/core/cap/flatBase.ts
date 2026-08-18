import earcut from 'earcut';
import { vertexAt, type Vec3 } from '../geom.ts';
import { mapAndOrient } from './planar.ts';
import type { CapContext, CapPatch } from './types.ts';
import { EMPTY_PATCH } from './types.ts';

export const DEFAULT_FLAT_BASE_OFFSET_RATIO = 0.002;

/**
 * 바닥 개구부를 평평한 받침으로 마감한다.
 *
 * 피규어 바닥의 구멍은 그냥 메우면 안 된다. 테두리가 울퉁불퉁한 채로 닫히면
 * 출력물이 베드에 3점으로만 닿아 흔들리고, FDM에서는 첫 층이 뜨고 SLA에서는
 * 서포트가 과하게 붙는다. 그래서 테두리를 같은 높이의 평면까지 수직으로 내려
 * 옆벽을 만든 다음, 그 평면 링을 채워 진짜 평평한 접지면을 만든다.
 *
 * 기존 정점은 하나도 움직이지 않는다. 실루엣을 건드리지 않으려는 선택이다.
 */
export function capFlatBase(ctx: CapContext): CapPatch {
  const v = ctx.metrics.vertices;
  const n = v.length;
  if (n < 3) return EMPTY_PATCH;

  const up = ctx.upIndex;
  const points = v.map((index) => vertexAt(ctx.mesh.positions, index));

  let lowest = Infinity;
  for (const p of points) {
    if (p[up] < lowest) lowest = p[up];
  }

  // 최저점과 같은 높이에 두면 그 지점의 옆벽 삼각형이 면적 0이 되어
  // 오히려 새 결함이 생긴다. 한 층 두께만큼 더 내려 이를 피한다.
  const offset = (ctx.flatBaseOffsetRatio ?? DEFAULT_FLAT_BASE_OFFSET_RATIO) * (ctx.bounds.diagonal || 1);
  const level = lowest - offset;

  const newPositions: number[] = [];
  const projected: Vec3[] = [];
  const projectedIndices: number[] = [];
  const base = ctx.baseVertexCount;

  for (let i = 0; i < n; i++) {
    const p = points[i];
    const q: Vec3 = [p[0], p[1], p[2]];
    q[up] = level;
    projected.push(q);
    newPositions.push(q[0], q[1], q[2]);
    projectedIndices.push(base + i);
  }

  const triangles: number[] = [];

  // 옆벽: 루프 에지 (a → b)마다 아래로 내린 사각형을 삼각형 둘로 나눈다.
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = v[i];
    const b = v[j];
    const ap = projectedIndices[i];
    const bp = projectedIndices[j];
    triangles.push(b, a, ap);
    triangles.push(b, ap, bp);
  }

  // 접지면: 위 축을 뺀 두 축으로 투영해 채운다.
  const axes = [0, 1, 2].filter((axis) => axis !== up);
  const flat: number[] = [];
  for (const q of projected) {
    flat.push(q[axes[0]], q[axes[1]]);
  }

  const down: Vec3 = [0, 0, 0];
  down[up] = -1;

  const local = earcut(flat);
  if (local.length > 0) {
    triangles.push(...mapAndOrient(local, projectedIndices, projected, down));
  }

  return { newPositions, triangles };
}
