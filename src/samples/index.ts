import type { MeshData } from '../core/types.ts';
import type { UpAxis } from '../core/classify.ts';

export interface SampleModel {
  id: string;
  name: string;
  description: string;
  upAxis: UpAxis;
  build: () => MeshData;
}

/**
 * 회전체 프로파일로 몸통 형태를 만든다. 바닥은 열어 둔다.
 * 프로파일은 [반지름, 높이] 쌍이며 아래에서 위로 올라간다.
 */
function lathe(profile: [number, number][], segments: number): MeshData {
  const positions: number[] = [];
  const indices: number[] = [];
  const rings = profile.length;

  for (let r = 0; r < rings; r++) {
    const [radius, height] = profile[r];
    for (let s = 0; s < segments; s++) {
      const angle = (s / segments) * Math.PI * 2;
      positions.push(Math.cos(angle) * radius, height, Math.sin(angle) * radius);
    }
  }

  for (let r = 0; r < rings - 1; r++) {
    for (let s = 0; s < segments; s++) {
      const next = (s + 1) % segments;
      const a = r * segments + s;
      const b = r * segments + next;
      const c = (r + 1) * segments + next;
      const d = (r + 1) * segments + s;
      // 법선이 바깥을 향하도록 감는다.
      indices.push(a, c, b);
      indices.push(a, d, c);
    }
  }

  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

/** 꼭대기를 한 점으로 모아 닫는다. */
function closeTop(mesh: MeshData, segments: number): MeshData {
  const positions = [...mesh.positions];
  const indices = [...mesh.indices];
  const vertexCount = positions.length / 3;
  const ringStart = vertexCount - segments;

  let apexY = -Infinity;
  let cx = 0;
  let cz = 0;
  for (let s = 0; s < segments; s++) {
    const o = (ringStart + s) * 3;
    cx += positions[o];
    apexY = Math.max(apexY, positions[o + 1]);
    cz += positions[o + 2];
  }

  const apex = vertexCount;
  positions.push(cx / segments, apexY + 0.05, cz / segments);

  for (let s = 0; s < segments; s++) {
    const a = ringStart + s;
    const b = ringStart + ((s + 1) % segments);
    indices.push(a, apex, b);
  }

  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

/** 지정한 지점 주변의 삼각형을 지워 구멍을 뚫는다. */
function punchHoles(mesh: MeshData, seeds: [number, number, number][], radius: number): MeshData {
  const kept: number[] = [];
  const { positions, indices } = mesh;

  for (let t = 0; t < indices.length; t += 3) {
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let k = 0; k < 3; k++) {
      const o = indices[t + k] * 3;
      cx += positions[o];
      cy += positions[o + 1];
      cz += positions[o + 2];
    }
    cx /= 3;
    cy /= 3;
    cz /= 3;

    const inside = seeds.some(
      ([sx, sy, sz]) => Math.hypot(cx - sx, cy - sy, cz - sz) < radius,
    );
    if (!inside) kept.push(indices[t], indices[t + 1], indices[t + 2]);
  }

  return { positions, indices: new Uint32Array(kept) };
}

/** UV seam처럼 정점을 쪼갠다. 생성형 AI 출력물의 특징을 재현한다. */
function splitSeam(mesh: MeshData, fraction: number): MeshData {
  const positions = [...mesh.positions];
  const indices = Uint32Array.from(mesh.indices);
  const triangles = indices.length / 3;
  const step = Math.max(1, Math.floor(1 / fraction));

  for (let t = 0; t < triangles; t += step) {
    for (let k = 0; k < 3; k++) {
      const original = indices[t * 3 + k];
      const o = original * 3;
      const clone = positions.length / 3;
      positions.push(positions[o], positions[o + 1], positions[o + 2]);
      indices[t * 3 + k] = clone;
    }
  }

  return { positions: new Float32Array(positions), indices };
}

/** 일부 삼각형의 감는 방향을 뒤집는다. */
function flipSome(mesh: MeshData, step: number): MeshData {
  const indices = Uint32Array.from(mesh.indices);
  for (let t = 0; t < indices.length / 3; t += step) {
    const o = t * 3;
    const tmp = indices[o + 1];
    indices[o + 1] = indices[o + 2];
    indices[o + 2] = tmp;
  }
  return { positions: mesh.positions, indices };
}

const BUST_PROFILE: [number, number][] = [
  [0.62, 0.0],
  [0.66, 0.18],
  [0.6, 0.42],
  [0.48, 0.72],
  [0.44, 0.95],
  [0.3, 1.08],
  [0.26, 1.18],
  [0.34, 1.34],
  [0.4, 1.52],
  [0.38, 1.7],
  [0.28, 1.84],
];

/**
 * 생성형 3D 서비스 출력물에서 흔한 결함을 한 번에 담은 합성 예제.
 *
 * 실제 Meshy·Tripo 파일을 저장소에 넣으면 용량과 라이선스가 모두 걸리므로,
 * 같은 종류의 결함을 절차적으로 재현했다. 바닥 개구부, 표면에 뚫린 구멍,
 * 쪼개진 정점, 뒤집힌 면이 모두 들어 있다.
 */
function buildDefectiveBust(): MeshData {
  const segments = 40;
  let mesh = lathe(BUST_PROFILE, segments);
  mesh = closeTop(mesh, segments);
  mesh = punchHoles(
    mesh,
    [
      [0.44, 1.5, 0.18],
      [-0.3, 1.05, 0.32],
      [0.1, 0.55, -0.58],
    ],
    0.26,
  );
  mesh = splitSeam(mesh, 0.3);
  mesh = flipSome(mesh, 17);
  return mesh;
}

/** 테두리가 물결치는 개구부. 평면 투영으로는 제대로 못 메우는 사례다. */
function buildWavyTube(): MeshData {
  const segments = 48;
  const radius = 0.7;
  const height = 1.8;
  const positions: number[] = [];
  const indices: number[] = [];

  for (let s = 0; s < segments; s++) {
    const angle = (s / segments) * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    positions.push(x, 0, z);
    positions.push(x, height + Math.sin(angle * 3) * 0.32, z);
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

  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

export const SAMPLES: SampleModel[] = [
  {
    id: 'bust',
    name: '결함 합성 흉상',
    description: '바닥 개구부, 표면 구멍 3개, 쪼개진 정점, 뒤집힌 면을 모두 담은 예제',
    upAxis: 'y',
    build: buildDefectiveBust,
  },
  {
    id: 'wavy',
    name: '물결 개구부 튜브',
    description: '테두리가 평면에서 크게 벗어나 Liepa 삼각화가 필요한 예제',
    upAxis: 'y',
    build: buildWavyTube,
  },
];
