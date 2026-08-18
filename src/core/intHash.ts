/**
 * 정수 키 연쇄 해시 테이블.
 *
 * Map<number, number[]>로 같은 일을 할 수 있지만, 항목이 수백만 개가 되면
 * 항목마다 붙는 객체 헤더와 버킷 배열 때문에 메모리가 기가바이트 단위로 불어난다.
 * 삼백만 삼각형짜리 모델에서 이 차이가 브라우저 워커가 죽느냐 마느냐를 가른다.
 *
 * head는 슬롯마다 연쇄의 첫 항목을, next는 항목마다 다음 항목을 가리킨다.
 * 해시 충돌은 걸러 주지 않으므로 호출하는 쪽에서 실제 키를 비교해야 한다.
 */
export class IntHashTable {
  private readonly head: Int32Array;
  private next: Int32Array;
  private readonly mask: number;

  /**
   * @param capacity 담을 수 있는 항목의 최대 개수
   * @param expected 실제로 들어올 것으로 보는 항목 수. 슬롯 수를 정하는 데 쓴다.
   */
  constructor(capacity: number, expected = capacity) {
    const slots = nextPowerOfTwo(Math.max(16, Math.ceil(expected * 1.4)));
    this.head = new Int32Array(slots).fill(-1);
    this.next = new Int32Array(Math.max(1, capacity)).fill(-1);
    this.mask = slots - 1;
  }

  /** 해당 해시의 연쇄 첫 항목. 없으면 -1. */
  first(hash: number): number {
    return this.head[hash & this.mask];
  }

  /** 연쇄의 다음 항목. 끝이면 -1. */
  after(id: number): number {
    return this.next[id];
  }

  insert(hash: number, id: number): void {
    const slot = hash & this.mask;
    this.next[id] = this.head[slot];
    this.head[slot] = id;
  }

  /** 예상보다 항목이 많을 때 연쇄 배열만 늘린다. 슬롯 수는 그대로여도 정확성에는 영향이 없다. */
  growTo(capacity: number): void {
    if (capacity <= this.next.length) return;
    const grown = new Int32Array(capacity).fill(-1);
    grown.set(this.next);
    this.next = grown;
  }
}

function nextPowerOfTwo(n: number): number {
  let value = 1;
  while (value < n) value *= 2;
  return value;
}

/** 3차원 정수 좌표를 32비트 해시로 섞는다. */
export function hash3(x: number, y: number, z: number): number {
  return (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) | 0;
}

/** 정수 두 개를 32비트 해시로 섞는다. */
export function hash2(a: number, b: number): number {
  return (Math.imul(a, 73856093) ^ Math.imul(b, 19349663)) | 0;
}

/**
 * 삼각형 메시의 에지 개수를 미리 어림한다.
 *
 * 오일러 공식 V - E + F = 2에서 닫힌 표면의 에지는 V + F - 2다. 정점이 쪼개진
 * 메시는 V가 3F까지 올라가고 그때 에지도 3F가 되므로 상한과 맞아떨어진다.
 * 무조건 상한인 3F로 잡으면 용접된 메시에서 필요한 양의 두 배를 미리 물고
 * 있게 되는데, 삼백만 삼각형에서는 그 차이가 수백 메가바이트다.
 */
export function estimateEdgeCount(vertexCount: number, triangleCount: number): number {
  const upperBound = triangleCount * 3;
  if (upperBound === 0) return 1;
  // 구멍이 뚫린 표면은 V + F를 조금 넘기므로 여유를 둔다. 여기서 한 번이라도
  // 모자라면 배열을 통째로 다시 잡느라 순간 메모리가 오히려 더 든다.
  const estimate = vertexCount + triangleCount + Math.ceil(triangleCount * 0.05) + 64;
  return Math.max(16, Math.min(upperBound, estimate));
}
