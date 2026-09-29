import { describe, expect, it } from 'vitest';
import { runPipeline, type PipelineOptions } from '../pipeline.ts';
import type { MeshData } from '../types.ts';
import { capLiepa } from '../cap/liepa.ts';
import { refineAndFair } from '../cap/refine.ts';
import { buildTopology } from '../halfEdge.ts';
import { traceBoundaryLoops, traceFillableLoops } from '../boundary.ts';
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
  nonManifoldFan,
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

  it('비평면 작은 구멍은 Liepa 삼각화로 넘긴다', () => {
    const loops = classify(openCylinder(8, 1, 2, 0.5), { disableFlatBase: true });
    const top = loops.find((l) => l.capNormal[1] > 0.5);
    expect(top?.strategy).toBe('liepa');
  });

  it('닫힌 중형 비평면 구멍은 Liepa 삼각화로 넘긴다', () => {
    const loops = classify(openCylinder(24, 1, 2, 0.5), { disableFlatBase: true });
    const top = loops.find((l) => l.capNormal[1] > 0.5);
    expect(top?.strategy).toBe('liepa');
  });

  it('Liepa 상한을 넘는 비평면 구멍은 전진 전면으로 넘긴다', () => {
    const loops = classify(openCylinder(64, 1, 2, 0.5), {
      disableFlatBase: true,
      liepaMaxVertices: 32,
    });
    const top = loops.find((l) => l.capNormal[1] > 0.5);
    expect(top?.strategy).toBe('front');
  });

  it('정점 수가 전면 상한을 넘으면 복셀 랩으로 넘긴다', () => {
    const loops = classify(openCylinder(64, 1, 2, 0.5), {
      disableFlatBase: true,
      liepaMaxVertices: 16,
      frontMaxVertices: 32,
    });
    const top = loops.find((l) => l.capNormal[1] > 0.5);
    expect(top?.strategy).toBe('wrap');
  });

  it('정점 3개짜리 구멍은 삼각형 하나로 처리한다', () => {
    const [hole] = classify(openTetrahedron());
    expect(hole.strategy).toBe('single');
  });
});

/** 구멍 메우기의 세부 동작을 본다. 자동 선택이 솔리드화로 바꾸지 않게 고정한다. */
function runPatch(mesh: MeshData, options: PipelineOptions = {}) {
  return runPipeline(mesh, { engine: 'patch', ...options });
}

describe('runPipeline', () => {
  it('열린 정육면체를 밀폐 상태로 만든다', () => {
    const result = runPatch(openCube());

    expect(result.input.watertight).toBe(false);
    expect(result.repaired.watertight).toBe(true);
    expect(result.repaired.eulerCharacteristic).toBe(2);
    expect(result.repairedScore.total).toBe(100);
  });

  it('메운 뒤 부피가 원래 정육면체와 같다', () => {
    const result = runPatch(openCube());
    expect(result.repaired.volume).toBeCloseTo(1, 5);
  });

  it('닫힌 메시는 건드리지 않는다', () => {
    const result = runPatch(cube());

    expect(result.holes).toHaveLength(0);
    expect(triangleCount(result.mesh)).toBe(12);
    expect(result.repairedScore.total).toBe(100);
  });

  it('분해된 정점은 올린 그대로 잴 때부터 합쳐 구멍으로 치지 않는다', () => {
    const result = runPatch(explode(cube()));

    // 좌표가 완전히 같은 점은 올린 그대로에서도 합친다. 슬라이서가 STL을 읽는 방식이다.
    expect(result.input.boundaryEdgeCount).toBe(0);
    expect(result.inputSummary.mergedVertices).toBe(28);
    expect(result.inputScore.total).toBe(100);

    expect(result.holes).toHaveLength(0);
    expect(result.repaired.watertight).toBe(true);
    expect(result.patch!.weldSummary.mergedVertices).toBe(28);
  });

  it('원기둥의 위아래 구멍을 서로 다른 전략으로 메운다', () => {
    const result = runPatch(openCylinder(24));

    expect(result.holes).toHaveLength(2);
    const applied = result.holes.map((h) => h.appliedStrategy).sort();
    expect(applied).toEqual(['flatBase', 'planar']);
    expect(result.repaired.watertight).toBe(true);
  });

  it('바닥 받침은 옆벽과 접지면을 함께 만든다', () => {
    const result = runPatch(openCylinder(24));
    const base = result.holes.find((h) => h.appliedStrategy === 'flatBase');

    // 옆벽 2n개에 접지면 n-2개, 새 정점은 n개다.
    expect(base?.addedVertices).toBe(24);
    expect(base?.addedTriangles).toBe(24 * 2 + 22);
  });

  it('평면 삼각화는 새 정점 없이 n-2개 삼각형을 만든다', () => {
    const result = runPatch(openCylinder(24));
    const planar = result.holes.find((h) => h.appliedStrategy === 'planar');

    expect(planar?.addedVertices).toBe(0);
    expect(planar?.addedTriangles).toBe(22);
  });

  it('Liepa 삼각화는 Steiner 정점을 넣을 수 있고 그래도 밀폐된다', () => {
    const result = runPatch(openCylinder(8, 1, 2, 0.5), { disableFlatBase: true });
    const liepa = result.holes.find((h) => h.appliedStrategy === 'liepa');

    expect(liepa?.addedTriangles).toBeGreaterThanOrEqual(6);
    expect(result.repaired.watertight).toBe(true);
  });

  it('주변보다 성긴 비평면 뚜껑에는 Steiner 정점을 넣는다', () => {
    const mesh = openCylinder(16, 2, 2, 0.8);
    const topology = buildTopology(mesh);
    const loops = traceBoundaryLoops(topology);
    const metrics = classifyLoops(mesh, loops, { disableFlatBase: true }, computeBounds(mesh.positions));
    const top = metrics.find((m) => m.capNormal[1] > 0.5);
    expect(top?.strategy).toBe('liepa');

    const meanEdge = new Float32Array(mesh.positions.length / 3);
    meanEdge.fill(0.04);
    const ctx = {
      mesh,
      metrics: top!,
      baseVertexCount: mesh.positions.length / 3,
      bounds: computeBounds(mesh.positions),
      upIndex: 1,
      vertexMeanEdge: meanEdge,
    };
    const patch = capLiepa(ctx);
    const refined = refineAndFair(ctx, patch);
    expect(refined.newPositions.length / 3).toBeGreaterThan(0);
  });

  it('물결치는 구멍도 밀폐되고 관통이 생기지 않는다', () => {
    const result = runPatch(openCylinder(32, 1, 2, 0.4));

    expect(result.repaired.watertight).toBe(true);
    expect(result.repaired.selfIntersectionChecked).toBe(true);
    expect(result.repaired.selfIntersections).toBe(0);
  });

  it('뒤집힌 면의 방향을 되돌린다', () => {
    const result = runPatch(flippedTetrahedron());

    expect(result.input.inconsistentEdgeCount).toBeGreaterThan(0);
    expect(result.repaired.inconsistentEdgeCount).toBe(0);
    expect(result.patch!.orientSummary.flippedTriangles).toBeGreaterThan(0);
  });

  it('안쪽을 향하던 법선을 바깥으로 돌린다', () => {
    const inward = tetrahedron();
    const flipped = new Uint32Array(inward.indices.length);
    for (let t = 0; t < inward.indices.length; t += 3) {
      flipped[t] = inward.indices[t];
      flipped[t + 1] = inward.indices[t + 2];
      flipped[t + 2] = inward.indices[t + 1];
    }

    const result = runPatch({ positions: inward.positions, indices: flipped });
    expect(result.patch!.orientSummary.invertedShells).toBe(1);
    expect(result.repaired.volume).toBeGreaterThan(0);
  });

  it('진단 전용 모드에서는 메시를 바꾸지 않는다', () => {
    const result = runPatch(openCube(), { diagnoseOnly: true });

    expect(result.holes).toHaveLength(1);
    expect(result.holes[0].addedTriangles).toBe(0);
    expect(triangleCount(result.mesh)).toBe(10);
    expect(result.repaired.watertight).toBe(false);
  });

  it('보정 후 점수가 보정 전보다 높아진다', () => {
    const result = runPatch(openCylinder(24));
    expect(result.repairedScore.total).toBeGreaterThan(result.inputScore.total);
    expect(result.inputScore.grade).not.toBe('A');
    expect(result.repairedScore.grade).toBe('A');
  });

  it('처리 시간을 단계별로 기록한다', () => {
    const result = runPatch(openCylinder(24));
    expect(result.timings.total).toBeGreaterThanOrEqual(0);
    const ids = result.timings.phases.map((phase) => phase.id);
    expect(ids).toContain('diagnose');
    expect(ids).toContain('patch-cap');
    expect(ids).toContain('validate');
    expect(result.timings.phases.every((phase) => phase.ms >= 0)).toBe(true);
  });
});

describe('열린 사슬과 시각 부착', () => {
  it('면이 하나인 테두리만 모으면 끊기는 사슬을 skip하지 않는다', () => {
    const mesh = nonManifoldFan();
    const topology = buildTopology(mesh);
    const loops = traceFillableLoops(topology);
    const open = loops.filter((loop) => !loop.closed);
    expect(open.length).toBeGreaterThan(0);

    const metrics = classifyLoops(mesh, open, { disableFlatBase: true }, computeBounds(mesh.positions));
    expect(metrics.every((hole) => hole.strategy !== 'skip' || hole.vertices.length < 3)).toBe(true);
    expect(metrics.some((hole) => hole.strategy === 'front' || hole.strategy === 'single')).toBe(true);
  });

  it('거의 닫힌 열린 사슬은 가상으로 닫아 메운다', () => {
    const mesh = openCube();
    const loops = [{ vertices: [4, 5, 6, 7], closed: false }];
    const [hole] = classifyLoops(mesh, loops, {}, computeBounds(mesh.positions));
    expect(hole.strategy).not.toBe('skip');
  });
});
