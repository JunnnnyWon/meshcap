import type { CapStrategy } from '../classify.ts';
import { capFan, capSingle } from './fan.ts';
import { capPlanar } from './planar.ts';
import { capLiepa } from './liepa.ts';
import { capFlatBase } from './flatBase.ts';
import type { CapContext, CapPatch } from './types.ts';
import { EMPTY_PATCH } from './types.ts';

export type { CapContext, CapPatch } from './types.ts';
export { capFan, capSingle } from './fan.ts';
export { capPlanar } from './planar.ts';
export { capLiepa } from './liepa.ts';
export { capFlatBase } from './flatBase.ts';

export interface CapOutcome extends CapPatch {
  /** 실제로 사용된 전략. 폴백이 일어났으면 분류 결과와 다를 수 있다. */
  appliedStrategy: CapStrategy;
  /** 원래 배정된 전략이 결과를 내지 못해 다른 방식으로 넘어갔는지. */
  fellBack: boolean;
}

function run(strategy: CapStrategy, ctx: CapContext): CapPatch {
  switch (strategy) {
    case 'single':
      return capSingle(ctx);
    case 'fan':
      return capFan(ctx);
    case 'planar':
      return capPlanar(ctx);
    case 'liepa':
      return capLiepa(ctx);
    case 'flatBase':
      return capFlatBase(ctx);
    case 'skip':
      return EMPTY_PATCH;
  }
}

/**
 * 분류 결과에 따라 구멍 하나를 메운다.
 *
 * 자기교차하는 테두리처럼 병적인 입력에서는 earcut이나 동적계획법이 삼각형을
 * 하나도 못 내놓을 수 있다. 그럴 때 구멍을 그대로 두면 출력이 실패하므로,
 * 품질은 떨어지더라도 항상 닫히는 부채꼴로 넘어간다.
 */
export function applyCap(ctx: CapContext): CapOutcome {
  const planned = ctx.metrics.strategy;
  const primary = run(planned, ctx);

  if (primary.triangles.length > 0 || planned === 'skip') {
    return { ...primary, appliedStrategy: planned, fellBack: false };
  }

  const fallback = capFan(ctx);
  return {
    ...fallback,
    appliedStrategy: 'fan',
    fellBack: fallback.triangles.length > 0,
  };
}
