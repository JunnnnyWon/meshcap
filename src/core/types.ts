/**
 * 코어 전체가 공유하는 최소 메시 표현.
 *
 * three.js 타입에 의존하지 않는 것이 중요하다. 같은 코드를 브라우저 워커와
 * node 벤치마크 스크립트에서 그대로 실행해 동일한 수치를 얻기 위해서다.
 */
export interface MeshData {
  /** 정점 좌표. length === vertexCount * 3 */
  positions: Float32Array;
  /** 삼각형 인덱스. length === triangleCount * 3 */
  indices: Uint32Array;
}

export function vertexCount(mesh: MeshData): number {
  return mesh.positions.length / 3;
}

export function triangleCount(mesh: MeshData): number {
  return mesh.indices.length / 3;
}

export function emptyMesh(): MeshData {
  return { positions: new Float32Array(0), indices: new Uint32Array(0) };
}

/** 정점 i의 좌표를 out에 기록한다. 할당을 피하려고 out을 재사용한다. */
export function getVertex(mesh: MeshData, i: number, out: [number, number, number]): [number, number, number] {
  const o = i * 3;
  out[0] = mesh.positions[o];
  out[1] = mesh.positions[o + 1];
  out[2] = mesh.positions[o + 2];
  return out;
}

export interface Bounds {
  min: [number, number, number];
  max: [number, number, number];
  size: [number, number, number];
  center: [number, number, number];
  diagonal: number;
}

export function computeBounds(positions: Float32Array): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  if (!Number.isFinite(minX)) {
    return {
      min: [0, 0, 0],
      max: [0, 0, 0],
      size: [0, 0, 0],
      center: [0, 0, 0],
      diagonal: 0,
    };
  }

  const sx = maxX - minX;
  const sy = maxY - minY;
  const sz = maxZ - minZ;

  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    size: [sx, sy, sz],
    center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
    diagonal: Math.hypot(sx, sy, sz),
  };
}
