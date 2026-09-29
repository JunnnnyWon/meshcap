/**
 * 삼각형 수프 위의 BVH. 두 가지 질의를 한다.
 *
 * 1. 일반화 와인딩 넘버(Jacobson et al. 2013). 점이 표면 안쪽이면 1, 바깥이면 0에
 *    가깝다. 구멍이 있거나, 면이 겹치거나, 비다양체여도 값이 부드럽게 정의된다.
 *    먼 노드는 면적 벡터 합(쌍극자)으로 근사한다(Barill et al. 2018의 1차 버전).
 * 2. 가장 가까운 삼각형까지의 거리. 형상 보존 지표를 잴 때 쓴다.
 *
 * 삼각형마다 가중치를 둔다. 양면 시트처럼 와인딩 넘버에서 상쇄되는 면은 0으로 두어
 * 거리 질의에는 참여하되 와인딩 넘버에는 더하지 않는다.
 */

const LEAF_SIZE = 8;
const FAR_FIELD_BETA = 2.3;
const INV_4PI = 1 / (4 * Math.PI);

export interface TriangleSoup {
  /** 삼각형마다 좌표 9개. */
  coords: Float64Array;
  /** 삼각형마다 1(와인딩 넘버에 더함) 또는 0(더하지 않음). */
  weight: Uint8Array;
}

/** 스레드 사이로 보낼 수 있게 BVH를 이루는 배열만 모은 것. */
export interface BVHData {
  coords: Float64Array;
  weight: Uint8Array;
  order: Int32Array;
  nodeMin: Float64Array;
  nodeMax: Float64Array;
  nodeCenter: Float64Array;
  nodeArea: Float64Array;
  nodeRadius2: Float64Array;
  nodeLeft: Int32Array;
  nodeRight: Int32Array;
  nodeStart: Int32Array;
  nodeCount: Int32Array;
  nodes: number;
}

export class TriangleBVH {
  readonly count: number;
  readonly coords: Float64Array;
  readonly weight: Uint8Array;
  /** 잎 노드가 가리키는 삼각형 순서. */
  private readonly order: Int32Array;
  private readonly nodeMin: Float64Array;
  private readonly nodeMax: Float64Array;
  private readonly nodeCenter: Float64Array;
  private readonly nodeArea: Float64Array;
  private readonly nodeRadius2: Float64Array;
  private readonly nodeLeft: Int32Array;
  private readonly nodeRight: Int32Array;
  private readonly nodeStart: Int32Array;
  private readonly nodeCount: Int32Array;
  private nodes = 0;
  private readonly stack = new Int32Array(512);

  constructor(soup: TriangleSoup, prebuilt?: BVHData) {
    const F = soup.weight.length;
    this.count = F;
    this.coords = soup.coords;
    this.weight = soup.weight;
    if (prebuilt) {
      this.order = prebuilt.order;
      this.nodeMin = prebuilt.nodeMin;
      this.nodeMax = prebuilt.nodeMax;
      this.nodeCenter = prebuilt.nodeCenter;
      this.nodeArea = prebuilt.nodeArea;
      this.nodeRadius2 = prebuilt.nodeRadius2;
      this.nodeLeft = prebuilt.nodeLeft;
      this.nodeRight = prebuilt.nodeRight;
      this.nodeStart = prebuilt.nodeStart;
      this.nodeCount = prebuilt.nodeCount;
      this.nodes = prebuilt.nodes;
      return;
    }
    this.order = new Int32Array(F);
    for (let i = 0; i < F; i++) this.order[i] = i;

    const maxNodes = Math.max(1, 2 * Math.ceil(F / LEAF_SIZE) * 2 + 8);
    this.nodeMin = new Float64Array(maxNodes * 3);
    this.nodeMax = new Float64Array(maxNodes * 3);
    this.nodeCenter = new Float64Array(maxNodes * 3);
    this.nodeArea = new Float64Array(maxNodes * 3);
    this.nodeRadius2 = new Float64Array(maxNodes);
    this.nodeLeft = new Int32Array(maxNodes).fill(-1);
    this.nodeRight = new Int32Array(maxNodes).fill(-1);
    this.nodeStart = new Int32Array(maxNodes);
    this.nodeCount = new Int32Array(maxNodes);

    if (F === 0) return;

    const centroid = new Float64Array(F * 3);
    const areaVec = new Float64Array(F * 3);
    const areaLen = new Float64Array(F);
    const c = soup.coords;
    for (let t = 0; t < F; t++) {
      const o = t * 9;
      centroid[t * 3] = (c[o] + c[o + 3] + c[o + 6]) / 3;
      centroid[t * 3 + 1] = (c[o + 1] + c[o + 4] + c[o + 7]) / 3;
      centroid[t * 3 + 2] = (c[o + 2] + c[o + 5] + c[o + 8]) / 3;
      const ux = c[o + 3] - c[o];
      const uy = c[o + 4] - c[o + 1];
      const uz = c[o + 5] - c[o + 2];
      const vx = c[o + 6] - c[o];
      const vy = c[o + 7] - c[o + 1];
      const vz = c[o + 8] - c[o + 2];
      const nx = 0.5 * (uy * vz - uz * vy);
      const ny = 0.5 * (uz * vx - ux * vz);
      const nz = 0.5 * (ux * vy - uy * vx);
      const w = soup.weight[t];
      areaVec[t * 3] = nx * w;
      areaVec[t * 3 + 1] = ny * w;
      areaVec[t * 3 + 2] = nz * w;
      areaLen[t] = Math.sqrt(nx * nx + ny * ny + nz * nz) * w;
    }

    this.build(0, F, centroid, areaVec, areaLen);
  }

  /** 다른 스레드에서 같은 BVH를 다시 만들 수 있게 배열을 내보낸다. 복사하지 않는다. */
  toData(): BVHData {
    return {
      coords: this.coords,
      weight: this.weight,
      order: this.order,
      nodeMin: this.nodeMin,
      nodeMax: this.nodeMax,
      nodeCenter: this.nodeCenter,
      nodeArea: this.nodeArea,
      nodeRadius2: this.nodeRadius2,
      nodeLeft: this.nodeLeft,
      nodeRight: this.nodeRight,
      nodeStart: this.nodeStart,
      nodeCount: this.nodeCount,
      nodes: this.nodes,
    };
  }

  static fromData(data: BVHData): TriangleBVH {
    return new TriangleBVH({ coords: data.coords, weight: data.weight }, data);
  }

  /** 점 p의 일반화 와인딩 넘버. */
  winding(px: number, py: number, pz: number): number {
    if (this.count === 0) return 0;
    const c = this.coords;
    const w = this.weight;
    const order = this.order;
    const stack = this.stack;
    let sum = 0;
    let sp = 0;
    stack[sp++] = 0;
    while (sp > 0) {
      const node = stack[--sp];
      const n3 = node * 3;
      const dx = this.nodeCenter[n3] - px;
      const dy = this.nodeCenter[n3 + 1] - py;
      const dz = this.nodeCenter[n3 + 2] - pz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > this.nodeRadius2[node]) {
        const d = Math.sqrt(d2);
        // 쌍극자 근사: Ω ≈ A·d / |d|³ (A는 면적 벡터 합, d는 질의점에서 중심으로)
        sum += (this.nodeArea[n3] * dx + this.nodeArea[n3 + 1] * dy + this.nodeArea[n3 + 2] * dz) / (d2 * d);
        continue;
      }
      const left = this.nodeLeft[node];
      if (left < 0) {
        const s = this.nodeStart[node];
        const e = s + this.nodeCount[node];
        for (let i = s; i < e; i++) {
          const t = order[i];
          if (w[t] === 0) continue;
          const o = t * 9;
          const ax = c[o] - px;
          const ay = c[o + 1] - py;
          const az = c[o + 2] - pz;
          const bx = c[o + 3] - px;
          const by = c[o + 4] - py;
          const bz = c[o + 5] - pz;
          const cx = c[o + 6] - px;
          const cy = c[o + 7] - py;
          const cz = c[o + 8] - pz;
          const la = Math.sqrt(ax * ax + ay * ay + az * az);
          const lb = Math.sqrt(bx * bx + by * by + bz * bz);
          const lc = Math.sqrt(cx * cx + cy * cy + cz * cz);
          const det = ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
          const den =
            la * lb * lc + (ax * bx + ay * by + az * bz) * lc + (bx * cx + by * cy + bz * cz) * la + (cx * ax + cy * ay + cz * az) * lb;
          sum += 2 * Math.atan2(det, den);
        }
        continue;
      }
      if (sp + 2 > stack.length) throw new Error('BVH가 너무 깊습니다.');
      stack[sp++] = left;
      stack[sp++] = this.nodeRight[node];
    }
    return sum * INV_4PI;
  }

  /** p에서 가장 가까운 삼각형까지의 거리. maxDistance보다 멀면 maxDistance를 돌려준다. */
  distance(px: number, py: number, pz: number, maxDistance = Infinity): number {
    if (this.count === 0) return maxDistance;
    const c = this.coords;
    const order = this.order;
    const stack = this.stack;
    let best2 = maxDistance * maxDistance;
    let sp = 0;
    stack[sp++] = 0;
    while (sp > 0) {
      const node = stack[--sp];
      if (boxDistance2(this.nodeMin, this.nodeMax, node, px, py, pz) >= best2) continue;
      const left = this.nodeLeft[node];
      if (left < 0) {
        const s = this.nodeStart[node];
        const e = s + this.nodeCount[node];
        for (let i = s; i < e; i++) {
          const d2 = pointTriangleDistance2(px, py, pz, c, order[i] * 9);
          if (d2 < best2) best2 = d2;
        }
        continue;
      }
      const right = this.nodeRight[node];
      // 가까운 자식을 나중에 넣어 먼저 꺼낸다.
      const dl = boxDistance2(this.nodeMin, this.nodeMax, left, px, py, pz);
      const dr = boxDistance2(this.nodeMin, this.nodeMax, right, px, py, pz);
      if (sp + 2 > stack.length) throw new Error('BVH가 너무 깊습니다.');
      if (dl < dr) {
        if (dr < best2) stack[sp++] = right;
        if (dl < best2) stack[sp++] = left;
      } else {
        if (dl < best2) stack[sp++] = left;
        if (dr < best2) stack[sp++] = right;
      }
    }
    return Math.sqrt(best2);
  }

  private build(start: number, end: number, centroid: Float64Array, areaVec: Float64Array, areaLen: Float64Array): number {
    const node = this.nodes++;
    const c = this.coords;
    const order = this.order;
    let mnx = Infinity;
    let mny = Infinity;
    let mnz = Infinity;
    let mxx = -Infinity;
    let mxy = -Infinity;
    let mxz = -Infinity;
    let cmnx = Infinity;
    let cmny = Infinity;
    let cmnz = Infinity;
    let cmxx = -Infinity;
    let cmxy = -Infinity;
    let cmxz = -Infinity;
    let sa = 0;
    let scx = 0;
    let scy = 0;
    let scz = 0;
    let avx = 0;
    let avy = 0;
    let avz = 0;
    for (let i = start; i < end; i++) {
      const t = order[i];
      const o = t * 9;
      for (let k = 0; k < 9; k += 3) {
        const x = c[o + k];
        const y = c[o + k + 1];
        const z = c[o + k + 2];
        if (x < mnx) mnx = x;
        if (y < mny) mny = y;
        if (z < mnz) mnz = z;
        if (x > mxx) mxx = x;
        if (y > mxy) mxy = y;
        if (z > mxz) mxz = z;
      }
      const x = centroid[t * 3];
      const y = centroid[t * 3 + 1];
      const z = centroid[t * 3 + 2];
      if (x < cmnx) cmnx = x;
      if (y < cmny) cmny = y;
      if (z < cmnz) cmnz = z;
      if (x > cmxx) cmxx = x;
      if (y > cmxy) cmxy = y;
      if (z > cmxz) cmxz = z;
      const a = areaLen[t];
      sa += a;
      scx += a * x;
      scy += a * y;
      scz += a * z;
      avx += areaVec[t * 3];
      avy += areaVec[t * 3 + 1];
      avz += areaVec[t * 3 + 2];
    }
    const n3 = node * 3;
    this.nodeMin[n3] = mnx;
    this.nodeMin[n3 + 1] = mny;
    this.nodeMin[n3 + 2] = mnz;
    this.nodeMax[n3] = mxx;
    this.nodeMax[n3 + 1] = mxy;
    this.nodeMax[n3 + 2] = mxz;
    const ccx = sa > 0 ? scx / sa : (mnx + mxx) / 2;
    const ccy = sa > 0 ? scy / sa : (mny + mxy) / 2;
    const ccz = sa > 0 ? scz / sa : (mnz + mxz) / 2;
    this.nodeCenter[n3] = ccx;
    this.nodeCenter[n3 + 1] = ccy;
    this.nodeCenter[n3 + 2] = ccz;
    this.nodeArea[n3] = avx;
    this.nodeArea[n3 + 1] = avy;
    this.nodeArea[n3 + 2] = avz;
    let r2 = 0;
    for (const x of [mnx, mxx]) {
      for (const y of [mny, mxy]) {
        for (const z of [mnz, mxz]) {
          const d2 = (x - ccx) ** 2 + (y - ccy) ** 2 + (z - ccz) ** 2;
          if (d2 > r2) r2 = d2;
        }
      }
    }
    this.nodeRadius2[node] = r2 * FAR_FIELD_BETA * FAR_FIELD_BETA;

    if (end - start <= LEAF_SIZE) {
      this.nodeStart[node] = start;
      this.nodeCount[node] = end - start;
      return node;
    }

    const ex = cmxx - cmnx;
    const ey = cmxy - cmny;
    const ez = cmxz - cmnz;
    const axis = ex >= ey && ex >= ez ? 0 : ey >= ez ? 1 : 2;
    const mid = (start + end) >> 1;
    if (Math.max(ex, ey, ez) > 0) quickselect(order, start, end - 1, mid, centroid, axis);
    this.nodeLeft[node] = this.build(start, mid, centroid, areaVec, areaLen);
    this.nodeRight[node] = this.build(mid, end, centroid, areaVec, areaLen);
    return node;
  }
}

/** order[lo..hi]를 centroid 축 값으로 나눠 k번째가 제자리에 오게 한다. */
function quickselect(order: Int32Array, lo: number, hi: number, k: number, centroid: Float64Array, axis: number): void {
  while (hi > lo) {
    // 결정적으로 가운데 셋 중 중앙값을 피벗으로 쓴다.
    const m = (lo + hi) >> 1;
    const a = centroid[order[lo] * 3 + axis];
    const b = centroid[order[m] * 3 + axis];
    const cval = centroid[order[hi] * 3 + axis];
    const pivot = a < b ? (b < cval ? b : a < cval ? cval : a) : a < cval ? a : b < cval ? cval : b;
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (centroid[order[i] * 3 + axis] < pivot) i++;
      while (centroid[order[j] * 3 + axis] > pivot) j--;
      if (i <= j) {
        const tmp = order[i];
        order[i] = order[j];
        order[j] = tmp;
        i++;
        j--;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else return;
  }
}

function boxDistance2(min: Float64Array, max: Float64Array, node: number, px: number, py: number, pz: number): number {
  const n3 = node * 3;
  const dx = px < min[n3] ? min[n3] - px : px > max[n3] ? px - max[n3] : 0;
  const dy = py < min[n3 + 1] ? min[n3 + 1] - py : py > max[n3 + 1] ? py - max[n3 + 1] : 0;
  const dz = pz < min[n3 + 2] ? min[n3 + 2] - pz : pz > max[n3 + 2] ? pz - max[n3 + 2] : 0;
  return dx * dx + dy * dy + dz * dz;
}

/** 점과 삼각형 사이 거리의 제곱. Ericson, Real-Time Collision Detection 5.1.5. */
export function pointTriangleDistance2(px: number, py: number, pz: number, c: ArrayLike<number>, o: number): number {
  const ax = c[o];
  const ay = c[o + 1];
  const az = c[o + 2];
  const abx = c[o + 3] - ax;
  const aby = c[o + 4] - ay;
  const abz = c[o + 5] - az;
  const acx = c[o + 6] - ax;
  const acy = c[o + 7] - ay;
  const acz = c[o + 8] - az;
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
    const bpx = px - c[o + 3];
    const bpy = py - c[o + 4];
    const bpz = pz - c[o + 5];
    const d3 = abx * bpx + aby * bpy + abz * bpz;
    const d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) {
      qx = c[o + 3];
      qy = c[o + 4];
      qz = c[o + 5];
    } else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        const v = d1 / (d1 - d3);
        qx = ax + v * abx;
        qy = ay + v * aby;
        qz = az + v * abz;
      } else {
        const cpx = px - c[o + 6];
        const cpy = py - c[o + 7];
        const cpz = pz - c[o + 8];
        const d5 = abx * cpx + aby * cpy + abz * cpz;
        const d6 = acx * cpx + acy * cpy + acz * cpz;
        if (d6 >= 0 && d5 <= d6) {
          qx = c[o + 6];
          qy = c[o + 7];
          qz = c[o + 8];
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
              qx = c[o + 3] + w * (c[o + 6] - c[o + 3]);
              qy = c[o + 4] + w * (c[o + 7] - c[o + 4]);
              qz = c[o + 5] + w * (c[o + 8] - c[o + 5]);
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
  const dx = px - qx;
  const dy = py - qy;
  const dz = pz - qz;
  return dx * dx + dy * dy + dz * dz;
}
