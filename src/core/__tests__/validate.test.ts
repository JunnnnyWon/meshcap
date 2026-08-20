import { describe, expect, it } from 'vitest';
import { validateMesh } from '../validate.ts';
import { openCube } from '../__fixtures__/shapes.ts';
import type { MeshData } from '../types.ts';

/** 거의 같은 자리에 삼각형을 겹쳐 쌓는다. 헤어 클러스터처럼 후보 쌍이 폭주하는 상태다. */
function overlappingCluster(count: number): MeshData {
  const positions = new Float32Array(count * 9);
  const indices = new Uint32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const dx = (i % 80) * 0.01;
    const dy = Math.floor(i / 80) * 0.01;
    const o = i * 9;
    positions[o] = dx;
    positions[o + 1] = dy;
    positions[o + 2] = 0;
    positions[o + 3] = dx + 0.05;
    positions[o + 4] = dy;
    positions[o + 5] = 0;
    positions[o + 6] = dx;
    positions[o + 7] = dy + 0.05;
    positions[o + 8] = 0;
    const t = i * 3;
    indices[t] = t;
    indices[t + 1] = t + 1;
    indices[t + 2] = t + 2;
  }
  return { positions, indices };
}

describe('뚜껑 관통 검사', () => {
  it('뚜껑이 없으면 교차 횟수가 0이다', () => {
    const report = validateMesh(openCube(), { capTriangleStart: 10 });
    expect(report.capSelfIntersections).toBe(0);
    expect(report.selfIntersectionChecked).toBe(true);
  });

  it('빽빽한 뚜껑에서 Set 한도를 넘기지 않는다', () => {
    const mesh = overlappingCluster(8_000);
    expect(() =>
      validateMesh(mesh, {
        capTriangleStart: 100,
        pairTestLimit: 5_000,
      }),
    ).not.toThrow();
  });
});
