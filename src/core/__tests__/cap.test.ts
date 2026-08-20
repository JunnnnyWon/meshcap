import { describe, expect, it } from 'vitest';
import { runPipeline } from '../pipeline.ts';
import { buildTopology } from '../halfEdge.ts';
import { traceBoundaryLoops } from '../boundary.ts';
import { classifyLoops } from '../classify.ts';
import { computeBounds, triangleCount } from '../types.ts';
import {
  cube,
  explode,
  flippedTetrahedron,
  openCube,
  openCylinder,
  openTetrahedron,
  tetrahedron,
} from '../__fixtures__/shapes.ts';

function classify(mesh: ReturnType<typeof cube>, options = {}) {
  const topology = buildTopology(mesh);
  const loops = traceBoundaryLoops(topology);
  return classifyLoops(mesh, loops, options, computeBounds(mesh.positions));
}

describe('classifyLoops', () => {
  it('구멍을 메운 면이 향할 방향을 바깥으로 잡는다', () => {
    const [hole] = classify(openCube());
    // 윗면이 뚫린 정육면체이므로 뚜껑은 +Z를 향해야 한다.
    expect(hole.capNormal[2]).toBeCloseTo(1, 5);
  });

  it('평면 구멍의 평면성 지표가 0에 가깝다', () => {
    const loops = classify(openCylinder(24));
    for (const loop of loops) {
      expect(loop.planarity).toBeLessThan(1e-5);
    }
  });

  it('물결치는 테두리는 평면성 지표가 커진다', () => {
    const loops = classify(openCylinder(24, 1, 2, 0.5));
    const top = loops.find((l) => l.capNormal[1] > 0.5);
    expect(top?.planarity).toBeGreaterThan(0.1);
  });

  it('원기둥 바닥은 받침 전략으로, 윗면은 평면 전략으로 배정한다', () => {
    const loops = classify(openCylinder(24));
    const bottom = loops.find((l) => l.bottomFacing);
    const top = loops.find((l) => !l.bottomFacing);

    expect(bottom?.strategy).toBe('flatBase');
    expect(top?.strategy).toBe('planar');
  });

  it('비평면 구멍은 Liepa 삼각화로 넘긴다', () => {
    const loops = classify(openCylinder(24, 1, 2, 0.5), { disableFlatBase: true });
    const top = loops.find((l) => l.capNormal[1] > 0.5);
    expect(top?.strategy).toBe('liepa');
  });

  it('정점 수가 상한을 넘으면 평면 투영으로 폴백한다', () => {
    const loops = classify(openCylinder(64, 1, 2, 0.5), {
      disableFlatBase: true,
      liepaMaxVertices: 32,
    });
    const top = loops.find((l) => l.capNormal[1] > 0.5);
    expect(top?.strategy).toBe('planar');
  });

  it('정점 3개짜리 구멍은 삼각형 하나로 처리한다', () => {
    const [hole] = classify(openTetrahedron());
    expect(hole.strategy).toBe('single');
  });
});

describe('runPipeline', () => {
  it('열린 정육면체를 밀폐 상태로 만든다', () => {
    const result = runPipeline(openCube());

    expect(result.welded.watertight).toBe(false);
    expect(result.repaired.watertight).toBe(true);
    expect(result.repaired.eulerCharacteristic).toBe(2);
    expect(result.repairedScore.total).toBe(100);
  });

  it('메운 뒤 부피가 원래 정육면체와 같다', () => {
    const result = runPipeline(openCube());
    expect(result.repaired.volume).toBeCloseTo(1, 5);
  });

  it('닫힌 메시는 건드리지 않는다', () => {
    const result = runPipeline(cube());

    expect(result.holes).toHaveLength(0);
    expect(triangleCount(result.mesh)).toBe(12);
    expect(result.repairedScore.total).toBe(100);
  });

  it('분해된 정점을 용접해 구멍 오탐을 걷어낸다', () => {
    const result = runPipeline(explode(cube()));

    // 용접 전에는 모든 에지가 경계로 보인다.
    expect(result.raw.boundaryEdgeCount).toBe(36);
    expect(result.raw.boundaryLoopCount).toBeGreaterThan(0);

    // 용접만으로 결함이 사라지므로 메울 구멍이 없다.
    expect(result.welded.boundaryEdgeCount).toBe(0);
    expect(result.holes).toHaveLength(0);
    expect(result.repaired.watertight).toBe(true);
    expect(result.weldSummary.mergedVertices).toBe(28);
  });

  it('원기둥의 위아래 구멍을 서로 다른 전략으로 메운다', () => {
    const result = runPipeline(openCylinder(24));

    expect(result.holes).toHaveLength(2);
    const applied = result.holes.map((h) => h.appliedStrategy).sort();
    expect(applied).toEqual(['flatBase', 'planar']);
    expect(result.repaired.watertight).toBe(true);
  });

  it('바닥 받침은 옆벽과 접지면을 함께 만든다', () => {
    const result = runPipeline(openCylinder(24));
    const base = result.holes.find((h) => h.appliedStrategy === 'flatBase');

    // 옆벽 2n개에 접지면 n-2개, 새 정점은 n개다.
    expect(base?.addedVertices).toBe(24);
    expect(base?.addedTriangles).toBe(24 * 2 + 22);
  });

  it('평면 삼각화는 새 정점 없이 n-2개 삼각형을 만든다', () => {
    const result = runPipeline(openCylinder(24));
    const planar = result.holes.find((h) => h.appliedStrategy === 'planar');

    expect(planar?.addedVertices).toBe(0);
    expect(planar?.addedTriangles).toBe(22);
  });

  it('Liepa 삼각화는 Steiner 정점을 넣을 수 있고 그래도 밀폐된다', () => {
    const result = runPipeline(openCylinder(24, 1, 2, 0.5), { disableFlatBase: true });
    const liepa = result.holes.find((h) => h.appliedStrategy === 'liepa');

    expect(liepa?.addedTriangles).toBeGreaterThanOrEqual(22);
    expect(result.repaired.watertight).toBe(true);
  });

  it('물결치는 구멍도 밀폐되고 관통이 생기지 않는다', () => {
    const result = runPipeline(openCylinder(32, 1, 2, 0.4));

    expect(result.repaired.watertight).toBe(true);
    expect(result.repaired.capSelfIntersections).toBe(0);
  });

  it('뒤집힌 면의 방향을 되돌린다', () => {
    const result = runPipeline(flippedTetrahedron());

    expect(result.welded.inconsistentEdgeCount).toBeGreaterThan(0);
    expect(result.repaired.inconsistentEdgeCount).toBe(0);
    expect(result.orientSummary.flippedTriangles).toBeGreaterThan(0);
  });

  it('안쪽을 향하던 법선을 바깥으로 돌린다', () => {
    const inward = tetrahedron();
    const flipped = new Uint32Array(inward.indices.length);
    for (let t = 0; t < inward.indices.length; t += 3) {
      flipped[t] = inward.indices[t];
      flipped[t + 1] = inward.indices[t + 2];
      flipped[t + 2] = inward.indices[t + 1];
    }

    const result = runPipeline({ positions: inward.positions, indices: flipped });
    expect(result.orientSummary.invertedShells).toBe(1);
    expect(result.repaired.volume).toBeGreaterThan(0);
  });

  it('진단 전용 모드에서는 메시를 바꾸지 않는다', () => {
    const result = runPipeline(openCube(), { diagnoseOnly: true });

    expect(result.holes).toHaveLength(1);
    expect(result.holes[0].addedTriangles).toBe(0);
    expect(triangleCount(result.mesh)).toBe(10);
    expect(result.repaired.watertight).toBe(false);
  });

  it('보정 후 점수가 보정 전보다 높아진다', () => {
    const result = runPipeline(openCylinder(24));
    expect(result.repairedScore.total).toBeGreaterThan(result.weldedScore.total);
    expect(result.weldedScore.grade).not.toBe('A');
    expect(result.repairedScore.grade).toBe('A');
  });

  it('처리 시간을 단계별로 기록한다', () => {
    const result = runPipeline(openCylinder(24));
    expect(result.timings.total).toBeGreaterThanOrEqual(0);
    expect(result.timings.cap).toBeGreaterThanOrEqual(0);
  });
});
