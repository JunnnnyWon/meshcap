import { dihedralAngle, scale, triangleArea, triangleNormalRaw, vertexAt, type Vec3 } from '../geom.ts';
import type { CapContext, CapPatch } from './types.ts';
import { EMPTY_PATCH } from './types.ts';
import { capSingle } from './fan.ts';

/**
 * Liepa 방식 최소 가중 삼각화.
 *
 * 다각형을 채우는 모든 삼각화 중 (이웃 면과 이루는 최대 이면각, 총 넓이)를
 * 사전식으로 최소화하는 것을 동적계획법으로 찾는다. 넓이만 최소화하면 얇고
 * 길쭉한 삼각형이 나오기 쉬운데, 이면각을 앞세우면 주변 표면의 곡률을 이어받아
 * 훨씬 자연스러운 뚜껑이 만들어진다. 평면에서 크게 벗어난 구멍에 쓴다.
 *
 * 부분 문제가 O(n^2)개이고 각각 O(n)번 분할을 시도하므로 전체는 O(n^3)이다.
 * 그래서 분류기가 정점 수 상한을 넘는 루프에는 배정하지 않는다.
 */
export function capLiepa(ctx: CapContext): CapPatch {
  const v = ctx.metrics.vertices;
  const n = v.length;
  if (n < 3) return EMPTY_PATCH;
  if (n === 3) return capSingle(ctx);

  const P = v.map((index) => vertexAt(ctx.mesh.positions, index));

  // 루프 순서로 감은 삼각형은 안쪽을 향한다.
  // 이웃 면의 바깥 법선도 같은 규약으로 뒤집어야 이면각이 맞는다.
  const adj = ctx.adjacentNormals ? ctx.adjacentNormals.map((nn) => scale(nn, -1)) : undefined;

  const size = n * n;
  const wAngle = new Float64Array(size).fill(Infinity);
  const wArea = new Float64Array(size).fill(Infinity);
  const opt = new Int32Array(size).fill(-1);
  const at = (i: number, j: number) => i * n + j;

  const triNormal = (i: number, m: number, k: number): Vec3 => triangleNormalRaw(P[i], P[m], P[k]);

  /** 삼각형 (i, m, k) 하나를 추가할 때의 국소 비용. */
  const localWeight = (i: number, m: number, k: number): [number, number] => {
    const nrm = triNormal(i, m, k);
    let angle = 0;

    // 에지 (i, m) 건너편 이웃
    if (m === i + 1) {
      if (adj) angle = Math.max(angle, dihedralAngle(nrm, adj[i]));
    } else {
      const o = opt[at(i, m)];
      if (o >= 0) angle = Math.max(angle, dihedralAngle(nrm, triNormal(i, o, m)));
    }

    // 에지 (m, k) 건너편 이웃
    if (k === m + 1) {
      if (adj) angle = Math.max(angle, dihedralAngle(nrm, adj[m]));
    } else {
      const o = opt[at(m, k)];
      if (o >= 0) angle = Math.max(angle, dihedralAngle(nrm, triNormal(m, o, k)));
    }

    // 루프를 닫는 마지막 에지도 원래 메시와 맞닿는다.
    if (i === 0 && k === n - 1 && adj) {
      angle = Math.max(angle, dihedralAngle(nrm, adj[n - 1]));
    }

    return [angle, triangleArea(P[i], P[m], P[k])];
  };

  // 인접한 두 정점 사이는 아직 삼각형이 없으므로 비용 0이다.
  for (let i = 0; i + 1 < n; i++) {
    wAngle[at(i, i + 1)] = 0;
    wArea[at(i, i + 1)] = 0;
  }
  for (let i = 0; i + 2 < n; i++) {
    const [angle, area] = localWeight(i, i + 1, i + 2);
    wAngle[at(i, i + 2)] = angle;
    wArea[at(i, i + 2)] = area;
    opt[at(i, i + 2)] = i + 1;
  }

  const EPS = 1e-12;

  for (let span = 3; span < n; span++) {
    for (let i = 0; i + span < n; i++) {
      const k = i + span;
      let bestAngle = Infinity;
      let bestArea = Infinity;
      let bestSplit = -1;

      for (let m = i + 1; m < k; m++) {
        const [angle, area] = localWeight(i, m, k);
        const totalAngle = Math.max(wAngle[at(i, m)], wAngle[at(m, k)], angle);
        const totalArea = wArea[at(i, m)] + wArea[at(m, k)] + area;

        // 이면각을 먼저 보고, 같으면 넓이가 작은 쪽을 고른다.
        const better =
          totalAngle < bestAngle - EPS ||
          (Math.abs(totalAngle - bestAngle) <= EPS && totalArea < bestArea);

        if (better) {
          bestAngle = totalAngle;
          bestArea = totalArea;
          bestSplit = m;
        }
      }

      wAngle[at(i, k)] = bestAngle;
      wArea[at(i, k)] = bestArea;
      opt[at(i, k)] = bestSplit;
    }
  }

  const triangles: number[] = [];
  const stack: number[] = [0, n - 1];

  while (stack.length > 0) {
    const k = stack.pop() as number;
    const i = stack.pop() as number;
    if (k - i < 2) continue;

    const m = opt[at(i, k)];
    if (m < 0) continue;

    // 루프 순서 (i, m, k)는 안쪽을 향하므로 뒤집어 내보낸다.
    triangles.push(v[k], v[m], v[i]);
    stack.push(i, m, m, k);
  }

  return { newPositions: [], triangles };
}
