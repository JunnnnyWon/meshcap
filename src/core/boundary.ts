import type { Topology } from './halfEdge.ts';

export interface BoundaryLoop {
  /**
   * 순회 순서대로의 정점 인덱스. 인접 면이 실제로 사용한 방향과 같다.
   * 따라서 이 구멍을 메우는 삼각형은 반대 방향으로 감아야 법선이 이어진다.
   */
  vertices: number[];
  /** 시작점으로 되돌아온 닫힌 루프인지 여부. */
  closed: boolean;
}

/**
 * 경계 half-edge를 이어 붙여 테두리를 복원하고, 루프 하나가 끝날 때마다 콜백을 부른다.
 *
 * 개수만 필요한 진단 경로와 정점 목록이 필요한 보정 경로가 같은 순회를 공유한다.
 * 정점이 백만 개 넘게 쪼개진 메시에서는 경계가 수백만 개로 잡히는데, 그때마다
 * 배열을 만들면 메모리가 감당이 안 되므로 개수만 세는 쪽은 아무것도 담지 않는다.
 */
function walkBoundary(
  vertexCount: number,
  boundaryFrom: Uint32Array,
  boundaryTo: Uint32Array,
  onLoop: (vertices: number[] | null, length: number, closed: boolean) => void,
  collect: boolean,
  minLength = 3,
): void {
  const count = boundaryFrom.length;
  if (count === 0) return;

  // from 정점별로 나가는 경계 half-edge를 연쇄로 엮는다.
  const head = new Int32Array(vertexCount).fill(-1);
  const next = new Int32Array(count).fill(-1);
  for (let i = count - 1; i >= 0; i--) {
    const from = boundaryFrom[i];
    next[i] = head[from];
    head[from] = i;
  }

  const consumed = new Uint8Array(count);

  /** 아직 쓰지 않은, v에서 나가는 경계 half-edge 하나를 꺼낸다. */
  const takeFrom = (v: number): number => {
    let id = head[v];
    while (id >= 0 && consumed[id]) id = next[id];
    head[v] = id >= 0 ? next[id] : -1;
    if (id >= 0) consumed[id] = 1;
    return id;
  };

  for (let seed = 0; seed < count; seed++) {
    if (consumed[seed]) continue;
    consumed[seed] = 1;

    const startVertex = boundaryFrom[seed];
    const vertices: number[] | null = collect ? [startVertex] : null;
    let length = 1;
    let current = seed;
    let closed = false;

    // 경계 half-edge 총 개수를 넘어서면 사이클이 꼬인 것이므로 강제 종료한다.
    for (let step = 0; step < count + 1; step++) {
      const to = boundaryTo[current];
      if (to === startVertex) {
        closed = true;
        break;
      }
      vertices?.push(to);
      length++;

      const following = takeFrom(to);
      if (following < 0) break;
      current = following;
    }

    if (length >= minLength) onLoop(vertices, length, closed);
  }
}

/**
 * 구멍의 테두리 루프를 정점 목록까지 복원한다.
 *
 * 한 정점에서 경계가 여러 갈래로 갈라지는 bowtie 형태에서는 순회 순서에 따라
 * 분할 결과가 달라질 수 있다. 이 경우 임의로 한 갈래를 고르고, 남은 갈래는
 * 별도 루프로 처리한다. 결과가 달라져도 전체를 빠짐없이 덮는다는 점은 유지된다.
 */
export function traceBoundaryLoops(topology: Topology): BoundaryLoop[] {
  return collectLoops(topology.vertexCount, topology.boundaryFrom, topology.boundaryTo, 3);
}

/**
 * 면이 하나인 에지만으로 구멍을 복원한다. 비다양체 잉여는 메우지 않는다.
 */
export function traceFillableLoops(topology: Topology, minLength = 3): BoundaryLoop[] {
  return collectLoops(topology.vertexCount, topology.fillFrom, topology.fillTo, minLength);
}

/** 면이 하나인 에지를 정점 둘짜리 사슬로 돌려, 루프에 안 잡힌 찢김도 그린다. */
export function listFillableEdges(topology: Topology): number[][] {
  const edges: number[][] = [];
  const seen = new Set<string>();
  for (let i = 0; i < topology.fillFrom.length; i++) {
    const a = topology.fillFrom[i];
    const b = topology.fillTo[i];
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push([a, b]);
  }
  return edges;
}

function collectLoops(
  vertexCount: number,
  from: Uint32Array,
  to: Uint32Array,
  minLength: number,
): BoundaryLoop[] {
  const loops: BoundaryLoop[] = [];
  walkBoundary(
    vertexCount,
    from,
    to,
    (vertices, _length, closed) => {
      if (vertices) loops.push({ vertices, closed });
    },
    true,
    minLength,
  );
  loops.sort((a, b) => b.vertices.length - a.vertices.length);
  return loops;
}

/**
 * 닫히지 않은 테두리 사슬. 한 에지만 남은 조각도 포함해 갭 클로징이 끝점을 붙일 수 있게 한다.
 */
export function traceOpenChains(topology: Topology): BoundaryLoop[] {
  const chains: BoundaryLoop[] = [];
  walkBoundary(
    topology.vertexCount,
    topology.fillFrom,
    topology.fillTo,
    (vertices, _length, closed) => {
      if (vertices && !closed) chains.push({ vertices, closed });
    },
    true,
    2,
  );
  return chains;
}

/** 테두리 개수만 센다. 정점 목록을 만들지 않아 큰 메시에서도 메모리가 늘지 않는다. */
export function countBoundaryLoops(topology: Topology): number {
  let count = 0;
  walkBoundary(topology.vertexCount, topology.boundaryFrom, topology.boundaryTo, () => { count++; }, false);
  return count;
}
