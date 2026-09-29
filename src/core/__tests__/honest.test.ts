import { describe, expect, it } from 'vitest';
import { weldExact } from '../weld.ts';
import { countSelfIntersections } from '../intersect.ts';
import { listDefectEdges } from '../defectEdges.ts';
import { validateMesh } from '../validate.ts';
import { runPipeline } from '../pipeline.ts';
import { cube, nonManifoldFan } from '../__fixtures__/shapes.ts';
import type { MeshData } from '../types.ts';

function soup(triangles: number[][][]): MeshData {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const tri of triangles) {
    for (const p of tri) {
      indices.push(positions.length / 3);
      positions.push(p[0], p[1], p[2]);
    }
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

/** 닫힌 정육면체에 같은 삼각형을 반대 방향으로 한 장 더 붙인 입력. 양면 시트가 한 장 겹친 모습이다. */
function cubeWithDoubledFace(): MeshData {
  const base = cube();
  const extra = [base.indices[0], base.indices[2], base.indices[1]];
  const indices = new Uint32Array(base.indices.length + 3);
  indices.set(base.indices);
  indices.set(extra, base.indices.length);
  return { positions: base.positions, indices };
}

describe('정확 용접', () => {
  it('좌표가 비트 단위로 같은 점만 합치고 겹친 면은 남긴다', () => {
    const mesh = soup([
      [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
      ],
      [
        [0, 0, 0],
        [0, 1, 0],
        [1, 0, 0],
      ],
      [
        [-0, 0, 0],
        [1, 0, 0],
        [1, 1, 0.0000001],
      ],
    ]);
    const result = weldExact(mesh);
    expect(result.mesh.indices.length / 3).toBe(3);
    // (0,0,0)과 (-0,0,0)은 같은 점이다. 정점 9개가 4개가 된다.
    expect(result.mesh.positions.length / 3).toBe(4);
    expect(result.mergedVertices).toBe(5);
  });

  it('꼭짓점이 겹친 삼각형은 빼되 개수를 남긴다', () => {
    const mesh = soup([
      [
        [0, 0, 0],
        [0, 0, 0],
        [0, 1, 0],
      ],
      [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
      ],
    ]);
    const result = weldExact(mesh);
    expect(result.removedDegenerateTriangles).toBe(1);
    expect(result.mesh.indices.length / 3).toBe(1);
  });
});

describe('메시 전체 관통 검사', () => {
  const crossing = () =>
    soup([
      [
        [-1, -1, 0],
        [1, -1, 0],
        [0, 1, 0],
      ],
      [
        [0, -0.5, -1],
        [0, 0.5, 1],
        [0, -0.5, 1],
      ],
    ]);

  it('서로 뚫고 지나가는 삼각형 한 쌍을 센다', () => {
    const result = countSelfIntersections(crossing());
    expect(result.count).toBe(1);
    expect(result.complete).toBe(true);
  });

  it('같은 평면에서 겹친 면과 점만 닿은 면은 관통으로 치지 않는다', () => {
    const coplanar = soup([
      [
        [0, 0, 0],
        [2, 0, 0],
        [0, 2, 0],
      ],
      [
        [0.2, 0.2, 0],
        [1.5, 0.2, 0],
        [0.2, 1.5, 0],
      ],
      [
        [2, 0, 0],
        [3, 0, 0],
        [2, 1, 1],
      ],
    ]);
    expect(countSelfIntersections(coplanar).count).toBe(0);
  });

  it('점을 공유하는 이웃은 건너뛴다', () => {
    expect(countSelfIntersections(cube()).count).toBe(0);
  });

  it('격자 칸을 크게 넘는 큰 삼각형도 빠뜨리지 않는다', () => {
    const triangles: number[][][] = [
      [
        [-100, -100, 0],
        [100, -100, 0],
        [0, 100, 0],
      ],
    ];
    // 작은 삼각형을 많이 깔아 칸을 잘게 만든 뒤, 하나만 큰 삼각형을 관통시킨다.
    for (let i = 0; i < 400; i++) {
      const x = 200 + (i % 20);
      const y = Math.floor(i / 20);
      triangles.push([
        [x, y, 5],
        [x + 0.5, y, 5],
        [x, y + 0.5, 5],
      ]);
    }
    triangles.push([
      [0, 0, -0.5],
      [0.5, 0, 0.5],
      [0, 0.5, 0.5],
    ]);
    expect(countSelfIntersections(soup(triangles)).count).toBe(1);
  });

  it('한도에 닿으면 세기를 멈추고 그렇다고 표시한다', () => {
    const triangles: number[][][] = [];
    for (let i = 0; i < 30; i++) {
      const z = i * 0.01;
      triangles.push([
        [-1, -1, z],
        [1, -1, z],
        [0, 1, z],
      ]);
      triangles.push([
        [0, -0.5, -1 + z],
        [0, 0.5, 1 + z],
        [0, -0.5, 1 + z],
      ]);
    }
    const result = countSelfIntersections(soup(triangles), { cap: 10 });
    expect(result.count).toBe(10);
    expect(result.capped).toBe(true);
  });
});

describe('결함 모서리 목록', () => {
  it('면이 하나인 모서리와 셋 이상인 모서리를 모두 돌려준다', () => {
    const edges = listDefectEdges(nonManifoldFan());
    const pairs = new Set<string>();
    for (let i = 0; i < edges.length; i += 2) pairs.add(`${edges[i]}:${edges[i + 1]}`);
    expect(pairs.has('0:1')).toBe(true);
    const report = validateMesh(nonManifoldFan());
    expect(edges.length / 2).toBe(report.boundaryEdgeCount + report.nonManifoldEdgeCount);
  });

  it('닫힌 정육면체에는 없다', () => {
    expect(listDefectEdges(cube()).length).toBe(0);
  });
});

describe('정직한 보정 전 점수', () => {
  it('반대 방향으로 겹친 면을 지우지 않고 올린 그대로 잰다', () => {
    const result = runPipeline(cubeWithDoubledFace(), { engine: 'patch', measureFidelity: false });
    // 올린 그대로는 테두리가 없고, 겹친 모서리만 있다.
    expect(result.input.boundaryEdgeCount).toBe(0);
    expect(result.input.nonManifoldEdgeCount).toBeGreaterThan(0);
    expect(result.input.triangleCount).toBe(13);
    // 구멍 메우기는 내부에서 중복 면을 줄인다. 그건 보정의 일부라 보정 전 점수에 들어가지 않는다.
    expect(result.patch!.weldSummary.removedDuplicateTriangles).toBe(1);
  });

  it('관통은 보정 전에도 메시 전체를 검사한다', () => {
    const base = cube();
    const shifted = new Float32Array(base.positions.length);
    for (let i = 0; i < base.positions.length; i += 3) {
      shifted[i] = base.positions[i] + 0.5;
      shifted[i + 1] = base.positions[i + 1] + 0.5;
      shifted[i + 2] = base.positions[i + 2] + 0.5;
    }
    const positions = new Float32Array(base.positions.length * 2);
    positions.set(base.positions);
    positions.set(shifted, base.positions.length);
    const indices = new Uint32Array(base.indices.length * 2);
    indices.set(base.indices);
    for (let i = 0; i < base.indices.length; i++) indices[base.indices.length + i] = base.indices[i] + 8;
    const report = validateMesh({ positions, indices });
    expect(report.selfIntersectionChecked).toBe(true);
    expect(report.selfIntersections).toBeGreaterThan(0);
  });
});
