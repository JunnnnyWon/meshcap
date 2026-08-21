import { estimateEdgeCount, hash2, IntHashTable } from './intHash.ts';
import type { MeshData } from './types.ts';
import { length, sub, vertexAt } from './geom.ts';

const MAX_INCIDENT = 255;

/** 면이 둘 미만인 에지가 둘 이상이면 보이는 찢김을 닫는 삼각형이다. */
export function closesVisibleTear(ab: number, bc: number, ca: number): boolean {
  let open = 0;
  if (ab < 2) open++;
  if (bc < 2) open++;
  if (ca < 2) open++;
  return open >= 2;
}

function growUint32(source: Uint32Array, size: number): Uint32Array {
  const grown = new Uint32Array(size);
  grown.set(source);
  return grown;
}

function growUint8(source: Uint8Array, size: number): Uint8Array {
  const grown = new Uint8Array(size);
  grown.set(source);
  return grown;
}

/**
 * 무향 에지마다 접한 면 수를 세고, 뚜껑을 붙이는 동안 갱신한다.
 *
 * 면이 이미 둘인 에지에 삼각형을 하나 더 붙이면 비다양체가 된다. 구멍 메우기가
 * 그 에지를 대각선이나 테두리로 다시 쓰지 못하게 막는 조회 구조다.
 */
export class EdgeIncidence {
  private lo: Uint32Array;
  private hi: Uint32Array;
  private counts: Uint8Array;
  private table: IntHashTable;
  private edgeCount = 0;
  private capacity: number;
  /** 구축 시점의 평균 에지 길이. 이후 추가분은 반영하지 않는다. */
  readonly meanLength: number;

  constructor(mesh: MeshData) {
    const { indices, positions } = mesh;
    const V = positions.length / 3;
    const triangleCount = indices.length / 3;
    this.capacity = estimateEdgeCount(V, triangleCount);
    this.lo = new Uint32Array(this.capacity);
    this.hi = new Uint32Array(this.capacity);
    this.counts = new Uint8Array(this.capacity);
    this.table = new IntHashTable(this.capacity, this.capacity);

    let lengthSum = 0;
    let lengthCount = 0;

    for (let t = 0; t < indices.length; t += 3) {
      const a = indices[t];
      const b = indices[t + 1];
      const c = indices[t + 2];
      this.addEdge(a, b);
      this.addEdge(b, c);
      this.addEdge(c, a);
    }

    for (let id = 0; id < this.edgeCount; id++) {
      lengthSum += length(sub(vertexAt(positions, this.lo[id]), vertexAt(positions, this.hi[id])));
      lengthCount++;
    }

    this.meanLength = lengthCount > 0 ? lengthSum / lengthCount : 0;
  }

  count(a: number, b: number): number {
    const id = this.idOf(a, b);
    return id < 0 ? 0 : this.counts[id];
  }

  /** 이 삼각형을 붙이면 세 면이 모이는 에지가 생기는지. */
  wouldCreateNonManifold(a: number, b: number, c: number): boolean {
    if (a === b || b === c || c === a) return true;
    return this.count(a, b) >= 2 || this.count(b, c) >= 2 || this.count(c, a) >= 2;
  }

  /**
   * 보이는 찢김을 메우는지. 면이 아직 둘 미만인 에지가 둘 이상이면
   * 나머지 한 변이 이미 둘여도 그 삼각형은 테두리를 줄인다.
   */
  wouldCloseVisibleTear(a: number, b: number, c: number): boolean {
    if (a === b || b === c || c === a) return false;
    return closesVisibleTear(this.count(a, b), this.count(b, c), this.count(c, a));
  }

  addTriangle(a: number, b: number, c: number): void {
    this.addEdge(a, b);
    this.addEdge(b, c);
    this.addEdge(c, a);
  }

  private idOf(a: number, b: number): number {
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    const key = hash2(lo, hi);
    for (let cand = this.table.first(key); cand >= 0; cand = this.table.after(cand)) {
      if (this.lo[cand] === lo && this.hi[cand] === hi) return cand;
    }
    return -1;
  }

  private addEdge(a: number, b: number): void {
    if (a === b) return;
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    let id = this.idOf(a, b);
    if (id < 0) {
      if (this.edgeCount === this.capacity) this.grow();
      id = this.edgeCount++;
      this.lo[id] = lo;
      this.hi[id] = hi;
      this.counts[id] = 1;
      this.table.insert(hash2(lo, hi), id);
      return;
    }
    if (this.counts[id] < MAX_INCIDENT) this.counts[id]++;
  }

  private grow(): void {
    this.capacity = Math.max(this.capacity + 1, Math.ceil(this.capacity * 1.6));
    this.lo = growUint32(this.lo, this.capacity);
    this.hi = growUint32(this.hi, this.capacity);
    this.counts = growUint8(this.counts, this.capacity);
    this.table.growTo(this.capacity);
  }
}

/** 정점마다 접한 에지의 평균 길이. 구멍 세분에서 주변 밀도를 맞출 때 쓴다. */
export function computeVertexMeanEdge(mesh: MeshData): Float32Array {
  const V = mesh.positions.length / 3;
  const sum = new Float64Array(V);
  const count = new Uint16Array(V);
  const { indices, positions } = mesh;

  const acc = (a: number, b: number) => {
    const len = length(sub(vertexAt(positions, a), vertexAt(positions, b)));
    sum[a] += len;
    sum[b] += len;
    if (count[a] < 65535) count[a]++;
    if (count[b] < 65535) count[b]++;
  };

  for (let t = 0; t < indices.length; t += 3) {
    acc(indices[t], indices[t + 1]);
    acc(indices[t + 1], indices[t + 2]);
    acc(indices[t + 2], indices[t]);
  }

  const out = new Float32Array(V);
  for (let v = 0; v < V; v++) {
    out[v] = count[v] > 0 ? sum[v] / count[v] : 0;
  }
  return out;
}
