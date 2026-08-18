import type { MeshData } from '../types.ts';

function mesh(positions: number[], indices: number[]): MeshData {
  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
  };
}

/** 닫힌 정사면체. V=4, E=6, F=4 이므로 오일러 지표는 2다. */
export function tetrahedron(): MeshData {
  return mesh(
    [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1],
    [0, 2, 1, 0, 3, 2, 0, 1, 3, 1, 2, 3],
  );
}

const CUBE_POSITIONS = [
  0, 0, 0, // 0
  1, 0, 0, // 1
  1, 1, 0, // 2
  0, 1, 0, // 3
  0, 0, 1, // 4
  1, 0, 1, // 5
  1, 1, 1, // 6
  0, 1, 1, // 7
];

const CUBE_TOP = [4, 5, 6, 4, 6, 7];
const CUBE_WITHOUT_TOP = [
  0, 3, 2, 0, 2, 1, // bottom (-z)
  0, 1, 5, 0, 5, 4, // front (-y)
  3, 7, 6, 3, 6, 2, // back (+y)
  0, 4, 7, 0, 7, 3, // left (-x)
  1, 2, 6, 1, 6, 5, // right (+x)
];

/** 닫힌 단위 정육면체. 모든 면의 법선이 바깥을 향한다. */
export function cube(): MeshData {
  return mesh(CUBE_POSITIONS, [...CUBE_WITHOUT_TOP, ...CUBE_TOP]);
}

/** 윗면 두 삼각형이 빠진 정육면체. 정점 4개짜리 경계 루프 하나가 생긴다. */
export function openCube(): MeshData {
  return mesh(CUBE_POSITIONS, CUBE_WITHOUT_TOP);
}

/**
 * 삼각형마다 정점을 따로 갖는 형태로 분해한다.
 * STL 파일이나 UV seam이 있는 생성형 AI 출력물과 같은 상태를 재현한다.
 */
export function explode(source: MeshData): MeshData {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < source.indices.length; i++) {
    const v = source.indices[i];
    positions.push(source.positions[v * 3], source.positions[v * 3 + 1], source.positions[v * 3 + 2]);
    indices.push(i);
  }
  return mesh(positions, indices);
}

/** 정점을 아주 조금씩 흔들어 부동소수 오차를 흉내 낸다. */
export function jitter(source: MeshData, amount: number): MeshData {
  const positions = Float32Array.from(source.positions);
  for (let i = 0; i < positions.length; i++) {
    // 결정적인 의사난수라 테스트가 흔들리지 않는다.
    const noise = Math.sin(i * 12.9898) * 43758.5453;
    positions[i] += (noise - Math.floor(noise) - 0.5) * amount;
  }
  return { positions, indices: Uint32Array.from(source.indices) };
}

/** 에지 하나를 세 면이 공유하는 non-manifold 형상. */
export function nonManifoldFan(): MeshData {
  return mesh(
    [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1],
    [0, 1, 2, 0, 1, 3, 0, 1, 4],
  );
}

/** 서로 떨어진 정사면체 두 개. 연결 요소가 2다. */
export function twoTetrahedra(): MeshData {
  const a = tetrahedron();
  const positions = [...a.positions];
  const indices = [...a.indices];
  const offset = a.positions.length / 3;
  for (let i = 0; i < a.positions.length; i += 3) {
    positions.push(a.positions[i] + 10, a.positions[i + 1], a.positions[i + 2]);
  }
  for (let i = 0; i < a.indices.length; i++) {
    indices.push(a.indices[i] + offset);
  }
  return mesh(positions, indices);
}

/** 한쪽 면의 감는 방향이 뒤집힌 정사면체. */
export function flippedTetrahedron(): MeshData {
  const t = tetrahedron();
  const indices = Uint32Array.from(t.indices);
  // 마지막 삼각형만 뒤집는다.
  const last = indices.length - 3;
  const tmp = indices[last + 1];
  indices[last + 1] = indices[last + 2];
  indices[last + 2] = tmp;
  return { positions: t.positions, indices };
}

/**
 * 옆면이 열린 원기둥. 위아래에 큰 평면 구멍이 하나씩 생긴다.
 * 피규어 바닥의 개구부를 흉내 내는 데 쓴다.
 */
export function openCylinder(segments = 24, radius = 1, height = 2): MeshData {
  const positions: number[] = [];
  const indices: number[] = [];

  for (let s = 0; s < segments; s++) {
    const angle = (s / segments) * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    positions.push(x, 0, z);
    positions.push(x, height, z);
  }

  for (let s = 0; s < segments; s++) {
    const next = (s + 1) % segments;
    const b0 = s * 2;
    const t0 = s * 2 + 1;
    const b1 = next * 2;
    const t1 = next * 2 + 1;
    indices.push(b0, b1, t1);
    indices.push(b0, t1, t0);
  }

  return mesh(positions, indices);
}
