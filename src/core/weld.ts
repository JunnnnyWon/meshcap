import { computeBounds, type MeshData } from './types.ts';
import { hash3, IntHashTable } from './intHash.ts';

export interface WeldOptions {
  /** bbox 대각선 대비 병합 반경. 기본 1e-6은 float32 정밀도 한계에 맞춘 값이다. */
  epsilonRatio?: number;
  /** 비율 대신 절대 거리를 쓰고 싶을 때 지정한다. */
  absoluteEpsilon?: number;
}

export interface WeldResult {
  mesh: MeshData;
  /** 실제로 적용된 병합 반경. */
  epsilon: number;
  /** 병합되어 사라진 정점 수. */
  mergedVertices: number;
  /** 어떤 삼각형도 참조하지 않아 제거된 정점 수. */
  unreferencedVertices: number;
  /** 두 꼭짓점 이상이 같아져 면적이 0이 된 삼각형 수. */
  removedDegenerateTriangles: number;
  /** NaN/Infinity 좌표를 참조해 제거된 삼각형 수. */
  removedInvalidTriangles: number;
  /** 완전히 동일한 정점 3쌍을 쓰는 중복 삼각형 제거 수. */
  removedDuplicateTriangles: number;
  /** 원본 정점 인덱스 → 병합 후 인덱스. 제거된 정점은 -1. */
  remap: Int32Array;
}

/**
 * 공간 해시 기반 정점 병합.
 *
 * 생성형 3D 서비스의 출력물은 UV seam·머티리얼 경계마다 정점이 쪼개져 있다.
 * 좌표는 같은데 인덱스가 다르면 그 사이의 에지가 전부 "한 면만 접한 경계 에지"로
 * 잡히기 때문에, 용접을 먼저 하지 않으면 멀쩡한 모델에서도 구멍이 수백 개로 오탐된다.
 * 파이프라인의 첫 단계가 이 함수여야 하는 이유다.
 */
export function weldVertices(mesh: MeshData, options: WeldOptions = {}): WeldResult {
  const { positions, indices } = mesh;
  const srcVertexCount = positions.length / 3;

  const bounds = computeBounds(positions);
  const epsilon =
    options.absoluteEpsilon ??
    (bounds.diagonal > 0 ? bounds.diagonal * (options.epsilonRatio ?? 1e-6) : 1e-9);
  const eps2 = epsilon * epsilon;
  const cell = Math.max(epsilon, 1e-12);

  const remap = new Int32Array(srcVertexCount).fill(-1);
  // 병합 결과는 입력보다 커질 수 없으므로 상한만큼 미리 잡고 끝에서 잘라 쓴다.
  const outPositions = new Float32Array(srcVertexCount * 3);
  let outCount = 0;
  const grid = new IntHashTable(srcVertexCount);

  // 좌표가 유한한 정점만 대상으로 삼는다. NaN은 셀 좌표 계산 자체를 깨뜨린다.
  const finite = new Uint8Array(srcVertexCount);
  for (let v = 0; v < srcVertexCount; v++) {
    const o = v * 3;
    finite[v] =
      Number.isFinite(positions[o]) && Number.isFinite(positions[o + 1]) && Number.isFinite(positions[o + 2])
        ? 1
        : 0;
  }

  // 삼각형이 참조하는 정점만 남긴다. 미참조 정점은 슬라이서에서 경고를 만든다.
  const referenced = new Uint8Array(srcVertexCount);
  for (let i = 0; i < indices.length; i++) {
    const v = indices[i];
    if (v < srcVertexCount) referenced[v] = 1;
  }

  let unreferencedVertices = 0;

  for (let v = 0; v < srcVertexCount; v++) {
    if (!referenced[v]) {
      unreferencedVertices++;
      continue;
    }
    if (!finite[v]) continue;

    const o = v * 3;
    const x = positions[o];
    const y = positions[o + 1];
    const z = positions[o + 2];

    const ix = Math.floor(x / cell);
    const iy = Math.floor(y / cell);
    const iz = Math.floor(z / cell);

    // eps 거리 안의 짝은 인접 27개 셀 중 하나에 반드시 들어 있다.
    // 해시가 충돌해 남의 셀 정점이 섞여 나와도 아래 거리 검사가 걸러 준다.
    let found = -1;
    outer: for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (
            let cand = grid.first(hash3(ix + dx, iy + dy, iz + dz));
            cand >= 0;
            cand = grid.after(cand)
          ) {
            const co = cand * 3;
            const ddx = outPositions[co] - x;
            const ddy = outPositions[co + 1] - y;
            const ddz = outPositions[co + 2] - z;
            if (ddx * ddx + ddy * ddy + ddz * ddz <= eps2) {
              found = cand;
              break outer;
            }
          }
        }
      }
    }

    if (found >= 0) {
      remap[v] = found;
      continue;
    }

    const newIndex = outCount++;
    const no = newIndex * 3;
    outPositions[no] = x;
    outPositions[no + 1] = y;
    outPositions[no + 2] = z;
    remap[v] = newIndex;
    grid.insert(hash3(ix, iy, iz), newIndex);
  }

  const newVertexCount = outCount;
  const mergedVertices = srcVertexCount - unreferencedVertices - newVertexCount;

  const triangleLimit = indices.length / 3;
  const outIndices = new Uint32Array(indices.length);
  let outTriangles = 0;
  let removedDegenerateTriangles = 0;
  let removedInvalidTriangles = 0;
  let removedDuplicateTriangles = 0;

  // 정점 집합이 같은 완전 중복 삼각형을 걸러낸다. 문자열 키 Set을 쓰면
  // 삼각형 수만큼 문자열이 생겨 큰 모델에서 수백 메가바이트를 잡아먹는다.
  const triTable = new IntHashTable(triangleLimit);

  for (let t = 0; t < indices.length; t += 3) {
    const a = remap[indices[t]] ?? -1;
    const b = remap[indices[t + 1]] ?? -1;
    const c = remap[indices[t + 2]] ?? -1;

    if (a < 0 || b < 0 || c < 0) {
      removedInvalidTriangles++;
      continue;
    }
    if (a === b || b === c || a === c) {
      removedDegenerateTriangles++;
      continue;
    }

    // 방향과 무관하게 같은 정점 집합이면 중복으로 본다.
    const s0 = Math.min(a, b, c);
    const s2 = Math.max(a, b, c);
    const s1 = a + b + c - s0 - s2;

    let duplicate = false;
    for (let id = triTable.first(hash3(s0, s1, s2)); id >= 0; id = triTable.after(id)) {
      const o = id * 3;
      const ea = outIndices[o];
      const eb = outIndices[o + 1];
      const ec = outIndices[o + 2];
      const t0 = Math.min(ea, eb, ec);
      const t2 = Math.max(ea, eb, ec);
      if (t0 === s0 && t2 === s2 && ea + eb + ec - t0 - t2 === s1) {
        duplicate = true;
        break;
      }
    }
    if (duplicate) {
      removedDuplicateTriangles++;
      continue;
    }

    const slot = outTriangles++;
    const o = slot * 3;
    outIndices[o] = a;
    outIndices[o + 1] = b;
    outIndices[o + 2] = c;
    triTable.insert(hash3(s0, s1, s2), slot);
  }

  return {
    mesh: {
      // subarray가 아니라 복사본을 만든다. 뷰를 넘기면 상한만큼 잡아 둔 원본 버퍼가
      // 통째로 살아남아, 정점이 대량으로 병합된 모델에서 오히려 메모리를 더 쓴다.
      positions: outPositions.slice(0, newVertexCount * 3),
      indices: outIndices.slice(0, outTriangles * 3),
    },
    epsilon,
    mergedVertices,
    unreferencedVertices,
    removedDegenerateTriangles,
    removedInvalidTriangles,
    removedDuplicateTriangles,
    remap,
  };
}
