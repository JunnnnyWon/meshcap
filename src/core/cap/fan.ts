import { centroidOf, vertexAt } from '../geom.ts';
import type { CapContext, CapPatch } from './types.ts';
import { EMPTY_PATCH } from './types.ts';

/**
 * 정점이 셋뿐인 구멍은 삼각형 하나면 끝난다.
 *
 * 루프는 인접 면이 순회한 방향 [a, b, c]를 담고 있으므로, 메우는 삼각형은
 * 그 반대인 (c, b, a)로 감아야 기존 표면과 법선이 이어진다.
 */
export function capSingle(ctx: CapContext): CapPatch {
  const v = ctx.metrics.vertices;
  if (v.length !== 3) return EMPTY_PATCH;
  return { newPositions: [], triangles: [v[2], v[1], v[0]] };
}

/**
 * 루프 중심에 정점 하나를 두고 부채꼴로 잇는다.
 *
 * 작은 구멍에서는 가장 빠르고 결과도 깔끔하다. 다만 구멍이 커지면 중심점이
 * 표면에서 멀어져 원뿔처럼 솟기 때문에 분류기가 작은 루프에만 배정한다.
 */
export function capFan(ctx: CapContext): CapPatch {
  const v = ctx.metrics.vertices;
  const n = v.length;
  if (n < 3) return EMPTY_PATCH;
  if (n === 3) return capSingle(ctx);

  const points = v.map((index) => vertexAt(ctx.mesh.positions, index));
  const center = centroidOf(points);
  const apex = ctx.baseVertexCount;

  const triangles: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = v[i];
    const b = v[(i + 1) % n];
    // 인접 면이 (a → b)를 썼으므로 (b → a)를 포함하도록 감는다.
    triangles.push(b, a, apex);
  }

  return { newPositions: [center[0], center[1], center[2]], triangles };
}
