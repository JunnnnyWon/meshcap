import { describe, expect, it } from 'vitest';
import { weldVertices } from '../weld.ts';
import { buildTopology } from '../halfEdge.ts';
import { traceBoundaryLoops } from '../boundary.ts';
import { triangleCount, vertexCount } from '../types.ts';
import {
  cube,
  explode,
  flippedTetrahedron,
  jitter,
  nonManifoldFan,
  openCube,
  openCylinder,
  tetrahedron,
  twoTetrahedra,
} from '../__fixtures__/shapes.ts';

describe('weldVertices', () => {
  it('분해된 정육면체를 원래의 정점 8개로 되돌린다', () => {
    const exploded = explode(cube());
    expect(vertexCount(exploded)).toBe(36);

    const result = weldVertices(exploded);
    expect(vertexCount(result.mesh)).toBe(8);
    expect(triangleCount(result.mesh)).toBe(12);
    expect(result.mergedVertices).toBe(28);
  });

  it('용접 후에는 경계 에지가 사라져 구멍 오탐이 없어진다', () => {
    const exploded = explode(cube());

    // 용접 전에는 모든 에지가 한 면씩만 접해 구멍처럼 보인다.
    const before = buildTopology(exploded);
    expect(before.boundaryEdgeCount).toBe(36);

    const after = buildTopology(weldVertices(exploded).mesh);
    expect(after.boundaryEdgeCount).toBe(0);
  });

  it('epsilon 이내의 미세한 좌표 흔들림도 병합한다', () => {
    const exploded = explode(cube());
    const noisy = jitter(exploded, 1e-5);

    const result = weldVertices(noisy, { epsilonRatio: 1e-3 });
    expect(vertexCount(result.mesh)).toBe(8);
  });

  it('epsilon보다 큰 간격은 병합하지 않는다', () => {
    const exploded = explode(cube());
    const noisy = jitter(exploded, 0.1);

    const result = weldVertices(noisy, { epsilonRatio: 1e-6 });
    expect(vertexCount(result.mesh)).toBe(36);
  });

  it('면적이 0인 삼각형과 중복 삼각형을 제거한다', () => {
    const withJunk = {
      positions: new Float32Array([...tetrahedron().positions]),
      indices: new Uint32Array([
        ...tetrahedron().indices,
        0, 1, 1, // 퇴화
        0, 2, 1, // 첫 삼각형과 중복
      ]),
    };

    const result = weldVertices(withJunk);
    expect(result.removedDegenerateTriangles).toBe(1);
    expect(result.removedDuplicateTriangles).toBe(1);
    expect(triangleCount(result.mesh)).toBe(4);
  });

  it('NaN 좌표를 참조하는 삼각형을 걸러낸다', () => {
    const base = tetrahedron();
    const positions = new Float32Array([...base.positions, NaN, NaN, NaN]);
    const indices = new Uint32Array([...base.indices, 0, 1, 4]);

    const result = weldVertices({ positions, indices });
    expect(result.removedInvalidTriangles).toBe(1);
    expect(triangleCount(result.mesh)).toBe(4);
  });

  it('미참조 정점을 집계하고 제거한다', () => {
    const base = tetrahedron();
    const positions = new Float32Array([...base.positions, 5, 5, 5]);

    const result = weldVertices({ positions, indices: base.indices });
    expect(result.unreferencedVertices).toBe(1);
    expect(vertexCount(result.mesh)).toBe(4);
  });
});

describe('buildTopology', () => {
  it('닫힌 정사면체의 오일러 지표는 2다', () => {
    const t = buildTopology(tetrahedron());
    expect(t.edgeCount).toBe(6);
    expect(t.boundaryEdgeCount).toBe(0);
    expect(t.nonManifoldEdgeCount).toBe(0);
    expect(t.inconsistentEdgeCount).toBe(0);
    expect(t.eulerCharacteristic).toBe(2);
    expect(t.connectedComponents).toBe(1);
  });

  it('닫힌 정육면체의 오일러 지표도 2다', () => {
    const t = buildTopology(cube());
    expect(t.vertexCount).toBe(8);
    expect(t.edgeCount).toBe(18);
    expect(t.triangleCount).toBe(12);
    expect(t.eulerCharacteristic).toBe(2);
    expect(t.boundaryEdgeCount).toBe(0);
  });

  it('윗면이 열린 정육면체에서 경계 에지 4개를 찾는다', () => {
    const t = buildTopology(openCube());
    expect(t.boundaryEdgeCount).toBe(4);
    expect(t.nonManifoldEdgeCount).toBe(0);
  });

  it('세 면이 공유하는 에지를 non-manifold로 판정한다', () => {
    const t = buildTopology(nonManifoldFan());
    expect(t.nonManifoldEdgeCount).toBe(1);
  });

  it('감는 방향이 뒤집힌 면을 방향 불일치로 잡아낸다', () => {
    const t = buildTopology(flippedTetrahedron());
    expect(t.inconsistentEdgeCount).toBeGreaterThan(0);
    expect(t.boundaryEdgeCount).toBe(0);
  });

  it('떨어진 조각을 별도의 연결 요소로 센다', () => {
    const t = buildTopology(twoTetrahedra());
    expect(t.connectedComponents).toBe(2);
  });
});

describe('traceBoundaryLoops', () => {
  it('닫힌 메시에서는 루프가 없다', () => {
    expect(traceBoundaryLoops(buildTopology(cube()))).toHaveLength(0);
  });

  it('열린 정육면체에서 정점 4개짜리 루프 하나를 복원한다', () => {
    const loops = traceBoundaryLoops(buildTopology(openCube()));
    expect(loops).toHaveLength(1);
    expect(loops[0].closed).toBe(true);
    expect(loops[0].vertices).toHaveLength(4);
    // 사라진 윗면의 네 정점이어야 한다.
    expect([...loops[0].vertices].sort((a, b) => a - b)).toEqual([4, 5, 6, 7]);
  });

  it('원기둥의 위아래 개구부를 각각 하나씩 찾는다', () => {
    const loops = traceBoundaryLoops(buildTopology(openCylinder(24)));
    expect(loops).toHaveLength(2);
    expect(loops.every((l) => l.closed)).toBe(true);
    expect(loops.every((l) => l.vertices.length === 24)).toBe(true);
  });

  it('루프 방향은 인접 면이 사용한 방향을 그대로 따른다', () => {
    const loops = traceBoundaryLoops(buildTopology(openCube()));
    const seq = loops[0].vertices;

    // 인접 면이 (5→4), (4→7), (7→6), (6→5)를 썼으므로 순환 순서가 고정된다.
    const start = seq.indexOf(5);
    const rotated = [...seq.slice(start), ...seq.slice(0, start)];
    expect(rotated).toEqual([5, 4, 7, 6]);
  });

  it('큰 루프가 먼저 오도록 정렬한다', () => {
    const cylinder = openCylinder(12);
    const small = openCylinder(6, 0.2, 0.5);

    const merged = {
      positions: new Float32Array([...cylinder.positions, ...small.positions.map((v, i) => (i % 3 === 0 ? v + 20 : v))]),
      indices: new Uint32Array([
        ...cylinder.indices,
        ...Array.from(small.indices, (v) => v + cylinder.positions.length / 3),
      ]),
    };

    const loops = traceBoundaryLoops(buildTopology(merged));
    for (let i = 1; i < loops.length; i++) {
      expect(loops[i - 1].vertices.length).toBeGreaterThanOrEqual(loops[i].vertices.length);
    }
  });
});
