import type { MeshData } from './types.ts';

export interface Topology {
  vertexCount: number;
  triangleCount: number;
  edgeCount: number;
  /** 면 하나만 접한 에지. 구멍의 테두리를 이룬다. */
  boundaryEdgeCount: number;
  /** 세 면 이상이 접한 에지. 슬라이서가 내부/외부를 판정하지 못한다. */
  nonManifoldEdgeCount: number;
  /** 두 면이 접했지만 같은 방향으로 순회해 법선이 어긋난 에지. */
  inconsistentEdgeCount: number;
  /**
   * 경계 half-edge를 면이 사용한 방향 그대로 담는다.
   * 구멍을 메울 때는 이 방향의 역방향으로 삼각형을 감아야 법선이 맞는다.
   */
  boundaryFrom: Uint32Array;
  boundaryTo: Uint32Array;
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

/**
 * 삼각형 목록에서 에지 인접 관계를 만들고 위상 결함을 집계한다.
 *
 * 무방향 에지 {u,v}를 u*V+v 정수 키로 해시한다. V가 3백만을 넘지 않는 한
 * 안전하게 double 정수 범위 안에 들어가므로 문자열 키보다 훨씬 빠르다.
 */
export function buildTopology(mesh: MeshData): Topology {
  const { positions, indices } = mesh;
  const V = positions.length / 3;
  const triangleCount = indices.length / 3;

  const edgeMap = new Map<number, number>();
  const edgeLo: number[] = [];
  const edgeHi: number[] = [];
  const forward: number[] = [];
  const backward: number[] = [];

  const uf = new UnionFind(V);
  const used = new Uint8Array(V);

  for (let t = 0; t < indices.length; t += 3) {
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
      const key = lo * V + hi;

      let id = edgeMap.get(key);
      if (id === undefined) {
        id = edgeLo.length;
        edgeMap.set(key, id);
        edgeLo.push(lo);
        edgeHi.push(hi);
        forward.push(0);
        backward.push(0);
      }
      if (u === lo) forward[id]++;
      else backward[id]++;
    }
  }

  const edgeCount = edgeLo.length;
  let boundaryEdgeCount = 0;
  let nonManifoldEdgeCount = 0;
  let inconsistentEdgeCount = 0;

  const bFrom: number[] = [];
  const bTo: number[] = [];

  for (let id = 0; id < edgeCount; id++) {
    const f = forward[id];
    const b = backward[id];
    const total = f + b;

    if (total === 1) {
      boundaryEdgeCount++;
      // 면이 실제로 순회한 방향을 그대로 보존한다.
      if (f === 1) {
        bFrom.push(edgeLo[id]);
        bTo.push(edgeHi[id]);
      } else {
        bFrom.push(edgeHi[id]);
        bTo.push(edgeLo[id]);
      }
    } else if (total === 2) {
      if (f === 2 || b === 2) inconsistentEdgeCount++;
    } else if (total >= 3) {
      nonManifoldEdgeCount++;
    }
  }

  const outDegree = new Map<number, number>();
  for (let i = 0; i < bFrom.length; i++) {
    outDegree.set(bFrom[i], (outDegree.get(bFrom[i]) ?? 0) + 1);
  }
  let nonManifoldVertexCount = 0;
  for (const count of outDegree.values()) {
    if (count > 1) nonManifoldVertexCount++;
  }

  const roots = new Set<number>();
  let usedVertexCount = 0;
  for (let v = 0; v < V; v++) {
    if (!used[v]) continue;
    usedVertexCount++;
    roots.add(uf.find(v));
  }

  return {
    vertexCount: V,
    triangleCount,
    edgeCount,
    boundaryEdgeCount,
    nonManifoldEdgeCount,
    inconsistentEdgeCount,
    boundaryFrom: new Uint32Array(bFrom),
    boundaryTo: new Uint32Array(bTo),
    connectedComponents: roots.size,
    nonManifoldVertexCount,
    eulerCharacteristic: usedVertexCount - edgeCount + triangleCount,
  };
}
