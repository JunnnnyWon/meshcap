import { describe, expect, it } from 'vitest';
import { orientOutward } from '../normals.ts';
import { buildTopology } from '../halfEdge.ts';
import type { MeshData } from '../types.ts';

/** 바깥을 보게 감은 축 정렬 상자의 삼각형 12개. */
function boxTriangles(v: (i: number) => number): number[][] {
  const quads = [
    [0, 3, 2, 1],
    [4, 5, 6, 7],
    [0, 1, 5, 4],
    [2, 3, 7, 6],
    [1, 2, 6, 5],
    [3, 0, 4, 7],
  ];
  const tris: number[][] = [];
  for (const [a, b, c, d] of quads) tris.push([v(a), v(b), v(c)], [v(a), v(c), v(d)]);
  return tris;
}

function boxCorners(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number[] {
  return [x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1];
}

/**
 * 모서리 하나를 공유하는 닫힌 상자 둘. 둘 다 이미 바깥을 향한다.
 * 공유 모서리에는 면이 넷 붙어 비다양체가 되고, 두 상자의 면이 번갈아 나오면
 * 그 모서리에서 처음 만난 두 면이 서로 다른 상자에 속한다.
 */
function twoBoxesSharingEdge(): MeshData {
  const positions = [...boxCorners(0, 0, 0, 1, 1, 1), ...boxCorners(1, 1, 0, 2, 2, 1)];
  const a = boxTriangles((i) => i);
  // 두 번째 상자의 0번(1,1,0)과 4번(1,1,1)은 첫 상자의 2번·6번과 같은 점이다.
  const b = boxTriangles((i) => (i === 0 ? 2 : i === 4 ? 6 : i + 8));
  const order: number[] = [];
  for (let i = 0; i < a.length; i++) order.push(...b[i], ...a[i]);
  return { positions: new Float32Array(positions), indices: new Uint32Array(order) };
}

describe('법선 정렬과 비다양체 에지', () => {
  it('비다양체 에지 너머의 멀쩡한 껍질을 뒤집지 않는다', () => {
    const mesh = twoBoxesSharingEdge();
    expect(buildTopology(mesh).nonManifoldEdgeCount).toBe(1);

    for (const alignOutward of [false, true]) {
      const result = orientOutward(mesh, { alignOutward });
      expect(result.flippedTriangles).toBe(0);
      // 한쪽 상자가 뒤집히면 부피가 +1 -1 = 0이 된다.
      expect(result.volume).toBeCloseTo(2, 5);
      expect(buildTopology(result.mesh).inconsistentEdgeCount).toBe(0);
    }
  });

  it('씨앗 면이 뒤집혀 있어도 원래 방향이 많은 쪽을 남긴다', () => {
    const positions = boxCorners(0, 0, 0, 1, 1, 1);
    const tris = boxTriangles((i) => i);
    // 첫 삼각형만 뒤집어 둔다. BFS 씨앗이 이 면이면 나머지 11개가 뒤집힌다.
    const [a, b, c] = tris[0];
    tris[0] = [a, c, b];
    const mesh: MeshData = { positions: new Float32Array(positions), indices: new Uint32Array(tris.flat()) };

    const result = orientOutward(mesh, { alignOutward: false });
    expect(result.flippedTriangles).toBe(1);
    expect(result.volume).toBeCloseTo(1, 5);
    expect(buildTopology(result.mesh).inconsistentEdgeCount).toBe(0);
  });
});
