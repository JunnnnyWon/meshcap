import type { MeshData } from './types.ts';
import { estimateEdgeCount, hash2, IntHashTable } from './intHash.ts';

export interface Topology {
  vertexCount: number;
  triangleCount: number;
  edgeCount: number;
  /** 면 하나만 접한 에지. 구멍의 테두리를 이룬다. */
  boundaryEdgeCount: number;
  /** 세 면 이상이 접한 에지. 슬라이서가 내부/외부를 판정하지 못한다. */
  nonManifoldEdgeCount: number;
  /**
   * 반대 방향 짝을 찾지 못하고 남은 half-edge의 총 개수.
   * 표면이 실제로 열려 있는 정도를 나타내며, 이만큼이 테두리 순회의 대상이 된다.
   */
  unmatchedHalfEdgeCount: number;
  /** 두 면이 접했지만 같은 방향으로 순회해 법선이 어긋난 에지. */
  inconsistentEdgeCount: number;
  /**
   * 짝을 찾지 못한 half-edge를 면이 사용한 방향 그대로 담는다.
   * 구멍을 메울 때는 이 방향의 역방향으로 삼각형을 감아야 법선이 맞는다.
   */
  boundaryFrom: Uint32Array;
  boundaryTo: Uint32Array;
  /**
   * 각 경계 half-edge에 접한 유일한 삼각형의 인덱스.
   * Liepa 삼각화가 이웃 면과의 이면각을 계산할 때 필요하다.
   */
  boundaryFace: Uint32Array;
  /**
   * 면이 정확히 하나인 에지의 half-edge. 비다양체 잉여는 빼서, 메우기가
   * 네 번째 면을 붙이지 않게 한다.
   */
  fillFrom: Uint32Array;
  fillTo: Uint32Array;
  fillFace: Uint32Array;
  /** 정점 기준 연결 요소 수. 2 이상이면 떠 있는 조각이 있다는 뜻이다. */
  connectedComponents: number;
  /** 경계 half-edge가 두 개 이상 나가는 정점. 나비넥타이(bowtie) 형태다. */
  nonManifoldVertexCount: number;
  /** V - E + F. 닫힌 구 위상이면 2가 된다. */
  eulerCharacteristic: number;
}

class UnionFind {
  private parent: Int32Array;

  constructor(size: number) {
    this.parent = new Int32Array(size);
    for (let i = 0; i < size; i++) this.parent[i] = i;
  }

  find(x: number): number {
    let root = x;
    while (this.parent[root] !== root) root = this.parent[root];
    // 경로 압축
    let cur = x;
    while (this.parent[cur] !== root) {
      const next = this.parent[cur];
      this.parent[cur] = root;
      cur = next;
    }
    return root;
  }

  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }
}

/** 접한 면 수는 3 이상이면 전부 같은 취급이라 8비트로 포화시켜도 판정이 달라지지 않는다. */
const MAX_INCIDENT = 255;

function growUint32(source: Uint32Array, size: number): Uint32Array<ArrayBuffer> {
  const grown = new Uint32Array(size);
  grown.set(source);
  return grown;
}

function growUint8(source: Uint8Array, size: number): Uint8Array<ArrayBuffer> {
  const grown = new Uint8Array(size);
  grown.set(source);
  return grown;
}

/**
 * 삼각형 목록에서 에지 인접 관계를 만들고 위상 결함을 집계한다.
 *
 * 자료구조를 전부 타입 배열로 잡은 것은 취향이 아니라 필요다. Map과 일반 배열로
 * 같은 일을 하면 삼백만 삼각형짜리 모델에서 이 함수 하나가 1기가바이트 넘게 쓰고,
 * 브라우저 워커가 그대로 죽는다. 에지 수의 상한은 삼각형마다 세 개이므로
 * 미리 그만큼 잡아 두고 끝에서 실제 개수만 잘라 쓴다.
 */
export function buildTopology(mesh: MeshData): Topology {
  const { positions, indices } = mesh;
  const V = positions.length / 3;
  const triangleCount = indices.length / 3;
  const maxEdges = Math.max(1, indices.length);
  // 오일러 공식으로 어림한 크기에서 시작하고, 모자라면 그때 늘린다.
  // 상한인 3F로 잡아 두면 용접된 메시에서 필요량의 두 배를 물고 있게 된다.
  let capacity = estimateEdgeCount(V, triangleCount);

  let edgeLo = new Uint32Array(capacity);
  let edgeHi = new Uint32Array(capacity);
  let forward = new Uint8Array(capacity);
  let backward = new Uint8Array(capacity);
  let firstFace = new Uint32Array(capacity);
  const table = new IntHashTable(capacity, capacity);
  let edgeCount = 0;

  const growEdgeStore = () => {
    capacity = Math.min(maxEdges, Math.max(capacity + 1, Math.ceil(capacity * 1.6)));
    edgeLo = growUint32(edgeLo, capacity);
    edgeHi = growUint32(edgeHi, capacity);
    forward = growUint8(forward, capacity);
    backward = growUint8(backward, capacity);
    firstFace = growUint32(firstFace, capacity);
    table.growTo(capacity);
  };

  const uf = new UnionFind(V);
  const used = new Uint8Array(V);

  for (let t = 0; t < indices.length; t += 3) {
    const face = t / 3;
    const a = indices[t];
    const b = indices[t + 1];
    const c = indices[t + 2];

    used[a] = 1;
    used[b] = 1;
    used[c] = 1;
    uf.union(a, b);
    uf.union(b, c);

    for (let e = 0; e < 3; e++) {
      const u = e === 0 ? a : e === 1 ? b : c;
      const v = e === 0 ? b : e === 1 ? c : a;
      const lo = u < v ? u : v;
      const hi = u < v ? v : u;
      const key = hash2(lo, hi);

      let id = -1;
      for (let cand = table.first(key); cand >= 0; cand = table.after(cand)) {
        if (edgeLo[cand] === lo && edgeHi[cand] === hi) {
          id = cand;
          break;
        }
      }

      if (id < 0) {
        if (edgeCount === capacity) growEdgeStore();
        id = edgeCount++;
        edgeLo[id] = lo;
        edgeHi[id] = hi;
        firstFace[id] = face;
        table.insert(key, id);
      }

      if (u === lo) {
        if (forward[id] < MAX_INCIDENT) forward[id]++;
      } else if (backward[id] < MAX_INCIDENT) {
        backward[id]++;
      }
    }
  }

  let boundaryEdgeCount = 0;
  let nonManifoldEdgeCount = 0;
  let inconsistentEdgeCount = 0;
  let unmatchedHalfEdgeCount = 0;

  for (let id = 0; id < edgeCount; id++) {
    const total = forward[id] + backward[id];
    if (total === 1) boundaryEdgeCount++;
    else if (total === 2) {
      if (forward[id] === 2 || backward[id] === 2) inconsistentEdgeCount++;
    } else if (total >= 3) nonManifoldEdgeCount++;

    unmatchedHalfEdgeCount += Math.abs(forward[id] - backward[id]);
  }

  const boundaryFrom = new Uint32Array(unmatchedHalfEdgeCount);
  const boundaryTo = new Uint32Array(unmatchedHalfEdgeCount);
  const boundaryFace = new Uint32Array(unmatchedHalfEdgeCount);
  const fillFrom = new Uint32Array(boundaryEdgeCount);
  const fillTo = new Uint32Array(boundaryEdgeCount);
  const fillFace = new Uint32Array(boundaryEdgeCount);

  /*
   * 한 면만 접한 에지가 아니라 "짝을 찾지 못하고 남은 half-edge"를 내보낸다.
   *
   * 면 세 개가 한 에지를 공유하는 비다양체 지점에서는, 그 에지를 경계에서 빼 버리면
   * 테두리를 따라가던 순회가 그 자리에서 갈 곳을 잃고 끊긴다. 실제 생성형 출력물에서
   * 흔한 상황이고, 끊긴 테두리는 어디까지가 구멍인지 확정할 수 없어 메울 수 없다.
   *
   * 반대 방향끼리 짝을 지우는 연산은 모든 정점에서 진입 차수와 진출 차수를 똑같이
   * 줄인다. 삼각형 하나가 각 정점에 진입 하나와 진출 하나를 주므로 원래 균형이 맞고,
   * 따라서 남은 half-edge 집합도 균형이 맞는다. 균형 잡힌 유향 그래프는 반드시
   * 서로소인 순환들로 분해되므로, 이렇게 모으면 순회가 끊기지 않는다.
   *
   * 메우기용 순회는 면이 하나인 에지만 쓴다. 비다양체 잉여를 구멍으로 보면 그 에지에
   * 네 번째 면을 붙이게 된다.
   */
  let slot = 0;
  let fillSlot = 0;
  for (let id = 0; id < edgeCount; id++) {
    const surplus = forward[id] - backward[id];
    if (surplus === 0) continue;

    const from = surplus > 0 ? edgeLo[id] : edgeHi[id];
    const to = surplus > 0 ? edgeHi[id] : edgeLo[id];
    const total = forward[id] + backward[id];
    for (let k = Math.abs(surplus); k > 0; k--) {
      boundaryFrom[slot] = from;
      boundaryTo[slot] = to;
      boundaryFace[slot] = firstFace[id];
      slot++;
    }
    if (total === 1) {
      fillFrom[fillSlot] = from;
      fillTo[fillSlot] = to;
      fillFace[fillSlot] = firstFace[id];
      fillSlot++;
    }
  }

  let nonManifoldVertexCount = 0;
  if (unmatchedHalfEdgeCount > 0) {
    const outDegree = new Uint8Array(V);
    for (let i = 0; i < boundaryFrom.length; i++) {
      const from = boundaryFrom[i];
      if (outDegree[from] < MAX_INCIDENT) outDegree[from]++;
      if (outDegree[from] === 2) nonManifoldVertexCount++;
    }
  }

  const isRoot = new Uint8Array(V);
  let usedVertexCount = 0;
  let connectedComponents = 0;
  for (let v = 0; v < V; v++) {
    if (!used[v]) continue;
    usedVertexCount++;
    const root = uf.find(v);
    if (!isRoot[root]) {
      isRoot[root] = 1;
      connectedComponents++;
    }
  }

  return {
    vertexCount: V,
    triangleCount,
    edgeCount,
    boundaryEdgeCount,
    nonManifoldEdgeCount,
    inconsistentEdgeCount,
    unmatchedHalfEdgeCount,
    boundaryFrom,
    boundaryTo,
    boundaryFace,
    fillFrom,
    fillTo,
    fillFace,
    connectedComponents,
    nonManifoldVertexCount,
    eulerCharacteristic: usedVertexCount - edgeCount + triangleCount,
  };
}
