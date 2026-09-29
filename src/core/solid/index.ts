import { hash3, IntHashTable } from '../intHash.ts';
import type { MeshData } from '../types.ts';
import { TriangleBVH, type TriangleSoup } from './bvh.ts';

export { TriangleBVH } from './bvh.ts';
export {
  computeWindingSlab,
  planSolidGrid,
  solidify,
  solidifyWithField,
  type SolidGrid,
  type SolidifyOptions,
  type SolidPhase,
  type SolidStats,
} from './remesh.ts';

export interface SoupStats {
  inputTriangles: number;
  /** 같은 면이 반대 방향으로 짝을 이뤄 와인딩 넘버에서 상쇄되는 묶음 수. */
  sheetGroups: number;
  /** 같은 방향으로 한 번 더 들어 있어 하나로 줄인 면 수. */
  duplicateTriangles: number;
  /** 와인딩 넘버에 실제로 더하는 면 수. */
  windingTriangles: number;
}

/**
 * 정점 인덱스가 같은 삼각형을 묶어 감는 방향의 합으로 정리한다.
 *
 * 같은 방향으로 두 번 든 면을 두 번 세면 그 자리의 와인딩 넘버가 두 배가 된다.
 * 반대 방향 짝은 합이 0이라 부피가 없다. 이 면은 가중치 0으로 남겨, 와인딩 넘버에는
 * 더하지 않고 두께를 입힐 후보와 거리 계산에만 쓴다.
 */
export function buildSoup(mesh: MeshData): { soup: TriangleSoup; stats: SoupStats } {
  const { positions, indices } = mesh;
  const F = indices.length / 3;
  const table = new IntHashTable(Math.max(1, F));
  const rep = new Int32Array(F);
  const net = new Int32Array(F);
  const members = new Int32Array(F);
  let groups = 0;

  const sorted = (t: number): [number, number, number] => {
    const a = indices[t * 3];
    const b = indices[t * 3 + 1];
    const c = indices[t * 3 + 2];
    const lo = Math.min(a, b, c);
    const hi = Math.max(a, b, c);
    return [lo, a + b + c - lo - hi, hi];
  };
  const sameCycle = (s: number, t: number): boolean => {
    const a = indices[s * 3];
    const b = indices[s * 3 + 1];
    const c = indices[s * 3 + 2];
    const x = indices[t * 3];
    const y = indices[t * 3 + 1];
    const z = indices[t * 3 + 2];
    return (a === x && b === y && c === z) || (a === y && b === z && c === x) || (a === z && b === x && c === y);
  };

  for (let t = 0; t < F; t++) {
    const [s0, s1, s2] = sorted(t);
    const hash = hash3(s0, s1, s2);
    let found = -1;
    for (let g = table.first(hash); g >= 0; g = table.after(g)) {
      const [r0, r1, r2] = sorted(rep[g]);
      if (r0 === s0 && r1 === s1 && r2 === s2) {
        found = g;
        break;
      }
    }
    if (found < 0) {
      found = groups++;
      rep[found] = t;
      net[found] = 1;
      members[found] = 1;
      table.insert(hash, found);
      continue;
    }
    net[found] += sameCycle(rep[found], t) ? 1 : -1;
    members[found]++;
  }

  const coords = new Float64Array(groups * 9);
  const weight = new Uint8Array(groups);
  let sheetGroups = 0;
  let duplicateTriangles = 0;
  let windingTriangles = 0;
  for (let g = 0; g < groups; g++) {
    const t = rep[g];
    let a = indices[t * 3];
    let b = indices[t * 3 + 1];
    const c = indices[t * 3 + 2];
    if (net[g] < 0) {
      const tmp = a;
      a = b;
      b = tmp;
    }
    const o = g * 9;
    coords[o] = positions[a * 3];
    coords[o + 1] = positions[a * 3 + 1];
    coords[o + 2] = positions[a * 3 + 2];
    coords[o + 3] = positions[b * 3];
    coords[o + 4] = positions[b * 3 + 1];
    coords[o + 5] = positions[b * 3 + 2];
    coords[o + 6] = positions[c * 3];
    coords[o + 7] = positions[c * 3 + 1];
    coords[o + 8] = positions[c * 3 + 2];
    if (net[g] === 0) {
      weight[g] = 0;
      sheetGroups++;
    } else {
      weight[g] = 1;
      windingTriangles++;
    }
    duplicateTriangles += members[g] - 1;
  }

  return {
    soup: { coords, weight },
    stats: { inputTriangles: F, sheetGroups, duplicateTriangles: duplicateTriangles - sheetGroups, windingTriangles },
  };
}

export interface Fidelity {
  /** 허용 거리(모델 단위). */
  tolerance: number;
  /** 허용 거리를 가장 긴 축으로 나눈 값. */
  toleranceRatio: number;
  /**
   * 원본의 바깥 표면 넓이 중 결과 표면에서 허용 거리 안에 있는 비율.
   * 속에 묻힌 면(양쪽이 다 안쪽인 면)은 뺀다. 그런 면은 출력물에서 보이지 않는다.
   */
  inputCoverage: number;
  /** 원본 표면 넓이 중 속에 묻혀 있던 면의 비율. 솔리드화에서는 사라진다. */
  buriedRatio: number;
  /** 원본 바깥 표면에서 결과까지 거리의 95번째 백분위, 가장 긴 축 대비. */
  inputP95Ratio: number;
  /** 결과 표면 넓이 중 원본에서 허용 거리보다 멀리 새로 생긴 비율. */
  outputNewRatio: number;
  /** 결과 표면에서 원본까지 거리의 95번째 백분위, 가장 긴 축 대비. */
  outputP95Ratio: number;
  samples: number;
}

const FIDELITY_TOLERANCE_RATIO = 0.005;
const FIDELITY_SAMPLES = 20_000;

/**
 * 보정 결과가 원본 형상을 얼마나 지켰는지 잰다. 점수에는 넣지 않고 따로 보여 준다.
 *
 * 원본 표면과 결과 표면에서 넓이에 비례해 점을 뽑고, 반대쪽 표면까지 가장 가까운
 * 거리를 잰다. 원본 표본은 와인딩 넘버로 양쪽을 봐서, 둘 다 안쪽이면 속에 묻힌 면으로
 * 따로 센다. 표본은 결정적인 수열로 뽑아 브라우저와 서버의 값이 같다.
 */
export function measureFidelity(input: TriangleBVH, output: MeshData, longest: number): Fidelity {
  const tolerance = longest * FIDELITY_TOLERANCE_RATIO;
  const outSoup = soupFromMesh(output);
  const outBvh = new TriangleBVH(outSoup);
  const cap = longest * 0.1;
  const probe = longest * 0.002;

  const buried = (x: number, y: number, z: number, nx: number, ny: number, nz: number) =>
    Math.abs(input.winding(x + nx * probe, y + ny * probe, z + nz * probe)) > 0.5 &&
    Math.abs(input.winding(x - nx * probe, y - ny * probe, z - nz * probe)) > 0.5;

  const inSide = sampleDistances(input.coords, input.count, (x, y, z) => outBvh.distance(x, y, z, cap), tolerance, buried);
  const outSide = sampleDistances(outSoup.coords, outSoup.weight.length, (x, y, z) => input.distance(x, y, z, cap), tolerance);

  return {
    tolerance,
    toleranceRatio: FIDELITY_TOLERANCE_RATIO,
    inputCoverage: inSide.withinRatio,
    buriedRatio: inSide.excludedRatio,
    inputP95Ratio: longest > 0 ? inSide.p95 / longest : 0,
    outputNewRatio: 1 - outSide.withinRatio,
    outputP95Ratio: longest > 0 ? outSide.p95 / longest : 0,
    samples: FIDELITY_SAMPLES,
  };
}

export function soupFromMesh(mesh: MeshData): TriangleSoup {
  const F = mesh.indices.length / 3;
  const coords = new Float64Array(F * 9);
  for (let t = 0; t < F; t++) {
    for (let k = 0; k < 3; k++) {
      const v = mesh.indices[t * 3 + k] * 3;
      coords[t * 9 + k * 3] = mesh.positions[v];
      coords[t * 9 + k * 3 + 1] = mesh.positions[v + 1];
      coords[t * 9 + k * 3 + 2] = mesh.positions[v + 2];
    }
  }
  return { coords, weight: new Uint8Array(F).fill(1) };
}

export function longestExtent(coords: Float64Array): number {
  let mnx = Infinity;
  let mny = Infinity;
  let mnz = Infinity;
  let mxx = -Infinity;
  let mxy = -Infinity;
  let mxz = -Infinity;
  for (let i = 0; i < coords.length; i += 3) {
    if (coords[i] < mnx) mnx = coords[i];
    if (coords[i + 1] < mny) mny = coords[i + 1];
    if (coords[i + 2] < mnz) mnz = coords[i + 2];
    if (coords[i] > mxx) mxx = coords[i];
    if (coords[i + 1] > mxy) mxy = coords[i + 1];
    if (coords[i + 2] > mxz) mxz = coords[i + 2];
  }
  const l = Math.max(mxx - mnx, mxy - mny, mxz - mnz);
  return Number.isFinite(l) ? l : 0;
}

function sampleDistances(
  coords: Float64Array,
  count: number,
  distance: (x: number, y: number, z: number) => number,
  tolerance: number,
  exclude?: (x: number, y: number, z: number, nx: number, ny: number, nz: number) => boolean,
): { withinRatio: number; p95: number; excludedRatio: number } {
  if (count === 0) return { withinRatio: 1, p95: 0, excludedRatio: 0 };
  const cumulative = new Float64Array(count);
  let total = 0;
  for (let t = 0; t < count; t++) {
    const o = t * 9;
    const ux = coords[o + 3] - coords[o];
    const uy = coords[o + 4] - coords[o + 1];
    const uz = coords[o + 5] - coords[o + 2];
    const vx = coords[o + 6] - coords[o];
    const vy = coords[o + 7] - coords[o + 1];
    const vz = coords[o + 8] - coords[o + 2];
    total += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    cumulative[t] = total;
  }
  if (!(total > 0)) return { withinRatio: 1, p95: 0, excludedRatio: 0 };

  const distances: number[] = [];
  let within = 0;
  let excluded = 0;
  // 황금비 수열로 삼각형 안의 무게중심 좌표를 고르게 흩는다.
  const g1 = 0.7548776662466927;
  const g2 = 0.5698402909980532;
  for (let i = 0; i < FIDELITY_SAMPLES; i++) {
    const target = ((i + 0.5) / FIDELITY_SAMPLES) * total;
    let lo = 0;
    let hi = count - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    let r1 = (0.5 + g1 * (i + 1)) % 1;
    let r2 = (0.5 + g2 * (i + 1)) % 1;
    if (r1 + r2 > 1) {
      r1 = 1 - r1;
      r2 = 1 - r2;
    }
    const o = lo * 9;
    const ux = coords[o + 3] - coords[o];
    const uy = coords[o + 4] - coords[o + 1];
    const uz = coords[o + 5] - coords[o + 2];
    const vx = coords[o + 6] - coords[o];
    const vy = coords[o + 7] - coords[o + 1];
    const vz = coords[o + 8] - coords[o + 2];
    const x = coords[o] + r1 * ux + r2 * vx;
    const y = coords[o + 1] + r1 * uy + r2 * vy;
    const z = coords[o + 2] + r1 * uz + r2 * vz;
    if (exclude) {
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (nl > 0) {
        nx /= nl;
        ny /= nl;
        nz /= nl;
        if (exclude(x, y, z, nx, ny, nz)) {
          excluded++;
          continue;
        }
      }
    }
    const d = distance(x, y, z);
    distances.push(d);
    if (d <= tolerance) within++;
  }
  if (distances.length === 0) return { withinRatio: 1, p95: 0, excludedRatio: excluded / FIDELITY_SAMPLES };
  distances.sort((a, b) => a - b);
  return {
    withinRatio: within / distances.length,
    p95: distances[Math.min(distances.length - 1, Math.floor(distances.length * 0.95))],
    excludedRatio: excluded / FIDELITY_SAMPLES,
  };
}
