import type { MeshData } from './types.ts';

export interface IntersectionCount {
  /** 서로 뚫고 지나가는 삼각형 쌍의 수. capped면 이 값 이상이다. */
  count: number;
  /** 후보를 끝까지 다 봤는지. 쌍 검사 한도에 걸리면 false다. */
  complete: boolean;
  /** 개수가 cap에 닿아 세기를 멈췄는지. */
  capped: boolean;
  /** 실제로 분리축 검사까지 간 쌍의 수. */
  pairTests: number;
}

export interface IntersectionOptions {
  /** 이만큼 찾으면 멈춘다. 점수는 5쌍부터 0점이라 끝까지 셀 이유가 없다. */
  cap?: number;
  /** 분리축 검사 상한. 면이 한 점에 수만 장 몰린 병적인 입력에서 멈추게 한다. */
  pairTestLimit?: number;
}

const DEFAULT_CAP = 10_000;
const DEFAULT_PAIR_TEST_LIMIT = 300_000_000;
/** 한 삼각형이 이보다 많은 칸에 걸치면 따로 모아 전부와 비교한다. */
const MAX_CELLS_PER_TRIANGLE = 4096;
/** (칸, 삼각형) 키 수 상한. 넘으면 칸을 키운다. Float64 1,200만 개 ≈ 96MB. */
const ENTRY_BUDGET = 12_000_000;

/**
 * 메시 전체에서 서로 뚫고 지나가는 삼각형 쌍을 센다.
 *
 * 보정 전과 보정 후를 같은 잣대로 재려고 만들었다. 예전에는 새로 만든 뚜껑만
 * 검사했고 원본은 검사하지 않아, 원본이 원래 갖고 있던 관통이 보정 전 점수에서
 * 빠지고 보정 후에만 잡혔다.
 *
 * 삼각형 AABB를 균일 격자에 넣고 (칸, 삼각형) 키를 정렬해 같은 칸끼리만 비교한다.
 * 한 쌍이 여러 칸에 함께 들면 두 AABB가 겹치는 영역의 최소 모서리가 든 칸에서만
 * 센다. 점을 공유하는 쌍은 이웃이라 건너뛴다. 판정은 분리축 11개이고, 살짝
 * 스치거나 같은 평면에서 겹친 면은 관통으로 치지 않는다.
 */
export function countSelfIntersections(mesh: MeshData, options: IntersectionOptions = {}): IntersectionCount {
  const { positions, indices } = mesh;
  const F = indices.length / 3;
  const cap = options.cap ?? DEFAULT_CAP;
  const pairLimit = options.pairTestLimit ?? DEFAULT_PAIR_TEST_LIMIT;
  const empty = { count: 0, complete: true, capped: false, pairTests: 0 };
  if (F < 2) return empty;

  const box = new Float64Array(F * 6);
  let gx0 = Infinity;
  let gy0 = Infinity;
  let gz0 = Infinity;
  let gx1 = -Infinity;
  let gy1 = -Infinity;
  let gz1 = -Infinity;
  let extentSum = 0;
  let finite = 0;

  for (let t = 0; t < F; t++) {
    const a = indices[t * 3] * 3;
    const b = indices[t * 3 + 1] * 3;
    const c = indices[t * 3 + 2] * 3;
    const minx = Math.min(positions[a], positions[b], positions[c]);
    const miny = Math.min(positions[a + 1], positions[b + 1], positions[c + 1]);
    const minz = Math.min(positions[a + 2], positions[b + 2], positions[c + 2]);
    const maxx = Math.max(positions[a], positions[b], positions[c]);
    const maxy = Math.max(positions[a + 1], positions[b + 1], positions[c + 1]);
    const maxz = Math.max(positions[a + 2], positions[b + 2], positions[c + 2]);
    const o = t * 6;
    box[o] = minx;
    box[o + 1] = miny;
    box[o + 2] = minz;
    box[o + 3] = maxx;
    box[o + 4] = maxy;
    box[o + 5] = maxz;
    if (!(Number.isFinite(minx) && Number.isFinite(maxx) && Number.isFinite(miny) && Number.isFinite(maxy) && Number.isFinite(minz) && Number.isFinite(maxz))) {
      box[o] = NaN;
      continue;
    }
    finite++;
    if (minx < gx0) gx0 = minx;
    if (miny < gy0) gy0 = miny;
    if (minz < gz0) gz0 = minz;
    if (maxx > gx1) gx1 = maxx;
    if (maxy > gy1) gy1 = maxy;
    if (maxz > gz1) gz1 = maxz;
    extentSum += Math.max(maxx - minx, maxy - miny, maxz - minz);
  }
  if (finite < 2) return empty;

  const diag = Math.hypot(gx1 - gx0, gy1 - gy0, gz1 - gz0);
  if (!(diag > 0)) return empty;
  const eps = diag * 1e-9;

  // 칸은 평균 삼각형보다 조금 크게. 너무 작으면 삼각형이 여러 칸에 퍼지고, 너무 크면
  // 한 칸에 몰린 쌍이 제곱으로 늘어난다. 키를 정밀도 안에 담으려고 칸 수에 상한을 둔다.
  let cell = Math.max((extentSum / finite) * 1.25, diag * 1e-6);
  let nx = 0;
  let ny = 0;
  let nz = 0;
  const keyLimit = 2 ** 52 / F;
  for (;;) {
    nx = Math.floor((gx1 - gx0) / cell) + 1;
    ny = Math.floor((gy1 - gy0) / cell) + 1;
    nz = Math.floor((gz1 - gz0) / cell) + 1;
    if (nx * ny * nz < keyLimit) break;
    cell *= 1.5;
  }

  const cellOf = (v: number, origin: number, n: number) => {
    const i = Math.floor((v - origin) / cell);
    return i < 0 ? 0 : i >= n ? n - 1 : i;
  };

  let entries = 0;
  const large: number[] = [];
  const isLarge = new Uint8Array(F);
  // 큰 삼각형과 작은 삼각형이 섞이면 키가 폭증할 수 있다. 예산을 넘으면 칸을 키워 다시 센다.
  for (let attempt = 0; ; attempt++) {
    entries = 0;
    large.length = 0;
    isLarge.fill(0);
    for (let t = 0; t < F; t++) {
      const o = t * 6;
      if (Number.isNaN(box[o])) continue;
      const sx = cellOf(box[o + 3], gx0, nx) - cellOf(box[o], gx0, nx) + 1;
      const sy = cellOf(box[o + 4], gy0, ny) - cellOf(box[o + 1], gy0, ny) + 1;
      const sz = cellOf(box[o + 5], gz0, nz) - cellOf(box[o + 2], gz0, nz) + 1;
      const span = sx * sy * sz;
      if (span > MAX_CELLS_PER_TRIANGLE) {
        isLarge[t] = 1;
        large.push(t);
      } else {
        entries += span;
      }
    }
    if (entries <= ENTRY_BUDGET || attempt >= 12) break;
    cell *= 1.5;
    nx = Math.floor((gx1 - gx0) / cell) + 1;
    ny = Math.floor((gy1 - gy0) / cell) + 1;
    nz = Math.floor((gz1 - gz0) / cell) + 1;
  }

  const keys = new Float64Array(entries);
  let k = 0;
  for (let t = 0; t < F; t++) {
    const o = t * 6;
    if (Number.isNaN(box[o]) || isLarge[t]) continue;
    const x0 = cellOf(box[o], gx0, nx);
    const y0 = cellOf(box[o + 1], gy0, ny);
    const z0 = cellOf(box[o + 2], gz0, nz);
    const x1 = cellOf(box[o + 3], gx0, nx);
    const y1 = cellOf(box[o + 4], gy0, ny);
    const z1 = cellOf(box[o + 5], gz0, nz);
    for (let z = z0; z <= z1; z++) {
      for (let y = y0; y <= y1; y++) {
        const row = (z * ny + y) * nx;
        for (let x = x0; x <= x1; x++) keys[k++] = (row + x) * F + t;
      }
    }
  }
  keys.sort();

  let count = 0;
  let pairTests = 0;

  const overlaps = (s: number, t: number) => {
    const os = s * 6;
    const ot = t * 6;
    return !(
      box[os + 3] < box[ot] + eps ||
      box[ot + 3] < box[os] + eps ||
      box[os + 4] < box[ot + 1] + eps ||
      box[ot + 4] < box[os + 1] + eps ||
      box[os + 5] < box[ot + 2] + eps ||
      box[ot + 5] < box[os + 2] + eps
    );
  };

  const shares = (s: number, t: number) => {
    const a0 = indices[s * 3];
    const a1 = indices[s * 3 + 1];
    const a2 = indices[s * 3 + 2];
    const b0 = indices[t * 3];
    const b1 = indices[t * 3 + 1];
    const b2 = indices[t * 3 + 2];
    return (
      a0 === b0 || a0 === b1 || a0 === b2 ||
      a1 === b0 || a1 === b1 || a1 === b2 ||
      a2 === b0 || a2 === b1 || a2 === b2
    );
  };

  let start = 0;
  while (start < entries) {
    const cellKey = Math.floor(keys[start] / F);
    let end = start + 1;
    while (end < entries && Math.floor(keys[end] / F) === cellKey) end++;

    if (end - start > 1) {
      const cx = cellKey % nx;
      const cy = Math.floor(cellKey / nx) % ny;
      const cz = Math.floor(cellKey / (nx * ny));
      for (let i = start; i < end; i++) {
        const s = keys[i] - cellKey * F;
        const os = s * 6;
        for (let j = i + 1; j < end; j++) {
          const t = keys[j] - cellKey * F;
          if (!overlaps(s, t)) continue;
          const ot = t * 6;
          // 두 AABB가 겹치는 영역의 최소 모서리가 이 칸에 있을 때만 센다.
          if (cellOf(Math.max(box[os], box[ot]), gx0, nx) !== cx) continue;
          if (cellOf(Math.max(box[os + 1], box[ot + 1]), gy0, ny) !== cy) continue;
          if (cellOf(Math.max(box[os + 2], box[ot + 2]), gz0, nz) !== cz) continue;
          if (shares(s, t)) continue;
          if (pairTests >= pairLimit) return { count, complete: false, capped: false, pairTests };
          pairTests++;
          if (trianglesIntersect(positions, indices, s, t, eps)) {
            count++;
            if (count >= cap) return { count, complete: true, capped: true, pairTests };
          }
        }
      }
    }
    start = end;
  }

  // 격자에 넣지 않은 큰 삼각형은 전부와 직접 비교한다.
  for (let li = 0; li < large.length; li++) {
    const s = large[li];
    for (let t = 0; t < F; t++) {
      if (t === s || Number.isNaN(box[t * 6])) continue;
      if (isLarge[t] && t < s) continue;
      if (!overlaps(s, t) || shares(s, t)) continue;
      if (pairTests >= pairLimit) return { count, complete: false, capped: false, pairTests };
      pairTests++;
      if (trianglesIntersect(positions, indices, s, t, eps)) {
        count++;
        if (count >= cap) return { count, complete: true, capped: true, pairTests };
      }
    }
  }

  return { count, complete: true, capped: false, pairTests };
}

const V = new Float64Array(18);

/** 분리축 정리로 두 삼각형이 겹치는지 본다. 면 법선 2개와 에지 외적 9개. */
export function trianglesIntersect(
  positions: Float32Array,
  indices: Uint32Array,
  f: number,
  g: number,
  eps: number,
): boolean {
  for (let i = 0; i < 3; i++) {
    const pa = indices[f * 3 + i] * 3;
    const pb = indices[g * 3 + i] * 3;
    V[i * 3] = positions[pa];
    V[i * 3 + 1] = positions[pa + 1];
    V[i * 3 + 2] = positions[pa + 2];
    V[9 + i * 3] = positions[pb];
    V[9 + i * 3 + 1] = positions[pb + 1];
    V[9 + i * 3 + 2] = positions[pb + 2];
  }

  const a0x = V[3] - V[0];
  const a0y = V[4] - V[1];
  const a0z = V[5] - V[2];
  const a1x = V[6] - V[3];
  const a1y = V[7] - V[4];
  const a1z = V[8] - V[5];
  const a2x = V[0] - V[6];
  const a2y = V[1] - V[7];
  const a2z = V[2] - V[8];
  const b0x = V[12] - V[9];
  const b0y = V[13] - V[10];
  const b0z = V[14] - V[11];
  const b1x = V[15] - V[12];
  const b1y = V[16] - V[13];
  const b1z = V[17] - V[14];
  const b2x = V[9] - V[15];
  const b2y = V[10] - V[16];
  const b2z = V[11] - V[17];

  if (separated(a0y * a1z - a0z * a1y, a0z * a1x - a0x * a1z, a0x * a1y - a0y * a1x, eps)) return false;
  if (separated(b0y * b1z - b0z * b1y, b0z * b1x - b0x * b1z, b0x * b1y - b0y * b1x, eps)) return false;

  if (separated(a0y * b0z - a0z * b0y, a0z * b0x - a0x * b0z, a0x * b0y - a0y * b0x, eps)) return false;
  if (separated(a0y * b1z - a0z * b1y, a0z * b1x - a0x * b1z, a0x * b1y - a0y * b1x, eps)) return false;
  if (separated(a0y * b2z - a0z * b2y, a0z * b2x - a0x * b2z, a0x * b2y - a0y * b2x, eps)) return false;
  if (separated(a1y * b0z - a1z * b0y, a1z * b0x - a1x * b0z, a1x * b0y - a1y * b0x, eps)) return false;
  if (separated(a1y * b1z - a1z * b1y, a1z * b1x - a1x * b1z, a1x * b1y - a1y * b1x, eps)) return false;
  if (separated(a1y * b2z - a1z * b2y, a1z * b2x - a1x * b2z, a1x * b2y - a1y * b2x, eps)) return false;
  if (separated(a2y * b0z - a2z * b0y, a2z * b0x - a2x * b0z, a2x * b0y - a2y * b0x, eps)) return false;
  if (separated(a2y * b1z - a2z * b1y, a2z * b1x - a2x * b1z, a2x * b1y - a2y * b1x, eps)) return false;
  if (separated(a2y * b2z - a2z * b2y, a2z * b2x - a2x * b2z, a2x * b2y - a2y * b2x, eps)) return false;

  return true;
}

function separated(ax: number, ay: number, az: number, eps: number): boolean {
  const len = Math.sqrt(ax * ax + ay * ay + az * az);
  // 평행한 에지에서 나온 퇴화 축은 분리 판정에 쓰지 않는다.
  if (len < 1e-20) return false;
  const x = ax / len;
  const y = ay / len;
  const z = az / len;
  let minA = Infinity;
  let maxA = -Infinity;
  let minB = Infinity;
  let maxB = -Infinity;
  for (let i = 0; i < 3; i++) {
    const pa = V[i * 3] * x + V[i * 3 + 1] * y + V[i * 3 + 2] * z;
    if (pa < minA) minA = pa;
    if (pa > maxA) maxA = pa;
    const pb = V[9 + i * 3] * x + V[9 + i * 3 + 1] * y + V[9 + i * 3 + 2] * z;
    if (pb < minB) minB = pb;
    if (pb > maxB) maxB = pb;
  }
  // 살짝 스치는 정도는 관통으로 치지 않는다.
  return maxA < minB + eps || maxB < minA + eps;
}
