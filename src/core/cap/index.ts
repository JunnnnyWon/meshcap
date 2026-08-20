import type { CapStrategy } from '../classify.ts';
import { capFan, capSingle } from './fan.ts';
import { capPlanar } from './planar.ts';
import { capLiepa } from './liepa.ts';
import { capFlatBase } from './flatBase.ts';
import { refineAndFair } from './refine.ts';
import { projectCsrbf, shouldProjectCsrbf } from './csrbf.ts';
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
    case 'collapse':
    case 'skip':
      return EMPTY_PATCH;
  }
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/**
 * 이미 면이 둘인 에지에 세 번째 면을 붙이면 패치 전체를 버린다.
 * 진짜 구멍의 테두리는 면이 하나이므로 통과하고, 비다양체 잉여는 거절된다.
 */
function commitManifold(ctx: CapContext, patch: CapPatch): CapPatch {
  const faceCount = ctx.edgeFaceCount;
  const commit = ctx.commitTriangle;
  if (!faceCount || patch.triangles.length === 0) return patch;

  const bonus = new Map<string, number>();
  const count = (a: number, b: number) => faceCount(a, b) + (bonus.get(edgeKey(a, b)) ?? 0);
  const bump = (a: number, b: number) => {
    const key = edgeKey(a, b);
    bonus.set(key, (bonus.get(key) ?? 0) + 1);
  };

  for (let i = 0; i < patch.triangles.length; i += 3) {
    const a = patch.triangles[i];
    const b = patch.triangles[i + 1];
    const c = patch.triangles[i + 2];
    if (a === b || b === c || c === a) return EMPTY_PATCH;
    const edges: [number, number][] = [
      [a, b],
      [b, c],
      [c, a],
    ];
    for (const [u, v] of edges) {
      if (count(u, v) >= 2) return EMPTY_PATCH;
    }
    for (const [u, v] of edges) bump(u, v);
  }

  for (let i = 0; i < patch.triangles.length; i += 3) {
    commit?.(patch.triangles[i], patch.triangles[i + 1], patch.triangles[i + 2]);
  }
  return patch;
}

/**
 * 분류 결과에 따라 구멍 하나를 메운다.
 *
 * 자기교차하는 테두리처럼 병적인 입력에서는 earcut이나 동적계획법이 삼각형을
 * 하나도 못 내놓을 수 있다. 그럴 때 구멍을 그대로 두면 출력이 실패하므로,
 * 품질은 떨어지더라도 항상 닫히는 부채꼴로 넘어간다. 다만 면이 이미 둘인
 * 에지에 네 번째 면을 붙이는 부채꼴은 거절한다.
 */
export function applyCap(ctx: CapContext): CapOutcome {
  const planned = ctx.metrics.strategy;
  if (planned === 'skip' || planned === 'collapse') {
    return { ...EMPTY_PATCH, appliedStrategy: planned, fellBack: false };
  }

  let primary = run(planned, ctx);
  if (planned === 'liepa' && primary.triangles.length > 0) {
    primary = refineAndFair(ctx, primary);
    if (shouldProjectCsrbf(ctx)) primary = projectCsrbf(ctx, primary);
  }
  primary = commitManifold(ctx, primary);

  if (primary.triangles.length > 0) {
    return { ...primary, appliedStrategy: planned, fellBack: false };
  }

  let fallback = capFan(ctx);
  fallback = commitManifold(ctx, fallback);
  return {
    ...fallback,
    appliedStrategy: fallback.triangles.length > 0 ? 'fan' : planned,
    fellBack: fallback.triangles.length > 0,
  };
}
