import { describe, expect, it } from 'vitest';
import { countSelfIntersections } from '../intersect.ts';
import { buildTopology } from '../halfEdge.ts';
import { localizationVerdict, summarizeDefects, type DefectSummary } from '../defectRegions.ts';
import { cube, nonManifoldFan, openCube } from '../__fixtures__/shapes.ts';
import type { MeshData } from '../types.ts';

function shifted(source: MeshData, dx: number, dy: number, dz: number): MeshData {
  const positions = new Float32Array(source.positions.length);
  for (let i = 0; i < source.positions.length; i += 3) {
    positions[i] = source.positions[i] + dx;
    positions[i + 1] = source.positions[i + 1] + dy;
    positions[i + 2] = source.positions[i + 2] + dz;
  }
  return { positions, indices: new Uint32Array(source.indices) };
}

function merge(a: MeshData, b: MeshData): MeshData {
  const offset = a.positions.length / 3;
  const positions = new Float32Array(a.positions.length + b.positions.length);
  positions.set(a.positions);
  positions.set(b.positions, a.positions.length);
  const indices = new Uint32Array(a.indices.length + b.indices.length);
  indices.set(a.indices);
  for (let i = 0; i < b.indices.length; i++) indices[a.indices.length + i] = b.indices[i] + offset;
  return { positions, indices };
}

/** 임계값 판정만 따로 시험하려고 요약을 손으로 만든다. */
function summaryStub(overrides: Partial<DefectSummary>): DefectSummary {
  return {
    triangleCount: 1_000,
    surfaceArea: 100,
    modelDiagonal: 10,
    nonManifoldEdges: 0,
    openEdges: 0,
    intersectingPairs: 1,
    pairsComplete: true,
    intersectingTriangles: 2,
    regions: [],
    areaRatio: 0.01,
    maxRegionDiagonalRatio: 0.1,
    ...overrides,
  };
}

function regionStub(id: number, triangleCount: number, tooBig = false) {
  return {
    id,
    triangles: [],
    triangleCount,
    area: 1,
    min: [0, 0, 0] as [number, number, number],
    max: [1, 1, 1] as [number, number, number],
    diagonal: 1,
    causes: { nonManifold: triangleCount, intersecting: 0, open: 0 },
    tooBig,
  };
}

describe('결함 지역 찾기', () => {
  it('닫혀 있고 겹침이 없는 메시에는 결함 지역이 없다', () => {
    const summary = summarizeDefects(cube());

    expect(summary.regions).toHaveLength(0);
    expect(summary.areaRatio).toBe(0);
    expect(summary.nonManifoldEdges).toBe(0);
    expect(summary.intersectingPairs).toBe(0);
    expect(localizationVerdict(summary).localized).toBe(true);
  });

  it('구멍은 열린 모서리로 잡고, 겹침·관통만 볼 때는 빠진다', () => {
    const all = summarizeDefects(openCube());
    expect(all.openEdges).toBeGreaterThan(0);
    expect(all.regions.length).toBeGreaterThan(0);
    expect(all.regions[0].causes.open).toBeGreaterThan(0);
    expect(all.regions[0].causes.intersecting).toBe(0);

    // 구멍은 구멍 메우기 몫이라, 겹침·관통만 보면 결함이 없다.
    const tangledOnly = summarizeDefects(openCube(), { includeOpenEdges: false });
    expect(tangledOnly.regions).toHaveLength(0);
  });

  it('여유 링을 넓히면 지역이 커진다', () => {
    const narrow = summarizeDefects(openCube(), { ringLayers: 0 });
    const wide = summarizeDefects(openCube(), { ringLayers: 2 });

    expect(wide.regions[0].triangleCount).toBeGreaterThan(narrow.regions[0].triangleCount);
  });

  it('면 셋이 모인 에지를 목록으로 내보낸다', () => {
    const topology = buildTopology(nonManifoldFan());

    // 세 삼각형이 정점 0-1 에지를 함께 쓴다.
    expect(topology.nonManifoldEdgeCount).toBe(1);
    expect(Array.from(topology.nonManifoldLo)).toEqual([0]);
    expect(Array.from(topology.nonManifoldHi)).toEqual([1]);
    expect(topology.nonManifoldFace).toHaveLength(1);

    const summary = summarizeDefects(nonManifoldFan());
    expect(summary.nonManifoldEdges).toBe(1);
    expect(summary.regions.some((region) => region.causes.nonManifold > 0)).toBe(true);
  });

  it('뚫고 지나가는 쌍을 모아 어느 면인지 알려 준다', () => {
    const overlapping = merge(cube(), shifted(cube(), 0.5, 0.5, 0.5));
    const pairs: number[] = [];
    const counted = countSelfIntersections(overlapping, { pairs });

    expect(counted.count).toBeGreaterThan(0);
    expect(pairs).toHaveLength(counted.count * 2);
    expect(pairs.every((t) => t >= 0 && t < overlapping.indices.length / 3)).toBe(true);

    const summary = summarizeDefects(overlapping);
    expect(summary.intersectingPairs).toBe(counted.count);
    expect(summary.intersectingTriangles).toBeGreaterThan(0);
    expect(summary.regions.some((region) => region.causes.intersecting > 0)).toBe(true);
  });

  it('쌍 수집은 개수 세기와 결과가 같다', () => {
    const overlapping = merge(cube(), shifted(cube(), 0.5, 0.5, 0.5));
    expect(countSelfIntersections(overlapping, { pairs: [] })).toEqual(countSelfIntersections(overlapping));
  });
});

describe('국소성 판정', () => {
  it('겹침도 관통도 없으면 국소적으로 본다', () => {
    // 구멍은 구멍 메우기 몫이라, 아무리 많아도 국소 수리 판정을 막지 않는다.
    const verdict = localizationVerdict(
      summaryStub({
        nonManifoldEdges: 0,
        intersectingPairs: 0,
        intersectingTriangles: 0,
        regions: [regionStub(0, 5_000), regionStub(1, 5_000)],
        areaRatio: 0.9,
      }),
    );
    expect(verdict.localized).toBe(true);
    expect(verdict.reasons).toHaveLength(1);
  });

  it('덩어리가 많으면 국소적이지 않다고 본다', () => {
    const regions = Array.from({ length: 9 }, (_, i) => regionStub(i, 100));
    const verdict = localizationVerdict(summaryStub({ regions }));

    expect(verdict.localized).toBe(false);
    expect(verdict.reasons.join(' ')).toContain('9곳');
  });

  it('한 덩어리가 너무 크면 국소적이지 않다고 본다', () => {
    const verdict = localizationVerdict(summaryStub({ regions: [regionStub(0, 50_000, true)] }));

    expect(verdict.localized).toBe(false);
    expect(verdict.reasons.join(' ')).toContain('국소 범위를 넘습니다');
  });

  it('결함 면적이 넓거나 대각이 크면 국소적이지 않다고 본다', () => {
    const wide = localizationVerdict(summaryStub({ regions: [regionStub(0, 100)], areaRatio: 0.4 }));
    expect(wide.localized).toBe(false);
    expect(wide.reasons.join(' ')).toContain('40.0%');

    const long = localizationVerdict(summaryStub({ regions: [regionStub(0, 100)], maxRegionDiagonalRatio: 0.8 }));
    expect(long.localized).toBe(false);
    expect(long.reasons.join(' ')).toContain('80%');
  });

  it('관통 쌍을 끝까지 못 세면 그 사실을 남긴다', () => {
    const verdict = localizationVerdict(summaryStub({ regions: [regionStub(0, 100)], pairsComplete: false }));
    expect(verdict.reasons.join(' ')).toContain('끝까지 세지 못했습니다');
  });

  it('임계값을 넘기면 판정이 바뀐다', () => {
    const regions = Array.from({ length: 9 }, (_, i) => regionStub(i, 100));
    expect(localizationVerdict(summaryStub({ regions }), { maxRegions: 12 }).localized).toBe(true);
  });
});
