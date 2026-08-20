import { describe, expect, it } from 'vitest';
import { runPipeline } from '../pipeline.ts';
import { buildTopology } from '../halfEdge.ts';
import { EdgeIncidence } from '../incidence.ts';
import { splitNonManifold } from '../splitNonManifold.ts';
import { closeGaps } from '../gapClose.ts';
import { nonManifoldFan, nonManifoldFin, openCube, planeWithPinhole, gappedQuads } from '../__fixtures__/shapes.ts';
import { triangleCount } from '../types.ts';

describe('비다양체 분리', () => {
  it('면 셋이 공유하던 에지의 고립된 여분 면을 제거해 비다양체를 없앤다', () => {
    const before = buildTopology(nonManifoldFan());
    expect(before.nonManifoldEdgeCount).toBe(1);

    const { mesh, splitEdges } = splitNonManifold(nonManifoldFan());
    expect(splitEdges).toBeGreaterThan(0);
    expect(triangleCount(mesh)).toBe(2);
    expect(buildTopology(mesh).nonManifoldEdgeCount).toBe(0);
  });

  it('이어진 여분 시트는 정점을 복제해 떼어 낸다', () => {
    const { mesh, clonedVertices } = splitNonManifold(nonManifoldFin());
    expect(clonedVertices).toBeGreaterThan(0);
    expect(buildTopology(mesh).connectedComponents).toBe(2);
  });
});

describe('비다양체 가드', () => {
  it('면이 이미 둘인 에지에 뚜껑을 붙이지 않는다', () => {
    const incidence = new EdgeIncidence(nonManifoldFan());
    // 세 면이 공유하는 에지 (0,1)
    expect(incidence.count(0, 1)).toBeGreaterThanOrEqual(3);
    expect(incidence.wouldCreateNonManifold(0, 1, 2)).toBe(true);
  });

  it('열린 정육면체를 메워도 비다양체 에지가 생기지 않는다', () => {
    const result = runPipeline(openCube());
    expect(result.repaired.watertight).toBe(true);
    expect(result.repaired.nonManifoldEdgeCount).toBe(0);
    expect(result.repairedScore.total).toBe(100);
  });
});

describe('미세 구멍 붕괴', () => {
  it('큰 평면에 난 핀홀은 삼각형을 넣지 않고 한 점으로 모은다', () => {
    const result = runPipeline(planeWithPinhole());
    const collapsed = result.holes.filter((h) => h.appliedStrategy === 'collapse');
    expect(collapsed.length).toBeGreaterThan(0);
    expect(collapsed.every((h) => h.addedTriangles === 0)).toBe(true);
    expect(result.repairSummary.collapsedHoles).toBeGreaterThan(0);
    expect(result.repaired.watertight).toBe(true);
  });
});

describe('갭 클로징', () => {
  it('이미 닫힌 테두리는 건드리지 않는다', () => {
    const { mesh, mergedPairs, snappedToEdge } = closeGaps(openCube());
    expect(mergedPairs).toBe(0);
    expect(snappedToEdge).toBe(0);
    expect(triangleCount(mesh)).toBe(triangleCount(openCube()));
  });

  it('좁은 틈으로 마주 본 테두리를 붙여 닫힌 루프로 만든다', () => {
    const before = buildTopology(gappedQuads());
    expect(before.boundaryEdgeCount).toBeGreaterThan(0);

    const { mesh, mergedPairs } = closeGaps(gappedQuads());
    expect(mergedPairs).toBeGreaterThan(0);
    expect(buildTopology(mesh).boundaryEdgeCount).toBeLessThan(before.boundaryEdgeCount);
  });
});
