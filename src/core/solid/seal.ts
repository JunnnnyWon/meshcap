import { buildTopology } from '../halfEdge.ts';
import { traceFillableLoops } from '../boundary.ts';
import { centroidOf, vertexAt } from '../geom.ts';
import type { MeshData } from '../types.ts';

/**
 * 열린 테두리에 뚜껑을 씌운다. 솔리드화 격자를 만들기 전에만 쓴다.
 *
 * 와인딩 넘버는 표면이 닫혀 있어야 껍질 속을 1로 센다. 구멍이 크면 속이 그만큼
 * 덜 세어져 0.5에 못 미치고, 그러면 등위면이 원본 표면에 붙지 못한다. 표면이
 * 거칠어지고, 껍질 속이 "밖"으로 잡혀 빈 공간이 없던 것으로 취급된다.
 *
 * 3만2천 삼각형 모델 실측: 뚜껑을 씌우면 원본에서 떨어진 새 면이 8.3%에서 0%로
 * 줄고 원본 유지가 99.89%에서 99.94%로 올랐다.
 *
 * 뚜껑은 격자용이라 결과 표면에는 남지 않는다. 그 자리는 원래대로 닫힌다.
 */
export function sealOpenLoops(mesh: MeshData): { mesh: MeshData; sealedLoops: number } {
  const topology = buildTopology(mesh);
  if (topology.fillFrom.length === 0) return { mesh, sealedLoops: 0 };

  const loops = traceFillableLoops(topology);
  if (loops.length === 0) return { mesh, sealedLoops: 0 };

  const positions = Array.from(mesh.positions);
  const indices = Array.from(mesh.indices);
  let sealedLoops = 0;

  for (const loop of loops) {
    const v = loop.vertices;
    const n = v.length;
    if (n < 3) continue;

    const center = centroidOf(v.map((index) => vertexAt(mesh.positions, index)));
    const apex = positions.length / 3;
    positions.push(center[0], center[1], center[2]);
    for (let i = 0; i < n; i++) {
      const a = v[i];
      const b = v[(i + 1) % n];
      // 테두리는 인접 면이 (a → b)를 썼으므로 뚜껑은 (b → a)를 포함해야 법선이 이어진다.
      indices.push(b, a, apex);
    }
    sealedLoops++;
  }

  if (sealedLoops === 0) return { mesh, sealedLoops: 0 };
  return {
    mesh: { positions: new Float32Array(positions), indices: new Uint32Array(indices) },
    sealedLoops,
  };
}
