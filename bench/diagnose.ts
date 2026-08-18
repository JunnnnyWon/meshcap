/**
 * 특정 파일에서 테두리 추적이 왜 끊기는지 들여다본다.
 *
 *   npx tsx bench/diagnose.ts <파일>
 */
import { weldVertices } from '../src/core/weld.ts';
import { buildTopology } from '../src/core/halfEdge.ts';
import { orientOutward } from '../src/core/normals.ts';
import type { MeshData } from '../src/core/types.ts';
import { readBinarySTL } from './readStl.ts';

const path = process.argv[2];
const mesh = readBinarySTL(path);
const welded = weldVertices(mesh).mesh;

const report = (label: string, m: MeshData) => {
  const t = buildTopology(m);
  console.log(
    `${label.padEnd(12)} 경계 ${t.boundaryEdgeCount} · 비다양체 에지 ${t.nonManifoldEdgeCount} · ` +
      `방향불일치 ${t.inconsistentEdgeCount} · 비다양체 정점 ${t.nonManifoldVertexCount} · 연결요소 ${t.connectedComponents}`,
  );
  return t;
};

report('용접 후', welded);

const oriented = orientOutward(welded, { alignOutward: false });
console.log(`정렬: 뒤집은 면 ${oriented.flippedTriangles} · 모순 ${oriented.conflicts}`);
const t = report('정렬 후', oriented.mesh);

// 경계 정점의 진입/진출 차수를 비교한다. 균형이 맞으면 추적이 반드시 닫힌다.
const outDeg = new Map<number, number>();
const inDeg = new Map<number, number>();
for (let i = 0; i < t.boundaryFrom.length; i++) {
  outDeg.set(t.boundaryFrom[i], (outDeg.get(t.boundaryFrom[i]) ?? 0) + 1);
  inDeg.set(t.boundaryTo[i], (inDeg.get(t.boundaryTo[i]) ?? 0) + 1);
}

const vertices = new Set([...outDeg.keys(), ...inDeg.keys()]);
let balanced = 0;
const unbalanced: string[] = [];
for (const v of vertices) {
  const o = outDeg.get(v) ?? 0;
  const i = inDeg.get(v) ?? 0;
  if (o === i) balanced++;
  else if (unbalanced.length < 12) unbalanced.push(`정점 ${v}: 진출 ${o} 진입 ${i}`);
}

console.log(`\n경계 정점 ${vertices.size}개 중 균형 ${balanced}개, 불균형 ${vertices.size - balanced}개`);
for (const line of unbalanced) console.log(`  ${line}`);
