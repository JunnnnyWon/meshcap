import { describe, expect, it } from 'vitest';
import { buildSoup, measureFidelity, solidify, soupFromMesh, TriangleBVH } from '../solid/index.ts';
import { runPipeline } from '../pipeline.ts';
import { validateMesh } from '../validate.ts';
import { cube, openCube } from '../__fixtures__/shapes.ts';
import type { MeshData } from '../types.ts';

/** 바깥을 보게 감은 축 정렬 상자. */
function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, inward = false): MeshData {
  const positions = new Float32Array([
    x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0,
    x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1,
  ]);
  const quads = [
    [0, 3, 2, 1],
    [4, 5, 6, 7],
    [0, 1, 5, 4],
    [2, 3, 7, 6],
    [1, 2, 6, 5],
    [3, 0, 4, 7],
  ];
  const indices: number[] = [];
  for (const [a, b, c, d] of quads) {
    if (inward) indices.push(a, c, b, a, d, c);
    else indices.push(a, b, c, a, c, d);
  }
  return { positions, indices: new Uint32Array(indices) };
}

function merge(...meshes: MeshData[]): MeshData {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const mesh of meshes) {
    const base = positions.length / 3;
    positions.push(...mesh.positions);
    for (const i of mesh.indices) indices.push(i + base);
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

/** 정육면체 윗면 가운데에서 위로 솟은, 두께 없는 양면 판. */
function cubeWithFin(): MeshData {
  const fin: MeshData = {
    positions: new Float32Array([0.2, 0.5, 1, 0.8, 0.5, 1, 0.8, 0.5, 1.6, 0.2, 0.5, 1.6]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3, 0, 2, 1, 0, 3, 2]),
  };
  return merge(cube(), fin);
}

function expectPrintable(mesh: MeshData) {
  const report = validateMesh(mesh);
  expect(report.watertight).toBe(true);
  expect(report.nonManifoldEdgeCount).toBe(0);
  expect(report.nonManifoldVertexCount).toBe(0);
  expect(report.inconsistentEdgeCount).toBe(0);
  expect(report.selfIntersectionChecked).toBe(true);
  expect(report.selfIntersections).toBe(0);
  expect(report.degenerateTriangles).toBe(0);
  return report;
}

describe('와인딩 넘버 BVH', () => {
  it('닫힌 정육면체 안은 1, 밖은 0이다', () => {
    const bvh = new TriangleBVH(soupFromMesh(cube()));
    expect(bvh.winding(0.5, 0.5, 0.5)).toBeCloseTo(1, 6);
    expect(bvh.winding(3, 0.5, 0.5)).toBeCloseTo(0, 3);
  });

  it('구멍 난 정육면체는 가운데가 0.5보다 크고, 뚫린 면 바로 위는 0.5보다 작다', () => {
    const bvh = new TriangleBVH(soupFromMesh(openCube()));
    expect(bvh.winding(0.5, 0.5, 0.4)).toBeGreaterThan(0.5);
    expect(bvh.winding(0.5, 0.5, 1.3)).toBeLessThan(0.5);
  });

  it('가장 가까운 면까지 거리를 잰다', () => {
    const bvh = new TriangleBVH(soupFromMesh(cube()));
    expect(bvh.distance(0.5, 0.5, 3)).toBeCloseTo(2, 6);
    expect(bvh.distance(0.5, 0.5, 0.9)).toBeCloseTo(0.1, 6);
  });
});

describe('수프 정리', () => {
  it('반대 방향 짝은 가중치 0 한 장, 같은 방향 중복은 한 장으로 줄인다', () => {
    const base = cube();
    const indices = new Uint32Array(base.indices.length + 6);
    indices.set(base.indices);
    const [a, b, c] = [base.indices[0], base.indices[1], base.indices[2]];
    indices.set([a, c, b], base.indices.length);
    const [d, e, f] = [base.indices[3], base.indices[4], base.indices[5]];
    indices.set([d, e, f], base.indices.length + 3);
    const { soup, stats } = buildSoup({ positions: base.positions, indices });
    expect(stats.sheetGroups).toBe(1);
    expect(stats.duplicateTriangles).toBe(1);
    expect(soup.weight.length).toBe(12);
    expect(soup.weight.filter((w) => w === 0).length).toBe(1);
  });
});

describe('솔리드화', () => {
  it('구멍 난 정육면체를 닫힌 다양체로 다시 뽑는다', () => {
    const bvh = new TriangleBVH(buildSoup(openCube()).soup);
    const result = solidify(bvh);
    const report = expectPrintable(result.mesh);
    expect(report.connectedComponents).toBe(1);
    // 모서리가 조금 둥글어지므로 부피가 1보다 약간 작다.
    expect(report.volume).toBeGreaterThan(0.9);
    expect(report.volume).toBeLessThan(1.02);
  });

  it('안쪽을 향한 껍질도 같은 부피로 뽑는다', () => {
    const inward = box(0, 0, 0, 1, 1, 1, true);
    const report = expectPrintable(solidify(new TriangleBVH(buildSoup(inward).soup)).mesh);
    expect(report.volume).toBeGreaterThan(0.9);
  });

  it('겹친 두 상자를 한 덩어리로 합치고 관통을 없앤다', () => {
    const overlapping = merge(box(0, 0, 0, 1, 1, 1), box(0.5, 0.5, 0.5, 1.5, 1.5, 1.5));
    expect(validateMesh(overlapping).selfIntersections).toBeGreaterThan(0);
    const report = expectPrintable(solidify(new TriangleBVH(buildSoup(overlapping).soup)).mesh);
    expect(report.connectedComponents).toBe(1);
    // 합집합 부피는 1 + 1 - 0.125다. 두 껍질의 와인딩 넘버가 더해지므로 오목하게 만나는
    // 골에는 살이 조금 차오른다. 그 몫까지 5% 안으로 본다.
    expect(report.volume).toBeGreaterThan(1.85);
    expect(report.volume).toBeLessThan(1.875 * 1.05);
  });

  it('두께 없는 판에는 최소 두께를 준다', () => {
    const mesh = cubeWithFin();
    const bvh = new TriangleBVH(buildSoup(mesh).soup);
    const result = solidify(bvh);
    const report = expectPrintable(result.mesh);
    expect(result.stats.thickenedTriangles).toBeGreaterThan(0);
    // 판 넓이 0.6 × 0.6에 두께 약 2 × 0.9칸이 더해진다.
    const expected = 0.36 * 2 * result.stats.finRadius;
    expect(report.volume).toBeGreaterThan(0.9 + expected * 0.4);
    expect(report.connectedComponents).toBe(1);
  });

  it('바깥과 이어지지 않은 속 빈 공간을 채운다', () => {
    // 바깥 상자 안에 안쪽을 보는 작은 상자를 넣으면 속이 빈 상자가 된다.
    const hollow = merge(box(0, 0, 0, 1, 1, 1), box(0.3, 0.3, 0.3, 0.7, 0.7, 0.7, true));
    const filled = solidify(new TriangleBVH(buildSoup(hollow).soup));
    const kept = solidify(new TriangleBVH(buildSoup(hollow).soup), { fillVoids: false });
    expect(filled.stats.filledVoidPoints).toBeGreaterThan(0);
    expect(validateMesh(filled.mesh).connectedComponents).toBe(1);
    expect(validateMesh(kept.mesh).connectedComponents).toBe(2);
  });

  it('같은 입력은 비트 단위로 같은 결과를 낸다', () => {
    const run = () => solidify(new TriangleBVH(buildSoup(openCube()).soup)).mesh;
    const a = run();
    const b = run();
    expect(Buffer.from(a.positions.buffer).equals(Buffer.from(b.positions.buffer))).toBe(true);
    expect(Buffer.from(a.indices.buffer).equals(Buffer.from(b.indices.buffer))).toBe(true);
  });

  it('형상 보존 지표를 잰다', () => {
    const bvh = new TriangleBVH(buildSoup(cube()).soup);
    const result = solidify(bvh);
    const fidelity = measureFidelity(bvh, result.mesh, 1);
    expect(fidelity.inputCoverage).toBeGreaterThan(0.95);
    expect(fidelity.buriedRatio).toBe(0);
  });
});

describe('자동 선택', () => {
  it('구멍만 있는 입력은 원래 삼각형을 지키는 구멍 메우기로 끝낸다', () => {
    const result = runPipeline(openCube());
    expect(result.engine).toBe('patch');
    expect(result.repairedScore.total).toBe(100);
  });

  it('관통이 있는 입력은 솔리드화로 처리하고 보정 전보다 점수가 오른다', () => {
    const overlapping = merge(box(0, 0, 0, 1, 1, 1), box(0.5, 0.5, 0.5, 1.5, 1.5, 1.5));
    const result = runPipeline(overlapping);
    expect(result.engine).toBe('solid');
    expect(result.inputScore.items.find((item) => item.id === 'intersection')?.earned).toBe(0);
    expect(result.repairedScore.total).toBe(100);
    expect(result.repairedScore.total).toBeGreaterThan(result.inputScore.total);
    expect(result.solid).not.toBeNull();
    expect(result.fidelity).not.toBeNull();
    expect(result.afterDefectEdges.length).toBe(0);
    expect(result.beforeDefectEdges.length).toBe(0);
  });

  it('두께 없는 판이 붙은 입력은 겹친 모서리 때문에 솔리드화로 간다', () => {
    const result = runPipeline(cubeWithFin());
    expect(result.input.nonManifoldEdgeCount).toBeGreaterThan(0);
    expect(result.engine).toBe('solid');
    expect(result.repaired.nonManifoldEdgeCount).toBe(0);
    expect(result.repairedScore.total).toBe(100);
  });
});
