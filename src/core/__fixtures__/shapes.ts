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

/**
 * 한 정점만 공유하는 나비넥타이. 에지는 다양체인데 정점이 아니다.
 * 팬을 나눠 정점을 복제해야 두 시트가 떨어진다.
 */
export function nonManifoldFin(): MeshData {
  return mesh(
    [
      0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, -1, 0, 0, 1, 0, 1, 0, 0, 1, -1, 0, 1,
    ],
    [0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 5, 6, 0, 6, 7, 0, 7, 5],
  );
}

/**
 * 같은 평면의 사각형 두 장이 좁은 틈을 두고 마주 본다.
 * 갭 클로징이 열린 테두리를 닫힌 루프로 승격하는지 검증할 때 쓴다.
 */
export function gappedQuads(): MeshData {
  return mesh(
    [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1.02, 0, 0, 2.02, 0, 0, 2.02, 1, 0, 1.02, 1, 0],
    [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7],
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

/** 바닥면이 빠진 정사면체. 정점 3개짜리 구멍 하나가 생긴다. */
export function openTetrahedron(): MeshData {
  const t = tetrahedron();
  return mesh([...t.positions], [...t.indices].slice(0, 9));
}

/**
 * 옆면만 있는 원기둥. 위아래에 큰 평면 구멍이 하나씩 생긴다.
 * 법선은 바깥을 향하고, 위 축은 Y다. 피규어 바닥의 개구부를 흉내 내는 데 쓴다.
 *
 * topWave를 주면 윗 테두리가 물결치며 평면에서 벗어난다.
 */
export function openCylinder(
  segments = 24,
  radius = 1,
  height = 2,
  topWave = 0,
  waveCount = 3,
): MeshData {
  const positions: number[] = [];
  const indices: number[] = [];

  for (let s = 0; s < segments; s++) {
    const angle = (s / segments) * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    positions.push(x, 0, z);
    positions.push(x, height + Math.sin(angle * waveCount) * topWave, z);
  }

  for (let s = 0; s < segments; s++) {
    const next = (s + 1) % segments;
    const b0 = s * 2;
    const t0 = s * 2 + 1;
    const b1 = next * 2;
    const t1 = next * 2 + 1;
    indices.push(b0, t1, b1);
    indices.push(b0, t0, t1);
  }

  return mesh(positions, indices);
}

/**
 * 한 에지를 두 면이 공유하고, 나머지 1-face 두 변이 V자 찢김을 이룬다.
 * 가상으로 닫으면 이미 면이 둘인 변을 쓰게 되어 예전에는 삼각형이 0이었다.
 */
/**
 * 지퍼 허용 거리보다 넓고, 브리지 거리 안인 균열.
 * 닫힌 루프가 아니라 마주 보는 1-face 두 변으로만 찢어져 있다.
 */
export function wideSlit(): MeshData {
  return mesh(
    [
      0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1.035, 0, 0, 2.035, 0, 0, 2.035, 1, 0, 1.035, 1, 0,
    ],
    [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7],
  );
}

/**
 * 국소 에지 8배·대각 4%보다 넓은 평행 입술. 면내 간격이라 머리카락 가드를 통과해야 한다.
 */
export function distantParallelSlit(): MeshData {
  return mesh(
    [
      0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1.22, 0, 0, 2.22, 0, 0, 2.22, 1, 0, 1.22, 1, 0,
    ],
    [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7],
  );
}

export function twoFaceVNotch(): MeshData {
  return mesh(
    [0, 0, 0, 1, 0, 0, 0.5, 1, 0, 0.5, -1, 0],
    [0, 1, 2, 0, 1, 3],
  );
}

/**
 * 닫힌 정육면체 윗면(4-5-6) 안쪽 바로 위에 정점 하나를 두고, 이미 면이 둘인
 * 변 4-5에 삼각형을 얹는다. 새 변 8-4·8-5가 1-face로 남고, 다른 테두리와
 * 짝을 짓지 않고 안쪽 면에 붙이면 그 1-face가 사라져야 한다.
 */
export function danglingOverInterior(): MeshData {
  const closed = cube();
  const positions = [...closed.positions, 0.55, 0.22, 1.012];
  const indices = [...closed.indices, 8, 4, 5];
  return mesh(positions, indices);
}

/**
 * 닫힌 정육면체 윗면 안쪽에, 평균 에지 0.17배만큼 떠 있는 여분 삼각형.
 * 1-face 겹침 플랩이라 삭제하면 정육면체는 그대로 닫혀 있어야 한다.
 */
/**
 * 사각형 두 삼각형의 대각선 한가운데에 T자 정점이 앉은 세 번째 삼각형.
 * 안쪽 에지를 가르고 용접하면 그 T에서 난 1-face가 사라져야 한다.
 */
export function tJunctionOnDiagonal(): MeshData {
  return mesh(
    [
      0, 0, 0,
      2, 0, 0,
      2, 2, 0,
      0, 2, 0,
      1, 1, 0,
    ],
    [0, 1, 2, 0, 2, 3, 4, 1, 2],
  );
}

/**
 * 한 시트가 되어야 할 공면 사각형 두 장. 맞닿은 변만 정점이 네 개로 복제되어
 * 1-face 두 개가 남는다. 같은 방향 균열 지퍼면 그 변이 면 둘인 에지가 된다.
 */
export function duplicatedSeamQuads(): MeshData {
  const gap = 0.08;
  return mesh(
    [
      0, 0, 0,
      1, 0, 0,
      1, 1, 0,
      0, 1, 0,
      1 + gap, 0, 0,
      2 + gap, 0, 0,
      2 + gap, 1, 0,
      1 + gap, 1, 0,
    ],
    [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7],
  );
}

/**
 * 2+2+1 얇은 조각. 미매칭 변 길이가 평균 에지의 0.2배라 접으면 그 1-face가 사라진다.
 */
export function shortUnmatchedSliver(): MeshData {
  return mesh(
    [
      0, 0, 0,
      0.2, 0, 0,
      0, 1, 0,
      -1, 0, 0,
      0.2, 1, 0,
      -1, 1, 0,
      1.2, 0, 0,
      1.2, 1, 0,
    ],
    [0, 1, 2, 0, 2, 3, 1, 4, 2, 3, 2, 5, 3, 5, 0, 1, 6, 4, 4, 6, 7, 4, 7, 2],
  );
}

/**
 * 닫힌 정육면체 윗면에 안쪽 2-face(10-11)와 평균 에지의 약 0.2배만큼
 * 평행한 2+2+1 균열. 캐비티가 그 덧장을 걷어 내면 1-face가 사라지고 한 장이 된다.
 */
export function offsetCrackOnSheet(): MeshData {
  const positions = [
    ...CUBE_POSITIONS,
    0.25, 0.35, 1, // 8  interior U
    0.75, 0.35, 1, // 9  interior V
    0.25, 0.15, 1, // 10 leftover A
    0.75, 0.15, 1, // 11 leftover B
    0.5, 0.05, 1, // 12 leftover C
  ];
  const top = [
    4, 5, 8,
    5, 9, 8,
    5, 6, 9,
    4, 8, 7,
    8, 9, 7,
    7, 9, 6,
    10, 11, 12,
    10, 12, 8,
    11, 12, 9,
  ];
  return mesh(positions, [...CUBE_WITHOUT_TOP, ...top]);
}

/**
 * 닫힌 윗면의 안쪽 2-face와, 메시 에지를 공유하지 않는 2+2+1 덧장.
 * 미매칭 변은 그 안쪽 변과 평균 에지의 약 0.2배만큼 평행하다.
 * 공간 이중층 캐비티가 두 층을 한 장으로 지퍼해야 한다.
 */
export function offsetLayersNoSharedEdge(): MeshData {
  const positions = [
    ...CUBE_POSITIONS,
    0.25, 0.36, 1, // 8  interior U
    0.75, 0.36, 1, // 9  interior V
    0.25, 0.16, 1, // 10 leftover A
    0.75, 0.16, 1, // 11 leftover B
    0.5, 0.06, 1, // 12 leftover C
    0.5, 0.16, 1, // 13 leftover wing tip
  ];
  const top = [
    4, 5, 8,
    5, 9, 8,
    5, 6, 9,
    8, 9, 6,
    6, 7, 8,
    4, 8, 7,
    10, 11, 12,
    10, 12, 13,
    11, 12, 13,
  ];
  return mesh(positions, [...CUBE_WITHOUT_TOP, ...top]);
}

/**
 * 긴 1-face 미매칭 변의 가운데 1/3만 짧은 안쪽 2-face와 0.2배만큼 겹친다.
 * 메시 에지는 공유하지 않는다. 중간 부분만 갈라 지퍼하면 1-face가 줄어야 한다.
 */
export function longRimShortInteriorOverlap(): MeshData {
  const positions = [
    ...CUBE_POSITIONS,
    0.38, 0.5, 1, // 8  short interior P
    0.62, 0.5, 1, // 9  short interior Q
    0.05, 0.3, 1, // 10 long leftover A
    0.95, 0.3, 1, // 11 long leftover B
    0.5, 0.08, 1, // 12 leftover C
    0.5, 0.3, 1, // 13 leftover wing
  ];
  const top = [
    4, 5, 8,
    5, 9, 8,
    5, 6, 9,
    8, 9, 6,
    6, 7, 8,
    4, 8, 7,
    10, 12, 11,
    10, 13, 12,
    11, 12, 13,
  ];
  return mesh(positions, [...CUBE_WITHOUT_TOP, ...top]);
}

/**
 * 긴 1-face(≳8× mean) 그림자가 짧은 안쪽 2-face 여러 개로 대부분을 덮는다.
 * 메시 에지는 공유하지 않고, 꼭짓점은 AB에서 멀리 떨어져 있다.
 */
export function longRimShadowChain(): MeshData {
  const nx = 12;
  const positions: number[] = [];
  const indices: number[] = [];
  const seen = new Map<string, number>();
  const vert = (x: number, y: number, z: number) => {
    const key = `${x}:${y}:${z}`;
    const found = seen.get(key);
    if (found !== undefined) return found;
    const i = positions.length / 3;
    positions.push(x, y, z);
    seen.set(key, i);
    return i;
  };
  const quad = (a: number, b: number, c: number, d: number) => {
    indices.push(a, b, c, a, c, d);
  };
  for (let i = 0; i < nx; i++) {
    quad(vert(i, 0, 0), vert(i, 1, 0), vert(i + 1, 1, 0), vert(i + 1, 0, 0));
    quad(vert(i, 0, 0), vert(i + 1, 0, 0), vert(i + 1, 0, 1), vert(i, 0, 1));
    quad(vert(i, 1, 0), vert(i, 1, 1), vert(i + 1, 1, 1), vert(i + 1, 1, 0));
    for (let j = 0; j < 2; j++) {
      const y0 = j * 0.5;
      const y1 = (j + 1) * 0.5;
      quad(vert(i, y0, 1), vert(i + 1, y0, 1), vert(i + 1, y1, 1), vert(i, y1, 1));
    }
  }
  quad(vert(0, 0, 0), vert(0, 0, 1), vert(0, 1, 1), vert(0, 1, 0));
  quad(vert(nx, 0, 0), vert(nx, 1, 0), vert(nx, 1, 1), vert(nx, 0, 1));
  const a = positions.length / 3;
  positions.push(0.25, 0.3, 1, nx - 0.25, 0.3, 1, nx / 2, -2.4, 1, nx / 2, 0.3, 1);
  indices.push(a, a + 2, a + 1, a, a + 3, a + 2, a + 1, a + 2, a + 3);
  return mesh(positions, indices);
}

/**
 * 큰 안쪽 삼각형(세 점이 AB의 0.5배 밖에 있음) 위를 긴 1-face가 0.2배만큼
 * 어긋나 가로지른다. 큰 삼각형은 지우지 않고 가늘게 갈라 지퍼해야 한다.
 */
export function largeFaceLeftoverSliver(): MeshData {
  const nx = 8;
  const positions: number[] = [];
  const indices: number[] = [];
  const seen = new Map<string, number>();
  const vert = (x: number, y: number, z: number) => {
    const key = `${x}:${y}:${z}`;
    const found = seen.get(key);
    if (found !== undefined) return found;
    const i = positions.length / 3;
    positions.push(x, y, z);
    seen.set(key, i);
    return i;
  };
  const quad = (a: number, b: number, c: number, d: number) => {
    indices.push(a, b, c, a, c, d);
  };
  for (let i = 0; i < nx; i++) {
    quad(vert(i, 0, 0), vert(i, 1, 0), vert(i + 1, 1, 0), vert(i + 1, 0, 0));
    quad(vert(i, 0, 0), vert(i + 1, 0, 0), vert(i + 1, 0, 1), vert(i, 0, 1));
    quad(vert(i, 1, 0), vert(i, 1, 1), vert(i + 1, 1, 1), vert(i + 1, 1, 0));
  }
  quad(vert(0, 0, 0), vert(0, 0, 1), vert(0, 1, 1), vert(0, 1, 0));
  quad(vert(nx, 0, 0), vert(nx, 1, 0), vert(nx, 1, 1), vert(nx, 0, 1));
  const a = vert(0, 0, 1);
  const b = vert(nx, 0, 1);
  const c = vert(nx, 1, 1);
  const d = vert(0, 1, 1);
  indices.push(a, b, c, a, c, d);
  const base = positions.length / 3;
  positions.push(0.3, 0.2, 1, nx - 0.3, 0.2, 1, nx / 2, -2, 1, nx / 2, 0.2, 1);
  indices.push(base, base + 2, base + 1, base, base + 3, base + 2, base + 1, base + 2, base + 3);
  return mesh(positions, indices);
}

/**
 * 닫힌 삼각형 위로 0.2배만큼 떠 있는 2+2+1 leftover. 코너 1-face 스포크 없음.
 * 갭 띠가 AB를 2-face로 만들고 안쪽 삼각형은 그대로 둔다.
 */
export function leftoverGapStrip(): MeshData {
  const positions = [
    ...CUBE_POSITIONS,
    0.58, 0.2, 1.2, // 8 leftover A
    0.94, 0.32, 1.2, // 9 leftover B
    0.76, -0.9, 1.2, // 10 leftover C
    0.76, 0.26, 1.2, // 11 leftover D on AB
  ];
  const leftover = [8, 10, 9, 8, 11, 10, 9, 10, 11];
  return mesh(positions, [...CUBE_WITHOUT_TOP, ...CUBE_TOP, ...leftover]);
}

/**
 * leftover AB가 닫힌 윗면 위로 0.2배 떠 있으나 leftover 법선이 시트와 반대다.
 * 뒤집힌 허그도 갭 띠로 붙이고 안쪽 삼각형은 그대로 둔다.
 */
export function leftoverGapStripFlipped(): MeshData {
  const positions = [
    ...CUBE_POSITIONS,
    0.58, 0.2, 1.2, // 8 leftover A
    0.94, 0.32, 1.2, // 9 leftover B
    0.76, -0.9, 1.2, // 10 leftover C
    0.76, 0.26, 1.2, // 11 leftover D on AB
  ];
  const leftover = [8, 9, 10, 8, 11, 10, 9, 10, 11];
  return mesh(positions, [...CUBE_WITHOUT_TOP, ...CUBE_TOP, ...leftover]);
}

/**
 * leftover AB가 닫힌 윗면의 인접 삼각형 두 장에 나뉘어 투영된다.
 * 한 면 안에 안 들어가므로 그림자 체인을 따라 갭 띠를 깔아야 한다.
 */
export function leftoverGapStripTwoFaces(): MeshData {
  const positions = [
    ...CUBE_POSITIONS,
    0.82, 0.18, 1.2, // 8 leftover A on triangle 4-5-6
    0.18, 0.82, 1.2, // 9 leftover B on triangle 4-6-7
    0.5, -1.0, 1.2, // 10 leftover C
    0.5, 0.5, 1.2, // 11 leftover D on AB
  ];
  const leftover = [8, 9, 10, 8, 11, 10, 9, 10, 11];
  return mesh(positions, [...CUBE_WITHOUT_TOP, ...CUBE_TOP, ...leftover]);
}

/**
 * 닫힌 시트 정점 하나를 공유하는 긴 leftover 1-face.
 * 먼 끝은 시트에서 평균 에지의 약 1배만큼 떨어져 한 면 안에 안 들어간다.
 * 시트 근처를 가르면 짧은 스포크는 그리지 않고 먼 쪽만 leftover-only 갭 띠로 붙인다.
 */
export function leftoverSheetSpokeSplit(): MeshData {
  const positions = [
    ...CUBE_POSITIONS,
    -3.4, -0.5, 2.0, // 8 leftover B, away from the sheet so spatial remesh misses
    -1.6, -1.8, 1.6, // 9 leftover C
    -1.7, -0.25, 1.5, // 10 leftover D on AB
  ];
  const leftover = [4, 9, 8, 4, 10, 9, 8, 9, 10];
  return mesh(positions, [...CUBE_WITHOUT_TOP, ...CUBE_TOP, ...leftover]);
}

/**
 * 닫힌 시트의 시트 정점 둘을 leftover 1-face 현이 잇는다.
 * 중점은 시트에서 약 0.5배 떨어져 있고, 현 아래에는 안쪽 면이 있다.
 */
export function leftoverBowedChord(): MeshData {
  const positions = [
    ...CUBE_POSITIONS,
    0.5, -1.2, 0.5, // 8 leftover apex off the space diagonal 4-2
  ];
  const leftover = [4, 8, 2];
  return mesh(positions, [...CUBE_WITHOUT_TOP, ...CUBE_TOP, ...leftover]);
}

/**
 * 닫힌 시트의 시트 정점 둘을 leftover 열린 사슬(정점 6)이 잇는다.
 * 중점은 시트에서 약 0.5–1배 떨어져 있고, 사슬 아래에는 안쪽 면이 있다.
 */
export function leftoverBowedChain6(): MeshData {
  const positions = [
    ...CUBE_POSITIONS,
    0.2, -0.55, 0.7, // 8
    0.35, -0.7, 0.55, // 9
    0.65, -0.7, 0.55, // 10
    0.8, -0.55, 0.7, // 11
    0.5, -1.1, 0.4, // 12 leftover apex
  ];
  const leftover = [4, 8, 12, 8, 9, 12, 9, 10, 12, 10, 11, 12, 11, 6, 12];
  return mesh(positions, [...CUBE_WITHOUT_TOP, ...CUBE_TOP, ...leftover]);
}

/**
 * 닫힌 시트 삼각형 UVW 안으로 2+2+1 leftover의 미매칭 AB가 투영된다.
 * 코너 스포크가 있어 제약 삽입이 1-face를 줄인다.
 */
export function leftoverConstrainedInsert(): MeshData {
  const positions = [
    ...CUBE_POSITIONS,
    0.58, 0.2, 1, // 8 leftover A
    0.94, 0.32, 1, // 9 leftover B
    0.76, -0.9, 1, // 10 leftover C (apex, not welded onto the sheet)
  ];
  // D is sheet corner 4 — leftover spokes A-4 / B-4, no shared mesh edge.
  const leftover = [8, 10, 9, 8, 4, 10, 9, 10, 4];
  return mesh(positions, [...CUBE_WITHOUT_TOP, ...CUBE_TOP, ...leftover]);
}

export function overlappingFlapOnFace(): MeshData {
  const closed = cube();
  const lift = 0.17;
  const positions = [
    ...closed.positions,
    0.55, 0.18, 1 + lift,
    0.88, 0.28, 1 + lift,
    0.72, 0.52, 1 + lift,
  ];
  const indices = [...closed.indices, 8, 9, 10];
  return mesh(positions, indices);
}

/**
 * 큰 평면 한가운데에 아주 작은 삼각형 구멍이 난 메시.
 * 미세 구멍 붕괴가 삼각화 대신 한 점으로 모으는지 검증할 때 쓴다.
 */
export function planeWithPinhole(): MeshData {
  const R = 100;
  const outer: number[] = [0, 0, 0, R, 0, 0, R / 2, (R * Math.sqrt(3)) / 2, 0];
  const cx = R / 2;
  const cy = (R * Math.sqrt(3)) / 6;
  const r = 0.04;
  const inner: number[] = [];
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2 + Math.PI / 2;
    inner.push(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r, 0);
  }

  const indices: number[] = [];
  for (let i = 0; i < 3; i++) {
    const o0 = i;
    const o1 = (i + 1) % 3;
    const i0 = 3 + i;
    const i1 = 3 + ((i + 1) % 3);
    indices.push(o0, o1, i1);
    indices.push(o0, i1, i0);
  }

  return mesh([...outer, ...inner], indices);
}
