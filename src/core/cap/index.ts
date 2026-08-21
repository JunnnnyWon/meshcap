import type { CapStrategy } from '../classify.ts';
import { DEFAULT_CLASSIFY_OPTIONS } from '../classify.ts';
import { centroidOf, vertexAt } from '../geom.ts';
import { closesVisibleTear } from '../incidence.ts';
import { capFan, capSingle } from './fan.ts';
import { capPlanar } from './planar.ts';
import { capLiepa } from './liepa.ts';
import { capFlatBase } from './flatBase.ts';
import { capFront } from './front.ts';
import { capVoxelWrap } from './voxelWrap.ts';
import { refineAndFair } from './refine.ts';
import { projectCsrbf, shouldProjectCsrbf } from './csrbf.ts';
import type { CapContext, CapPatch } from './types.ts';
import { EMPTY_PATCH } from './types.ts';

export type { CapContext, CapPatch } from './types.ts';
export { capFan, capSingle } from './fan.ts';
export { capPlanar } from './planar.ts';
export { capLiepa } from './liepa.ts';
export { capFlatBase } from './flatBase.ts';
export { capFront } from './front.ts';
export { capVoxelWrap } from './voxelWrap.ts';

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
    case 'front':
      return capFront(ctx);
    case 'wrap':
      return capVoxelWrap(ctx);
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

function remapNewVertices(base: number, newPositions: number[], triangles: number[]): CapPatch {
  const used = new Set<number>();
  for (const id of triangles) used.add(id);
  const remap = new Map<number, number>();
  const compact: number[] = [];
  const extra = newPositions.length / 3;
  for (let i = 0; i < extra; i++) {
    const global = base + i;
    if (!used.has(global)) continue;
    remap.set(global, base + compact.length / 3);
    compact.push(newPositions[i * 3], newPositions[i * 3 + 1], newPositions[i * 3 + 2]);
  }
  const out: number[] = [];
  for (const id of triangles) out.push(remap.get(id) ?? id);
  return { newPositions: compact, triangles: out };
}

/**
 * 이미 면이 둘인 에지에 세 번째 면을 붙이면, 시각 모드에서는 그 삼각형만 건너뛰고
 * 엄격 모드에서는 패치 전체를 버린다. 보이는 찢김(면이 하나인 에지가 둘 이상)을
 * 닫으면 나머지 한 변이 이미 둘이어도 남긴다. 부분 패치도 테두리를 줄이면 남긴다.
 */
function commitManifold(ctx: CapContext, patch: CapPatch): CapPatch {
  const faceCount = ctx.edgeFaceCount;
  const commit = ctx.commitTriangle;
  if (!faceCount || patch.triangles.length === 0) return patch;

  const strict = ctx.strictManifold === true;
  const bonus = new Map<string, number>();
  const count = (a: number, b: number) => faceCount(a, b) + (bonus.get(edgeKey(a, b)) ?? 0);
  const bump = (a: number, b: number) => {
    const key = edgeKey(a, b);
    bonus.set(key, (bonus.get(key) ?? 0) + 1);
  };

  const kept: number[] = [];
  for (let i = 0; i < patch.triangles.length; i += 3) {
    const a = patch.triangles[i];
    const b = patch.triangles[i + 1];
    const c = patch.triangles[i + 2];
    if (a === b || b === c || c === a) {
      if (strict) return EMPTY_PATCH;
      continue;
    }
    const edges: [number, number][] = [
      [a, b],
      [b, c],
      [c, a],
    ];
    const ok = strict
      ? edges.every(([u, v]) => count(u, v) < 2)
      : closesVisibleTear(count(a, b), count(b, c), count(c, a));
    if (!ok) {
      if (strict) return EMPTY_PATCH;
      continue;
    }
    for (const [u, v] of edges) bump(u, v);
    kept.push(a, b, c);
  }

  if (kept.length === 0) return EMPTY_PATCH;

  const pruned = remapNewVertices(ctx.baseVertexCount, patch.newPositions, kept);
  for (let i = 0; i < pruned.triangles.length; i += 3) {
    commit?.(pruned.triangles[i], pruned.triangles[i + 1], pruned.triangles[i + 2]);
  }
  return pruned;
}

/**
 * 면이 하나인 사슬 에지만 Steiner에 잇는다. 이미 둘인 가상 닫힘 변은 쓰지 않아
 * 혼합 비다양체 루프에도 삼각형이 남는다.
 */
function capBoundarySlit(ctx: CapContext): CapPatch {
  const v = ctx.metrics.vertices;
  const n = v.length;
  if (n < 3) return EMPTY_PATCH;
  const faceCount = ctx.edgeFaceCount;
  const ones: [number, number][] = [];
  const last = ctx.metrics.closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = v[i];
    const b = v[(i + 1) % n];
    if ((faceCount?.(a, b) ?? 1) < 2) ones.push([a, b]);
  }
  if (ones.length === 0) return EMPTY_PATCH;
  const points = v.map((id) => vertexAt(ctx.mesh.positions, id));
  const center = centroidOf(points);
  const apex = ctx.baseVertexCount;
  const triangles: number[] = [];
  for (const [a, b] of ones) triangles.push(b, a, apex);
  return { newPositions: [center[0], center[1], center[2]], triangles };
}

function shouldFair(ctx: CapContext): boolean {
  const planned = ctx.metrics.strategy;
  if (planned === 'flatBase' || planned === 'single' || planned === 'wrap') return false;
  return (
    ctx.metrics.vertices.length >= 4 &&
    ctx.metrics.planarity >= DEFAULT_CLASSIFY_OPTIONS.planarityThreshold
  );
}

function fairPatch(ctx: CapContext, patch: CapPatch): CapPatch {
  if (patch.triangles.length === 0) return patch;
  let next = patch;
  if (shouldFair(ctx)) {
    next = refineAndFair(ctx, next);
    if (shouldProjectCsrbf(ctx)) next = projectCsrbf(ctx, next);
  }
  return next;
}

function fallbackChain(ctx: CapContext, planned: CapStrategy): CapPatch[] {
  const n = ctx.metrics.vertices.length;
  const chain: CapPatch[] = [];
  if (planned === 'front') {
    if (n <= DEFAULT_CLASSIFY_OPTIONS.liepaMaxVertices) chain.push(capLiepa(ctx));
    chain.push(capPlanar(ctx));
  } else if (planned === 'wrap') {
    chain.push(capFront(ctx));
    chain.push(capPlanar(ctx));
  } else if (planned === 'liepa') {
    chain.push(capPlanar(ctx));
  }
  chain.push(capFan(ctx));
  return chain;
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
  primary = fairPatch(ctx, primary);
  primary = commitManifold(ctx, primary);

  if (primary.triangles.length > 0) {
    return { ...primary, appliedStrategy: planned, fellBack: false };
  }

  for (const raw of fallbackChain(ctx, planned)) {
    const committed = commitManifold(ctx, fairPatch(ctx, raw));
    if (committed.triangles.length > 0) {
      return { ...committed, appliedStrategy: 'fan', fellBack: true };
    }
  }

  const slit = commitManifold(ctx, capBoundarySlit(ctx));
  if (slit.triangles.length > 0) {
    return { ...slit, appliedStrategy: 'fan', fellBack: true };
  }

  return { ...EMPTY_PATCH, appliedStrategy: planned, fellBack: false };
}
