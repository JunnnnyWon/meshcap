import { hash3, IntHashTable } from './intHash.ts';
import type { MeshData } from './types.ts';

/**
 * 정점 재배치표를 적용하고 퇴화·중복 삼각형과 미참조 정점을 버린다.
 *
 * remap[i]가 음수이면 정점 i는 삭제된다. 같은 값으로 모인 정점은 대표 인덱스의
 * 좌표를 쓰고, 그룹 좌표를 미리 바꿔 두고 호출하는 쪽이 무게중심을 정한다.
 */
export function remapAndCompact(mesh: MeshData, remap: Int32Array): MeshData {
  const { positions, indices } = mesh;
  const srcVertexCount = positions.length / 3;
  const used = new Int32Array(srcVertexCount).fill(-1);
  const outPositions: number[] = [];
  let next = 0;

  const compactIndex = (src: number): number => {
    const mapped = remap[src];
    if (mapped < 0) return -1;
    if (used[mapped] >= 0) return used[mapped];
    const dest = next++;
    used[mapped] = dest;
    const o = mapped * 3;
    outPositions.push(positions[o], positions[o + 1], positions[o + 2]);
    return dest;
  };

  const triangleLimit = indices.length / 3;
  const outIndices = new Uint32Array(indices.length);
  const triTable = new IntHashTable(Math.max(1, triangleLimit));
  let outTriangles = 0;

  for (let t = 0; t < indices.length; t += 3) {
    const a = compactIndex(indices[t]);
    const b = compactIndex(indices[t + 1]);
    const c = compactIndex(indices[t + 2]);
    if (a < 0 || b < 0 || c < 0) continue;
    if (a === b || b === c || a === c) continue;

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
    if (duplicate) continue;

    const slot = outTriangles++;
    const o = slot * 3;
    outIndices[o] = a;
    outIndices[o + 1] = b;
    outIndices[o + 2] = c;
    triTable.insert(hash3(s0, s1, s2), slot);
  }

  return {
    positions: new Float32Array(outPositions),
    indices: outIndices.slice(0, outTriangles * 3),
  };
}

/**
 * 각 그룹의 정점을 무게중심으로 모은 뒤 하나의 인덱스로 합친다.
 * 그룹이 비어 있으면 입력을 그대로 돌려준다.
 */
export function mergeVertexGroups(mesh: MeshData, groups: number[][]): MeshData {
  if (groups.length === 0) return mesh;

  const V = mesh.positions.length / 3;
  const remap = new Int32Array(V);
  for (let i = 0; i < V; i++) remap[i] = i;
  const positions = new Float32Array(mesh.positions);

  for (const group of groups) {
    if (group.length < 2) continue;
    let dest = group[0];
    for (const v of group) if (v < dest) dest = v;

    let x = 0;
    let y = 0;
    let z = 0;
    let n = 0;
    for (const v of group) {
      if (v < 0 || v >= V) continue;
      const o = v * 3;
      x += positions[o];
      y += positions[o + 1];
      z += positions[o + 2];
      n++;
    }
    if (n === 0) continue;
    const o = dest * 3;
    positions[o] = x / n;
    positions[o + 1] = y / n;
    positions[o + 2] = z / n;
    for (const v of group) {
      if (v >= 0 && v < V) remap[v] = dest;
    }
  }

  return remapAndCompact({ positions, indices: mesh.indices }, remap);
}
