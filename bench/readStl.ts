import { readFileSync } from 'node:fs';
import type { MeshData } from '../src/core/types.ts';

/**
 * 바이너리 STL을 읽는다.
 *
 * three의 로더는 브라우저 API에 기대는 부분이 있어 node 진단 스크립트에서는
 * 직접 읽는 편이 간단하다. STL은 삼각형마다 정점을 따로 담는 형식이라
 * 인덱스는 순번 그대로가 되고, 그 중복은 용접 단계에서 정리된다.
 */
export function readBinarySTL(path: string): MeshData {
  const buffer = readFileSync(path);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const triangles = view.getUint32(80, true);

  const positions = new Float32Array(triangles * 9);
  const indices = new Uint32Array(triangles * 3);

  let offset = 84;
  for (let t = 0; t < triangles; t++) {
    const base = t * 9;
    for (let k = 0; k < 3; k++) {
      positions[base + k * 3] = view.getFloat32(offset + 12 + k * 12, true);
      positions[base + k * 3 + 1] = view.getFloat32(offset + 16 + k * 12, true);
      positions[base + k * 3 + 2] = view.getFloat32(offset + 20 + k * 12, true);
      indices[t * 3 + k] = t * 3 + k;
    }
    offset += 50;
  }

  return { positions, indices };
}
