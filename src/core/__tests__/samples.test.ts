import { describe, expect, it } from 'vitest';
import { runPipeline } from '../pipeline.ts';
import { buildTopology } from '../halfEdge.ts';
import { traceBoundaryLoops } from '../boundary.ts';
import { cube, nonManifoldFan } from '../__fixtures__/shapes.ts';
import { proceduralSample } from '../../samples/index.ts';

const bust = proceduralSample('bust');
const wavy = proceduralSample('wavy');

describe('합성 샘플 회귀', () => {
  it('결함 회전체를 완전히 밀폐한다', () => {
    const result = runPipeline(bust.build(), { upAxis: bust.upAxis });

    expect(result.repaired.watertight).toBe(true);
    expect(result.holes.every((hole) => hole.closed)).toBe(true);
    expect(result.holes.every((hole) => hole.appliedStrategy !== 'skip')).toBe(true);
    expect(result.repairedScore.total).toBeGreaterThanOrEqual(95);
  });

  it('물결 개구부 튜브를 완전히 밀폐한다', () => {
    const result = runPipeline(wavy.build(), { upAxis: wavy.upAxis });

    expect(result.repaired.watertight).toBe(true);
    expect(result.holes).toHaveLength(2);
    expect(result.repairedScore.total).toBe(100);
  });
});

describe('법선 정렬 순서에 대한 절제 실험', () => {
  /**
   * 파이프라인에서 법선 정렬이 구멍 탐지보다 앞서야 하는 이유를 수치로 남긴다.
   *
   * 감는 방향이 뒤집힌 면은 자기 에지 세 개의 방향 짝을 깨뜨린다. 테두리 추적은
   * 짝을 찾지 못한 half-edge를 모으는 방식이므로, 정렬하지 않으면 뒤집힌 면의
   * 둘레가 통째로 구멍처럼 보인다. 면이 이미 둘인 에지에는 뚜껑을 붙이지 않으므로
   * 없는 삼각형이 대량으로 덧붙지는 않지만, 탐지 목록과 점수는 크게 나빠진다.
   */
  it('정렬을 건너뛰면 뒤집힌 면 때문에 보정 점수가 떨어진다', () => {
    const withOrient = runPipeline(bust.build(), { upAxis: bust.upAxis });
    const without = runPipeline(bust.build(), { upAxis: bust.upAxis, skipOrient: true });

    // 메우기는 면이 하나인 테두리만 따라가므로 가짜 구멍이 목록에 안 쌓인다.
    // 방향이 엇갈린 모서리와 점수는 정렬을 빼면 분명히 나빠진다.
    expect(without.repaired.inconsistentEdgeCount).toBeGreaterThan(withOrient.repaired.inconsistentEdgeCount);
    expect(without.repairedScore.total).toBeLessThan(withOrient.repairedScore.total);
  });
});

describe('비다양체 지점을 지나는 테두리 추적', () => {
  /**
   * 면 세 개가 한 에지를 공유하면 그 에지는 어느 한 방향으로 짝이 하나 남는다.
   * 이 남은 half-edge를 테두리에 포함시키지 않으면 순회가 그 자리에서 끊겨
   * 열린 사슬이 되고, 어디까지가 구멍인지 확정할 수 없어 메울 수 없게 된다.
   *
   * 짝짓기는 모든 정점에서 진입 차수와 진출 차수를 똑같이 줄이므로, 남은
   * half-edge 집합은 항상 균형이 맞고 따라서 순회가 반드시 닫힌다.
   */
  it('세 면이 공유하는 에지가 있어도 테두리가 닫힌다', () => {
    const loops = traceBoundaryLoops(buildTopology(nonManifoldFan()));

    expect(loops.length).toBeGreaterThan(0);
    expect(loops.every((loop) => loop.closed)).toBe(true);
  });

  it('짝을 찾지 못한 half-edge 수를 따로 집계한다', () => {
    const topology = buildTopology(nonManifoldFan());

    // 에지 (0,1)을 세 면이 같은 방향으로 지나므로 세 개가 남는다.
    expect(topology.nonManifoldEdgeCount).toBe(1);
    expect(topology.unmatchedHalfEdgeCount).toBeGreaterThan(topology.boundaryEdgeCount);
  });

  it('닫힌 메시에는 남는 half-edge가 없다', () => {
    expect(buildTopology(cube()).unmatchedHalfEdgeCount).toBe(0);
  });
});
