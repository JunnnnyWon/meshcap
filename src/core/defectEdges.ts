import type { MeshData } from './types.ts';
import { estimateEdgeCount, hash2, IntHashTable } from './intHash.ts';

/**
 * 면이 하나뿐인 모서리(열린 테두리)와 셋 이상인 모서리(겹친 모서리)를 모두 돌려준다.
 *
 * 뷰어에서 빨간 선으로 그릴 목록이다. 예전에는 표면에 붙어 보이는 남은 테두리를
 * 골라 숨겼는데, 보정 전과 보정 후를 같은 기준으로 보여 주려고 전부 그린다.
 * 결과는 [a0, b0, a1, b1, ...] 쌍 배열이다.
 */
export function listDefectEdges(mesh: MeshData): Uint32Array {
  const { positions, indices } = mesh;
  const V = positions.length / 3;
  const F = indices.length / 3;
  let capacity = estimateEdgeCount(V, F);
  let lo = new Uint32Array(capacity);
  let hi = new Uint32Array(capacity);
  let count = new Uint8Array(capacity);
  const table = new IntHashTable(capacity, capacity);
  let edges = 0;

  const grow = () => {
    const next = Math.min(indices.length, Math.max(capacity + 1, Math.ceil(capacity * 1.6)));
    const nlo = new Uint32Array(next);
    nlo.set(lo);
    const nhi = new Uint32Array(next);
    nhi.set(hi);
    const ncount = new Uint8Array(next);
    ncount.set(count);
    lo = nlo;
    hi = nhi;
    count = ncount;
    capacity = next;
    table.growTo(next);
  };

  for (let t = 0; t < indices.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const u = indices[t + e];
      const v = indices[t + ((e + 1) % 3)];
      const a = u < v ? u : v;
      const b = u < v ? v : u;
      const key = hash2(a, b);
      let id = -1;
      for (let cand = table.first(key); cand >= 0; cand = table.after(cand)) {
        if (lo[cand] === a && hi[cand] === b) {
          id = cand;
          break;
        }
      }
      if (id < 0) {
        if (edges === capacity) grow();
        id = edges++;
        lo[id] = a;
        hi[id] = b;
        table.insert(key, id);
      }
      if (count[id] < 255) count[id]++;
    }
  }

  let defects = 0;
  for (let id = 0; id < edges; id++) if (count[id] !== 2) defects++;
  const out = new Uint32Array(defects * 2);
  let k = 0;
  for (let id = 0; id < edges; id++) {
    if (count[id] === 2) continue;
    out[k++] = lo[id];
    out[k++] = hi[id];
  }
  return out;
}
