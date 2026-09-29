import type { MeshData } from '../types.ts';
import type { TriangleBVH } from './bvh.ts';

export interface SolidifyOptions {
  /** 가장 긴 축을 몇 칸으로 나눌지. 클수록 세밀하고 느리다. */
  resolution?: number;
  /**
   * 두께가 없는 시트(지느러미)에 줄 최소 두께의 절반, 격자 칸 단위.
   * 칸 대각선의 절반(≈0.87)보다 커야 얇은 판이 격자 사이로 빠지지 않는다.
   */
  finRadiusVoxels?: number;
  /** 전체 부피 대비 이 비율보다 작은 떠 있는 조각은 버린다. 0이면 모두 남긴다. */
  minShellVolumeRatio?: number;
  /** 바깥과 이어지지 않은 속 빈 공간을 채운다. */
  fillVoids?: boolean;
  onPhase?: (phase: SolidPhase) => void;
}

export type SolidPhase = 'field' | 'thicken' | 'fill' | 'march' | 'shells';

export interface SolidStats {
  resolution: number;
  grid: [number, number, number];
  voxelSize: number;
  /** 칸 크기를 가장 긴 축으로 나눈 값. */
  voxelRatio: number;
  finRadius: number;
  /** 두께를 입힌 입력 삼각형 수. */
  thickenedTriangles: number;
  /** 두께 때문에 안쪽이 된 격자점 수. */
  thickenedPoints: number;
  /** 속 빈 공간을 채운 격자점 수. */
  filledVoidPoints: number;
  /** 마칭 직후 덩어리 수. */
  shellsBefore: number;
  /** 버린 작은 조각 수와 그 부피 비율. */
  removedShells: number;
  removedVolumeRatio: number;
  outputTriangles: number;
  /** 원본 표면에서 멀리 떨어져 새로 채운 삼각형 수. */
  newTriangles: number;
}

export interface SolidifyResult {
  mesh: MeshData;
  /** 이 인덱스부터가 원본 표면과 떨어진, 새로 채운 삼각형이다. */
  newTriangleStart: number;
  stats: SolidStats;
  timings: { field: number; thicken: number; fill: number; march: number; shells: number };
}

const DEFAULT_RESOLUTION = 256;
/** 격자점 상한. 넘으면 칸을 키운다. 브라우저 워커의 메모리와 시간을 지키는 선이다. */
const POINT_BUDGET = 3_000_000;
/** 기본 해상도에서는 입력 에지의 중앙값에 이 비율을 곱한 것보다 잘게 나누지 않는다. */
const EDGE_DETAIL_RATIO = 0.25;
/** 칸을 키우더라도 가장 긴 축은 이만큼은 나눈다. */
const MIN_RESOLUTION = 48;
const DEFAULT_FIN_RADIUS = 0.9;
const DEFAULT_MIN_SHELL = 0.001;
const PAD = 3;
/** 원본 표면에서 이 칸 수보다 멀면 새로 채운 면으로 칠한다. */
const NEAR_VOXELS = 1.5;
/** 두 면 판정에서 표면 양쪽으로 떨어뜨려 볼 거리, 칸 단위. */
const SIDE_PROBE_VOXELS = 1.0;
/** 교차점이 격자점에 너무 붙으면 바늘 같은 삼각형이 생긴다. */
const T_CLAMP = 0.01;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * 삼각형 수프를 속이 찬 닫힌 표면으로 다시 만든다.
 *
 * 1. 격자점마다 일반화 와인딩 넘버 w를 재고 f = |w| - 0.5 를 둔다. 구멍은 부드럽게
 *    메워지고, 겹친 덩어리는 합쳐지며, 반대 방향으로 두 번 있는 양면 시트는 상쇄된다.
 * 2. 양쪽이 모두 바깥인 면(두께 없는 지느러미, 격자보다 얇은 판)에는 최소 두께를 입힌다.
 * 3. 바깥과 이어지지 않은 속 빈 공간을 채운다. 연결은 마칭에 쓰는 사면체 분할의
 *    에지(14방향)로 판단해 마칭 결과와 정확히 맞춘다.
 * 4. Kuhn 6-사면체 분할 위에서 0-등위면을 뽑는다. 조각별 선형 함수의 정칙 등위면이라
 *    닫혀 있고, 모든 모서리에 면이 정확히 둘이며, 스스로 교차하지 않는다.
 */
export interface SolidGrid {
  /** 실제로 쓴 가장 긴 축 칸 수. */
  resolution: number;
  requestedResolution: number;
  longest: number;
  h: number;
  ox: number;
  oy: number;
  oz: number;
  gx: number;
  gy: number;
  gz: number;
}

/**
 * 격자를 정한다. 기본은 가장 긴 축의 1/256이다. 속이 꽉 찬 모델은 격자점이 세제곱으로
 * 늘어나므로 점 수에 상한을 두고, 기본 해상도일 때는 입력 에지보다 훨씬 잘게 나누지
 * 않는다. 삼각형 4천 개짜리 구를 256칸으로 나누면 190만 삼각형이 나온다.
 */
export function planSolidGrid(coords: Float64Array, count: number, options: SolidifyOptions = {}): SolidGrid | null {
  const requestedN = Math.max(8, Math.round(options.resolution ?? DEFAULT_RESOLUTION));
  let bminx = Infinity;
  let bminy = Infinity;
  let bminz = Infinity;
  let bmaxx = -Infinity;
  let bmaxy = -Infinity;
  let bmaxz = -Infinity;
  for (let i = 0; i < count * 9; i += 3) {
    const x = coords[i];
    const y = coords[i + 1];
    const z = coords[i + 2];
    if (x < bminx) bminx = x;
    if (y < bminy) bminy = y;
    if (z < bminz) bminz = z;
    if (x > bmaxx) bmaxx = x;
    if (y > bmaxy) bmaxy = y;
    if (z > bmaxz) bmaxz = z;
  }
  const longest = Math.max(bmaxx - bminx, bmaxy - bminy, bmaxz - bminz);
  if (count === 0 || !(longest > 0) || !Number.isFinite(longest)) return null;

  const ex = bmaxx - bminx;
  const ey = bmaxy - bminy;
  const ez = bmaxz - bminz;
  let h = longest / requestedN;
  const budgetH = Math.cbrt(((ex + 2 * PAD * h) * (ey + 2 * PAD * h) * (ez + 2 * PAD * h)) / POINT_BUDGET);
  if (budgetH > h) h = budgetH;
  if (options.resolution === undefined) {
    const detailH = medianEdge(coords, count) * EDGE_DETAIL_RATIO;
    if (detailH > h) h = detailH;
  }
  h = Math.min(h, longest / MIN_RESOLUTION);

  return {
    resolution: Math.round(longest / h),
    requestedResolution: requestedN,
    longest,
    h,
    ox: bminx - PAD * h,
    oy: bminy - PAD * h,
    oz: bminz - PAD * h,
    gx: Math.ceil(ex / h) + 2 * PAD + 1,
    gy: Math.ceil(ey / h) + 2 * PAD + 1,
    gz: Math.ceil(ez / h) + 2 * PAD + 1,
  };
}

/** 격자 z층 [z0, z1)의 f = |w| - 0.5를 out에 쓴다. out은 전체 격자 크기여도 되고 층 크기여도 된다. */
export function computeWindingSlab(
  bvh: { winding(x: number, y: number, z: number): number },
  grid: SolidGrid,
  z0: number,
  z1: number,
  out: Float32Array,
  outOffset = 0,
): void {
  const { ox, oy, oz, h, gx, gy } = grid;
  let k = outOffset;
  for (let z = z0; z < z1; z++) {
    const pz = oz + z * h;
    for (let y = 0; y < gy; y++) {
      const py = oy + y * h;
      for (let x = 0; x < gx; x++) {
        out[k++] = Math.abs(bvh.winding(ox + x * h, py, pz)) - 0.5;
      }
    }
  }
}

export function solidify(bvh: TriangleBVH, options: SolidifyOptions = {}): SolidifyResult {
  const grid = planSolidGrid(bvh.coords, bvh.count, options);
  if (!grid) return emptySolidResult(Math.max(8, Math.round(options.resolution ?? DEFAULT_RESOLUTION)));
  options.onPhase?.('field');
  const t0 = now();
  const field = new Float32Array(grid.gx * grid.gy * grid.gz);
  computeWindingSlab(bvh, grid, 0, grid.gz, field, 0);
  const result = solidifyWithField(bvh, grid, field, options);
  result.timings.field = now() - t0;
  return result;
}

function emptySolidResult(resolution: number): SolidifyResult {
  return {
    mesh: { positions: new Float32Array(0), indices: new Uint32Array(0) },
    newTriangleStart: 0,
    stats: {
      resolution,
      grid: [0, 0, 0],
      voxelSize: 0,
      voxelRatio: 0,
      finRadius: 0,
      thickenedTriangles: 0,
      thickenedPoints: 0,
      filledVoidPoints: 0,
      shellsBefore: 0,
      removedShells: 0,
      removedVolumeRatio: 0,
      outputTriangles: 0,
      newTriangles: 0,
    },
    timings: { field: 0, thicken: 0, fill: 0, march: 0, shells: 0 },
  };
}

/** 와인딩 넘버 격자(f = |w| - 0.5)를 받아 나머지 단계를 마친다. field는 제자리에서 바뀐다. */
export function solidifyWithField(
  bvh: TriangleBVH,
  grid: SolidGrid,
  field: Float32Array,
  options: SolidifyOptions = {},
): SolidifyResult {
  const finRadiusVoxels = options.finRadiusVoxels ?? DEFAULT_FIN_RADIUS;
  const minShell = options.minShellVolumeRatio ?? DEFAULT_MIN_SHELL;
  const phase = (p: SolidPhase) => options.onPhase?.(p);
  const coords = bvh.coords;
  const F = bvh.count;
  const { h, ox, oy, oz, gx, gy, gz, longest } = grid;
  const N = grid.resolution;
  const sxy = gx * gy;
  const G = sxy * gz;
  const t1 = now();

  // ---- 2. 두께 없는 면에 두께 입히기 + 원본까지 거리 ----
  phase('thicken');
  const rFin = finRadiusVoxels * h;
  const nearR = NEAR_VOXELS * h;
  const reach = Math.max(rFin, nearR);
  const probe = SIDE_PROBE_VOXELS * h;
  const nearest = new Float32Array(G).fill(Infinity);
  const thick = new Float32Array(G).fill(-1);
  const q = new Float64Array(3);
  let thickenedTriangles = 0;

  // |w|를 격자에서 삼선형 보간한다. 격자 밖은 바깥으로 본다.
  const windingAt = (px: number, py: number, pz: number): number => {
    const fx = (px - ox) / h;
    const fy = (py - oy) / h;
    const fz = (pz - oz) / h;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const z0 = Math.floor(fz);
    if (x0 < 0 || y0 < 0 || z0 < 0 || x0 >= gx - 1 || y0 >= gy - 1 || z0 >= gz - 1) return 0;
    const tx = fx - x0;
    const ty = fy - y0;
    const tz = fz - z0;
    const g = x0 + gx * (y0 + gy * z0);
    const c000 = field[g];
    const c100 = field[g + 1];
    const c010 = field[g + gx];
    const c110 = field[g + gx + 1];
    const c001 = field[g + sxy];
    const c101 = field[g + sxy + 1];
    const c011 = field[g + sxy + gx];
    const c111 = field[g + sxy + gx + 1];
    const c00 = c000 + (c100 - c000) * tx;
    const c10 = c010 + (c110 - c010) * tx;
    const c01 = c001 + (c101 - c001) * tx;
    const c11 = c011 + (c111 - c011) * tx;
    const c0 = c00 + (c10 - c00) * ty;
    const c1 = c01 + (c11 - c01) * ty;
    return c0 + (c1 - c0) * tz + 0.5;
  };

  for (let t = 0; t < F; t++) {
    const o = t * 9;
    const ax = coords[o];
    const ay = coords[o + 1];
    const az = coords[o + 2];
    const bx = coords[o + 3];
    const by = coords[o + 4];
    const bz = coords[o + 5];
    const cx = coords[o + 6];
    const cy = coords[o + 7];
    const cz = coords[o + 8];
    let nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    let ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    let nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
    const hasNormal = nl > 0;
    if (hasNormal) {
      nx /= nl;
      ny /= nl;
      nz /= nl;
    }
    const maxEdge = Math.sqrt(
      Math.max(
        (bx - ax) ** 2 + (by - ay) ** 2 + (bz - az) ** 2,
        (cx - bx) ** 2 + (cy - by) ** 2 + (cz - bz) ** 2,
        (ax - cx) ** 2 + (ay - cy) ** 2 + (az - cz) ** 2,
      ),
    );
    // 작은 삼각형은 무게중심 한 곳에서, 큰 삼각형은 격자점마다 가장 가까운 점에서 판정한다.
    let smallFin = -1;
    if (hasNormal && maxEdge <= h) {
      const mx = (ax + bx + cx) / 3;
      const my = (ay + by + cy) / 3;
      const mz = (az + bz + cz) / 3;
      smallFin = isFin(windingAt, mx, my, mz, nx, ny, nz, probe) ? 1 : 0;
    }

    const x0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - reach - ox) / h));
    const y0 = Math.max(0, Math.floor((Math.min(ay, by, cy) - reach - oy) / h));
    const z0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - reach - oz) / h));
    const x1 = Math.min(gx - 1, Math.ceil((Math.max(ax, bx, cx) + reach - ox) / h));
    const y1 = Math.min(gy - 1, Math.ceil((Math.max(ay, by, cy) + reach - oy) / h));
    const z1 = Math.min(gz - 1, Math.ceil((Math.max(az, bz, cz) + reach - oz) / h));
    let thickened = false;
    const reach2 = reach * reach;
    const rFin2 = rFin * rFin;
    for (let z = z0; z <= z1; z++) {
      const pz = oz + z * h;
      for (let y = y0; y <= y1; y++) {
        const py = oy + y * h;
        const row = (z * gy + y) * gx;
        for (let x = x0; x <= x1; x++) {
          const px = ox + x * h;
          const d2 = closestPoint(px, py, pz, coords, o, q);
          if (d2 > reach2) continue;
          const g = row + x;
          const d = Math.sqrt(d2);
          if (d < nearest[g]) nearest[g] = d;
          if (!hasNormal) continue;
          const fin = smallFin >= 0 ? smallFin === 1 : isFin(windingAt, q[0], q[1], q[2], nx, ny, nz, probe);
          if (!fin) continue;
          // 지느러미에서 rFin 떨어진 곳이 0이 되는 거리장. 바깥쪽 음수도 남겨 두어야
          // 선형 보간한 등위면이 정확히 rFin에 놓인다.
          const value = ((rFin - d) / h) * 0.5;
          if (value > thick[g]) thick[g] = value;
          if (d2 <= rFin2) thickened = true;
        }
      }
    }
    if (thickened) thickenedTriangles++;
  }

  /*
   * 표면 가까이에서는 안팎(부호)은 와인딩 넘버로 두고 크기만 원본까지의 거리로 바꾼다.
   * 닫힌 표면의 와인딩 넘버는 안 1·밖 0으로 거의 계단이라, 그대로 보간하면 표면이 두
   * 격자점의 한가운데로 가서 최대 반 칸 어긋난다. 부호가 그대로라 격자에서 정해지는
   * 등위면의 위상(닫힘·다양체·무교차)은 바뀌지 않고, 교차점 위치만 원래 표면에 붙는다.
   */
  let thickenedPoints = 0;
  for (let g = 0; g < G; g++) {
    let f = field[g];
    const d = nearest[g];
    if (d <= reach) {
      const magnitude = Math.max((d / h) * 0.5, 1e-6);
      f = f > 0 ? magnitude : -magnitude;
    }
    if (thick[g] > f) {
      if (f <= 0 && thick[g] > 0) thickenedPoints++;
      f = thick[g];
    }
    field[g] = f;
  }
  // 격자 테두리는 반드시 바깥이어야 등위면이 닫힌다.
  for (let z = 0; z < gz; z++) {
    for (let y = 0; y < gy; y++) {
      for (let x = 0; x < gx; x++) {
        if (x === 0 || y === 0 || z === 0 || x === gx - 1 || y === gy - 1 || z === gz - 1) {
          const g = x + gx * (y + gy * z);
          if (field[g] > 0) field[g] = -1e-3;
        }
      }
    }
  }
  const t2 = now();

  // ---- 3. 속 빈 공간 채우기 ----
  phase('fill');
  let filledVoidPoints = 0;
  if (options.fillVoids ?? true) {
    const reached = new Uint8Array(G);
    const queue = new Int32Array(G);
    let head = 0;
    let tail = 0;
    const push = (g: number) => {
      if (reached[g] || field[g] > 0) return;
      reached[g] = 1;
      queue[tail++] = g;
    };
    for (let z = 0; z < gz; z++) {
      for (let y = 0; y < gy; y++) {
        for (let x = 0; x < gx; x++) {
          if (x === 0 || y === 0 || z === 0 || x === gx - 1 || y === gy - 1 || z === gz - 1) push(x + gx * (y + gy * z));
        }
      }
    }
    const offsets = [1, gx, sxy, 1 + gx, 1 + sxy, gx + sxy, 1 + gx + sxy];
    const dx = [1, 0, 0, 1, 1, 0, 1];
    const dy = [0, 1, 0, 1, 0, 1, 1];
    const dz = [0, 0, 1, 0, 1, 1, 1];
    while (head < tail) {
      const g = queue[head++];
      const x = g % gx;
      const y = Math.floor(g / gx) % gy;
      const z = Math.floor(g / sxy);
      for (let k = 0; k < 7; k++) {
        const px = x + dx[k];
        const py = y + dy[k];
        const pz = z + dz[k];
        if (px < gx && py < gy && pz < gz) push(g + offsets[k]);
        const mx = x - dx[k];
        const my = y - dy[k];
        const mz = z - dz[k];
        if (mx >= 0 && my >= 0 && mz >= 0) push(g - offsets[k]);
      }
    }
    for (let g = 0; g < G; g++) {
      if (field[g] <= 0 && !reached[g]) {
        field[g] = 1e-3;
        filledVoidPoints++;
      }
    }
  }
  // 정확히 0인 격자점은 등위면이 격자점을 지나게 해 비다양체를 만든다.
  for (let g = 0; g < G; g++) if (field[g] === 0) field[g] = -1e-7;
  const t3 = now();

  // ---- 4. 마칭 테트라헤드라 ----
  phase('march');
  const march = marchingTets(field, gx, gy, gz, ox, oy, oz, h, nearest, nearR);
  const t4 = now();

  // ---- 5. 떠 있는 작은 조각 정리 ----
  phase('shells');
  const cleaned = dropSmallShells(march.positions, march.indices, march.isNew, minShell);
  const t5 = now();

  return {
    mesh: cleaned.mesh,
    newTriangleStart: cleaned.newTriangleStart,
    stats: {
      resolution: N,
      grid: [gx, gy, gz],
      voxelSize: h,
      voxelRatio: h / longest,
      finRadius: rFin,
      thickenedTriangles,
      thickenedPoints,
      filledVoidPoints,
      shellsBefore: cleaned.shellsBefore,
      removedShells: cleaned.removedShells,
      removedVolumeRatio: cleaned.removedVolumeRatio,
      outputTriangles: cleaned.mesh.indices.length / 3,
      newTriangles: cleaned.mesh.indices.length / 3 - cleaned.newTriangleStart,
    },
    timings: { field: 0, thicken: t2 - t1, fill: t3 - t2, march: t4 - t3, shells: t5 - t4 },
  };
}

/** 에지 길이의 중앙값. 삼각형이 많으면 고르게 추려서 잰다. */
function medianEdge(coords: Float64Array, F: number): number {
  const step = Math.max(1, Math.floor(F / 20_000));
  const lengths: number[] = [];
  for (let t = 0; t < F; t += step) {
    const o = t * 9;
    lengths.push(
      Math.hypot(coords[o + 3] - coords[o], coords[o + 4] - coords[o + 1], coords[o + 5] - coords[o + 2]),
      Math.hypot(coords[o + 6] - coords[o + 3], coords[o + 7] - coords[o + 4], coords[o + 8] - coords[o + 5]),
      Math.hypot(coords[o] - coords[o + 6], coords[o + 1] - coords[o + 7], coords[o + 2] - coords[o + 8]),
    );
  }
  if (lengths.length === 0) return 0;
  lengths.sort((a, b) => a - b);
  return lengths[lengths.length >> 1];
}

/** 표면 한 점의 양쪽을 조금씩 떨어져 본다. 둘 다 바깥이면 두께가 없는 면이다. */
function isFin(
  windingAt: (x: number, y: number, z: number) => number,
  px: number,
  py: number,
  pz: number,
  nx: number,
  ny: number,
  nz: number,
  probe: number,
): boolean {
  const front = windingAt(px + nx * probe, py + ny * probe, pz + nz * probe);
  if (front > 0.5) return false;
  const back = windingAt(px - nx * probe, py - ny * probe, pz - nz * probe);
  return back <= 0.5;
}

const TETS = [
  [0, 1, 3, 7],
  [0, 3, 2, 7],
  [0, 2, 6, 7],
  [0, 6, 4, 7],
  [0, 4, 5, 7],
  [0, 5, 1, 7],
];

function marchingTets(
  field: Float32Array,
  gx: number,
  gy: number,
  gz: number,
  ox: number,
  oy: number,
  oz: number,
  h: number,
  nearest: Float32Array,
  nearR: number,
): { positions: Float32Array; indices: Uint32Array; isNew: Uint8Array } {
  const sxy = gx * gy;
  const cornerOffset = [0, 1, gx, gx + 1, sxy, sxy + 1, sxy + gx, sxy + gx + 1];
  const dirOf = new Map<number, number>([
    [1, 0],
    [gx, 1],
    [sxy, 2],
    [1 + gx, 3],
    [1 + sxy, 4],
    [gx + sxy, 5],
    [1 + gx + sxy, 6],
  ]);

  const pos: number[] = [];
  const idx: number[] = [];
  const isNewList: number[] = [];
  const vertexOf = new Map<number, number>();

  const vertexOn = (a: number, b: number): number => {
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    const key = lo * 7 + (dirOf.get(hi - lo) as number);
    const hit = vertexOf.get(key);
    if (hit !== undefined) return hit;
    const flo = field[lo];
    const fhi = field[hi];
    let t = flo / (flo - fhi);
    if (t < T_CLAMP) t = T_CLAMP;
    else if (t > 1 - T_CLAMP) t = 1 - T_CLAMP;
    const lx = lo % gx;
    const ly = Math.floor(lo / gx) % gy;
    const lz = Math.floor(lo / sxy);
    const hx = hi % gx;
    const hy = Math.floor(hi / gx) % gy;
    const hz = Math.floor(hi / sxy);
    const id = pos.length / 3;
    pos.push(ox + (lx + (hx - lx) * t) * h, oy + (ly + (hy - ly) * t) * h, oz + (lz + (hz - lz) * t) * h);
    vertexOf.set(key, id);
    return id;
  };

  const emit = (i: number, j: number, k: number, inside: number, outside: number, fresh: number) => {
    const ax = pos[i * 3];
    const ay = pos[i * 3 + 1];
    const az = pos[i * 3 + 2];
    const ux = pos[j * 3] - ax;
    const uy = pos[j * 3 + 1] - ay;
    const uz = pos[j * 3 + 2] - az;
    const vx = pos[k * 3] - ax;
    const vy = pos[k * 3 + 1] - ay;
    const vz = pos[k * 3 + 2] - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const ddx = (outside % gx) - (inside % gx);
    const ddy = (Math.floor(outside / gx) % gy) - (Math.floor(inside / gx) % gy);
    const ddz = Math.floor(outside / sxy) - Math.floor(inside / sxy);
    if (nx * ddx + ny * ddy + nz * ddz >= 0) idx.push(i, j, k);
    else idx.push(i, k, j);
    isNewList.push(fresh);
  };

  const corner = new Int32Array(8);
  const tv = new Int32Array(4);
  for (let z = 0; z < gz - 1; z++) {
    for (let y = 0; y < gy - 1; y++) {
      for (let x = 0; x < gx - 1; x++) {
        const base = x + gx * (y + gy * z);
        let inside = 0;
        let near = Infinity;
        for (let c = 0; c < 8; c++) {
          const g = base + cornerOffset[c];
          corner[c] = g;
          if (field[g] > 0) inside++;
          if (nearest[g] < near) near = nearest[g];
        }
        if (inside === 0 || inside === 8) continue;
        const fresh = near > nearR ? 1 : 0;
        for (const tet of TETS) {
          let nin = 0;
          for (let k = 0; k < 4; k++) {
            tv[k] = corner[tet[k]];
            if (field[tv[k]] > 0) nin++;
          }
          if (nin === 0 || nin === 4) continue;
          const ins: number[] = [];
          const outs: number[] = [];
          for (let k = 0; k < 4; k++) (field[tv[k]] > 0 ? ins : outs).push(tv[k]);
          if (nin === 1 || nin === 3) {
            const lone = nin === 1 ? ins[0] : outs[0];
            const others = nin === 1 ? outs : ins;
            const a = vertexOn(lone, others[0]);
            const b = vertexOn(lone, others[1]);
            const c = vertexOn(lone, others[2]);
            emit(a, b, c, ins[0], outs[0], fresh);
          } else {
            const a = vertexOn(ins[0], outs[0]);
            const b = vertexOn(ins[0], outs[1]);
            const c = vertexOn(ins[1], outs[1]);
            const d = vertexOn(ins[1], outs[0]);
            emit(a, b, c, ins[0], outs[0], fresh);
            emit(a, c, d, ins[0], outs[0], fresh);
          }
        }
      }
    }
  }

  return { positions: new Float32Array(pos), indices: new Uint32Array(idx), isNew: new Uint8Array(isNewList) };
}

/**
 * 부피가 아주 작은 떠 있는 조각을 버리고, 원본 표면 근처 면을 앞에, 새로 채운 면을 뒤에 둔다.
 */
function dropSmallShells(
  positions: Float32Array,
  indices: Uint32Array,
  isNew: Uint8Array,
  minRatio: number,
): { mesh: MeshData; newTriangleStart: number; shellsBefore: number; removedShells: number; removedVolumeRatio: number } {
  const V = positions.length / 3;
  const F = indices.length / 3;
  const parent = new Int32Array(V);
  for (let i = 0; i < V; i++) parent[i] = i;
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) r = parent[r];
    while (parent[x] !== r) {
      const n = parent[x];
      parent[x] = r;
      x = n;
    }
    return r;
  };
  for (let f = 0; f < F; f++) {
    const a = find(indices[f * 3]);
    const b = find(indices[f * 3 + 1]);
    const c = find(indices[f * 3 + 2]);
    if (b !== a) parent[b] = a;
    const c2 = find(c);
    if (c2 !== a) parent[c2] = a;
  }
  const volume = new Float64Array(V);
  for (let f = 0; f < F; f++) {
    const ia = indices[f * 3] * 3;
    const ib = indices[f * 3 + 1] * 3;
    const ic = indices[f * 3 + 2] * 3;
    const v =
      (positions[ia] * (positions[ib + 1] * positions[ic + 2] - positions[ib + 2] * positions[ic + 1]) -
        positions[ia + 1] * (positions[ib] * positions[ic + 2] - positions[ib + 2] * positions[ic]) +
        positions[ia + 2] * (positions[ib] * positions[ic + 1] - positions[ib + 1] * positions[ic])) /
      6;
    volume[find(indices[f * 3])] += v;
  }
  let total = 0;
  let shellsBefore = 0;
  for (let v = 0; v < V; v++) {
    if (parent[v] === v && volume[v] !== 0) {
      total += Math.abs(volume[v]);
      shellsBefore++;
    }
  }
  const keep = new Uint8Array(V);
  let removedShells = 0;
  let removedVolume = 0;
  for (let v = 0; v < V; v++) {
    if (parent[v] !== v) continue;
    if (minRatio > 0 && Math.abs(volume[v]) < total * minRatio) {
      removedShells++;
      removedVolume += Math.abs(volume[v]);
    } else {
      keep[v] = 1;
    }
  }

  const remap = new Int32Array(V).fill(-1);
  const outPos: number[] = [];
  const nearIdx: number[] = [];
  const newIdx: number[] = [];
  const mapVertex = (v: number) => {
    let m = remap[v];
    if (m < 0) {
      m = outPos.length / 3;
      remap[v] = m;
      outPos.push(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
    }
    return m;
  };
  for (let f = 0; f < F; f++) {
    if (!keep[find(indices[f * 3])]) continue;
    const target = isNew[f] ? newIdx : nearIdx;
    target.push(mapVertex(indices[f * 3]), mapVertex(indices[f * 3 + 1]), mapVertex(indices[f * 3 + 2]));
  }
  const out = new Uint32Array(nearIdx.length + newIdx.length);
  out.set(nearIdx, 0);
  out.set(newIdx, nearIdx.length);
  return {
    mesh: { positions: new Float32Array(outPos), indices: out },
    newTriangleStart: nearIdx.length / 3,
    shellsBefore,
    removedShells,
    removedVolumeRatio: total > 0 ? removedVolume / total : 0,
  };
}

/** 점과 삼각형 사이 거리의 제곱을 돌려주고, 가장 가까운 점을 out에 쓴다. */
function closestPoint(px: number, py: number, pz: number, c: Float64Array, o: number, out: Float64Array): number {
  const ax = c[o];
  const ay = c[o + 1];
  const az = c[o + 2];
  const bx = c[o + 3];
  const by = c[o + 4];
  const bz = c[o + 5];
  const cx = c[o + 6];
  const cy = c[o + 7];
  const cz = c[o + 8];
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const acx = cx - ax;
  const acy = cy - ay;
  const acz = cz - az;
  const apx = px - ax;
  const apy = py - ay;
  const apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  let qx: number;
  let qy: number;
  let qz: number;
  if (d1 <= 0 && d2 <= 0) {
    qx = ax;
    qy = ay;
    qz = az;
  } else {
    const bpx = px - bx;
    const bpy = py - by;
    const bpz = pz - bz;
    const d3 = abx * bpx + aby * bpy + abz * bpz;
    const d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) {
      qx = bx;
      qy = by;
      qz = bz;
    } else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        const v = d1 / (d1 - d3);
        qx = ax + v * abx;
        qy = ay + v * aby;
        qz = az + v * abz;
      } else {
        const cpx = px - cx;
        const cpy = py - cy;
        const cpz = pz - cz;
        const d5 = abx * cpx + aby * cpy + abz * cpz;
        const d6 = acx * cpx + acy * cpy + acz * cpz;
        if (d6 >= 0 && d5 <= d6) {
          qx = cx;
          qy = cy;
          qz = cz;
        } else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) {
            const w = d2 / (d2 - d6);
            qx = ax + w * acx;
            qy = ay + w * acy;
            qz = az + w * acz;
          } else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
              const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
              qx = bx + w * (cx - bx);
              qy = by + w * (cy - by);
              qz = bz + w * (cz - bz);
            } else {
              const denom = 1 / (va + vb + vc);
              const v = vb * denom;
              const w = vc * denom;
              qx = ax + abx * v + acx * w;
              qy = ay + aby * v + acy * w;
              qz = az + abz * v + acz * w;
            }
          }
        }
      }
    }
  }
  out[0] = qx;
  out[1] = qy;
  out[2] = qz;
  const dx = px - qx;
  const dy = py - qy;
  const dz = pz - qz;
  return dx * dx + dy * dy + dz * dz;
}
