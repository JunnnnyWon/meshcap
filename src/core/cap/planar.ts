import earcut from 'earcut';
import { dot, planeBasis, projectToPlane, triangleNormalRaw, vertexAt, type Vec3 } from '../geom.ts';
import type { CapContext, CapPatch } from './types.ts';
import { EMPTY_PATCH } from './types.ts';

/**
 * 최적 평면에 투영한 뒤 earcut으로 삼각화한다.
 *
 * 부채꼴과 달리 오목한 다각형도 볼록 분해 없이 올바르게 채우고, 중심점을 새로
 * 만들지 않으므로 표면 밖으로 솟지 않는다. 평면에서 크게 벗어난 구멍에서는
 * 결과가 납작해지므로 분류기가 평면성이 좋은 루프에만 배정한다.
 */
export function capPlanar(ctx: CapContext): CapPatch {
  const v = ctx.metrics.vertices;
  const n = v.length;
  if (n < 3) return EMPTY_PATCH;

  const points = v.map((index) => vertexAt(ctx.mesh.positions, index));
  const basis = planeBasis(ctx.metrics.centroid, ctx.metrics.capNormal);

  const flat: number[] = [];
  for (const p of points) {
    const [u, w] = projectToPlane(basis, p);
    flat.push(u, w);
  }

  const local = earcut(flat);
  if (local.length === 0) return EMPTY_PATCH;

  const triangles = mapAndOrient(local, v, points, ctx.metrics.capNormal);
  return { newPositions: [], triangles };
}

/**
 * earcut 결과를 전역 정점 인덱스로 바꾸고, 필요하면 감는 방향을 뒤집는다.
 *
 * earcut의 출력 방향은 입력 링의 방향에 따라 달라지므로 라이브러리 관례에
 * 기대지 않고 실제 법선을 재서 맞춘다.
 */
export function mapAndOrient(
  local: number[],
  globalIndices: number[],
  points: Vec3[],
  desiredNormal: Vec3,
): number[] {
  let flip = false;
  for (let i = 0; i < local.length; i += 3) {
    const normal = triangleNormalRaw(points[local[i]], points[local[i + 1]], points[local[i + 2]]);
    const d = dot(normal, desiredNormal);
    if (Math.abs(d) < 1e-20) continue; // 퇴화 삼각형은 방향 판단에 쓸 수 없다
    flip = d < 0;
    break;
  }

  const triangles: number[] = [];
  for (let i = 0; i < local.length; i += 3) {
    const a = globalIndices[local[i]];
    const b = globalIndices[local[i + 1]];
    const c = globalIndices[local[i + 2]];
    if (a === b || b === c || a === c) continue;
    if (flip) triangles.push(a, c, b);
    else triangles.push(a, b, c);
  }

  return triangles;
}
