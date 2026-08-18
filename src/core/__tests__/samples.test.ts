import { describe, expect, it } from 'vitest';
import { runPipeline } from '../pipeline.ts';
import { SAMPLES } from '../../samples/index.ts';

const bust = SAMPLES.find((s) => s.id === 'bust');
const wavy = SAMPLES.find((s) => s.id === 'wavy');

describe('합성 샘플 회귀', () => {
  it('결함 흉상을 완전히 밀폐한다', () => {
    const result = runPipeline(bust!.build(), { upAxis: bust!.upAxis });

    expect(result.repaired.watertight).toBe(true);
    expect(result.holes.every((hole) => hole.closed)).toBe(true);
    expect(result.holes.every((hole) => hole.appliedStrategy !== 'skip')).toBe(true);
    expect(result.repairedScore.total).toBeGreaterThanOrEqual(95);
  });

  it('물결 개구부 튜브를 완전히 밀폐한다', () => {
    const result = runPipeline(wavy!.build(), { upAxis: wavy!.upAxis });

    expect(result.repaired.watertight).toBe(true);
    expect(result.holes).toHaveLength(2);
    expect(result.repairedScore.total).toBe(100);
  });
});

describe('법선 정렬 순서에 대한 절제 실험', () => {
  /**
   * 이 두 테스트가 파이프라인에서 법선 정렬이 구멍 탐지보다 앞서야 하는 이유를
   * 수치로 남긴다. 뒤집힌 면이 구멍 테두리에 닿으면 그 지점에서 경계 에지의
   * 진행 방향이 반전되어, 하나였던 테두리가 여러 개의 열린 사슬로 쪼개진다.
   */
  it('정렬을 건너뛰면 테두리가 열린 사슬로 쪼개진다', () => {
    const result = runPipeline(bust!.build(), { upAxis: bust!.upAxis, skipOrient: true });

    const openChains = result.holes.filter((hole) => !hole.closed);
    expect(openChains.length).toBeGreaterThan(0);
    expect(result.repaired.watertight).toBe(false);
  });

  it('정렬을 먼저 하면 같은 모델의 테두리가 모두 닫힌다', () => {
    const withOrient = runPipeline(bust!.build(), { upAxis: bust!.upAxis });
    const withoutOrient = runPipeline(bust!.build(), { upAxis: bust!.upAxis, skipOrient: true });

    expect(withOrient.holes.length).toBeLessThan(withoutOrient.holes.length);
    expect(withOrient.repairedScore.total).toBeGreaterThan(withoutOrient.repairedScore.total);
  });
});
