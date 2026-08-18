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
 * 경계 half-edge를 이어 붙여 구멍의 테두리 루프를 복원한다.
 *
 * 한 정점에서 경계가 여러 갈래로 갈라지는 bowtie 형태에서는 순회 순서에 따라
 * 분할 결과가 달라질 수 있다. 이 경우 임의로 한 갈래를 고르고, 남은 갈래는
 * 별도 루프로 처리한다. 결과가 달라져도 전체를 빠짐없이 덮는다는 점은 유지된다.
 */
export function traceBoundaryLoops(topology: Topology): BoundaryLoop[] {
  const { boundaryFrom, boundaryTo } = topology;
  const count = boundaryFrom.length;
  if (count === 0) return [];

  const buckets = new Map<number, number[]>();
  for (let i = 0; i < count; i++) {
    const from = boundaryFrom[i];
    const bucket = buckets.get(from);
    if (bucket) bucket.push(i);
    else buckets.set(from, [i]);
  }

  const consumed = new Uint8Array(count);

  const takeFrom = (v: number): number => {
    const bucket = buckets.get(v);
    if (!bucket) return -1;
    while (bucket.length > 0) {
      const id = bucket.pop() as number;
      if (!consumed[id]) {
        consumed[id] = 1;
        return id;
      }
    }
    return -1;
  };

  const loops: BoundaryLoop[] = [];

  for (let seed = 0; seed < count; seed++) {
    if (consumed[seed]) continue;
    consumed[seed] = 1;

    const startVertex = boundaryFrom[seed];
    const vertices: number[] = [startVertex];
    let current = seed;
    let closed = false;

    // 경계 half-edge 총 개수를 넘어서면 사이클이 꼬인 것이므로 강제 종료한다.
    for (let step = 0; step < count + 1; step++) {
      const next = boundaryTo[current];
      if (next === startVertex) {
        closed = true;
        break;
      }
      vertices.push(next);

      const following = takeFrom(next);
      if (following < 0) break;
      current = following;
    }

    if (vertices.length >= 3) {
      loops.push({ vertices, closed });
    }
  }

  // 큰 구멍부터 처리하면 시각화와 로그를 읽기 쉽다.
  loops.sort((a, b) => b.vertices.length - a.vertices.length);
  return loops;
}
