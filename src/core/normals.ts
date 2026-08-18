import type { MeshData } from './types.ts';

export interface OrientResult {
  mesh: MeshData;
  /** 감는 방향을 뒤집은 삼각형 수. */
  flippedTriangles: number;
  /** 부호 있는 부피. 닫힌 메시에서 양수면 법선이 바깥을 향한다. */
  volume: number;
  /** 방향 전파가 모순된 에지 수. 뫼비우스 띠 같은 비가향 표면에서 0이 아니다. */
  conflicts: number;
  /** 부피가 음수라서 통째로 뒤집은 껍질의 수. */
  invertedShells: number;
}

/** 삼각형 f의 원래 감는 방향에 u → v 에지가 있는지. */
function rawHasDirected(indices: Uint32Array, f: number, u: number, v: number): boolean {
  const o = f * 3;
  const a = indices[o];
  const b = indices[o + 1];
  const c = indices[o + 2];
  return (a === u && b === v) || (b === u && c === v) || (c === u && a === v);
}

/**
 * 면의 감는 방향을 이웃과 일관되게 맞추고, 껍질마다 법선이 바깥을 향하도록 뒤집는다.
 *
 * 생성형 AI 출력물은 면 방향이 뒤죽박죽인 경우가 많다. 슬라이서는 법선으로
 * 안팎을 판정하므로, 방향이 섞여 있으면 멀쩡히 닫힌 메시도 속이 빈 껍데기나
 * 뒤집힌 덩어리로 해석된다. 구멍을 다 메운 뒤에 실행해야 껍질별 부피 판정이
 * 의미를 갖는다.
 */
export function orientOutward(mesh: MeshData): OrientResult {
  const { positions, indices } = mesh;
  const V = positions.length / 3;
  const F = indices.length / 3;

  if (F === 0) {
    return { mesh, flippedTriangles: 0, volume: 0, conflicts: 0, invertedShells: 0 };
  }

  // 무방향 에지마다 접한 면을 최대 두 개까지 기록한다.
  const edgeMap = new Map<number, number>();
  const faceA: number[] = [];
  const faceB: number[] = [];
  const edgeLo: number[] = [];
  const edgeHi: number[] = [];

  for (let f = 0; f < F; f++) {
    const o = f * 3;
    for (let e = 0; e < 3; e++) {
      const u = indices[o + e];
      const v = indices[o + ((e + 1) % 3)];
      const lo = u < v ? u : v;
      const hi = u < v ? v : u;
      const key = lo * V + hi;

      let id = edgeMap.get(key);
      if (id === undefined) {
        id = faceA.length;
        edgeMap.set(key, id);
        faceA.push(f);
        faceB.push(-1);
        edgeLo.push(lo);
        edgeHi.push(hi);
      } else if (faceB[id] === -1 && faceA[id] !== f) {
        faceB[id] = f;
      }
    }
  }

  // 면 인접 리스트를 CSR 형태로 만든다.
  const degree = new Int32Array(F);
  for (let id = 0; id < faceA.length; id++) {
    if (faceB[id] === -1) continue;
    degree[faceA[id]]++;
    degree[faceB[id]]++;
  }
  const start = new Int32Array(F + 1);
  for (let f = 0; f < F; f++) start[f + 1] = start[f] + degree[f];
  const cursor = Int32Array.from(start.subarray(0, F));
  const neighborFace = new Int32Array(start[F]);
  const neighborEdge = new Int32Array(start[F]);

  for (let id = 0; id < faceA.length; id++) {
    const a = faceA[id];
    const b = faceB[id];
    if (b === -1) continue;
    neighborFace[cursor[a]] = b;
    neighborEdge[cursor[a]++] = id;
    neighborFace[cursor[b]] = a;
    neighborEdge[cursor[b]++] = id;
  }

  const flip = new Int8Array(F).fill(-1);
  let conflicts = 0;
  let invertedShells = 0;

  const queue = new Int32Array(F);
  const component: number[] = [];

  for (let seed = 0; seed < F; seed++) {
    if (flip[seed] !== -1) continue;

    flip[seed] = 0;
    let head = 0;
    let tail = 0;
    queue[tail++] = seed;
    component.length = 0;

    while (head < tail) {
      const f = queue[head++];
      component.push(f);

      for (let p = start[f]; p < start[f + 1]; p++) {
        const g = neighborFace[p];
        const id = neighborEdge[p];
        const u = edgeLo[id];
        const v = edgeHi[id];

        // f와 g가 이 에지를 실제로 어느 방향으로 지나는지 본다.
        const fRaw = rawHasDirected(indices, f, u, v) ? 1 : -1;
        const gRaw = rawHasDirected(indices, g, u, v) ? 1 : -1;
        const fEffective = flip[f] === 1 ? -fRaw : fRaw;
        // 이웃은 반드시 반대 방향으로 지나야 한다.
        const needFlip = gRaw === -fEffective ? 0 : 1;

        if (flip[g] === -1) {
          flip[g] = needFlip as 0 | 1;
          queue[tail++] = g;
        } else if (flip[g] !== needFlip) {
          conflicts++;
        }
      }
    }

    // 이 껍질의 부호 있는 부피가 음수면 통째로 뒤집는다.
    let shellVolume = 0;
    for (const f of component) {
      shellVolume += signedTetraVolume(positions, indices, f, flip[f] === 1);
    }
    if (shellVolume < 0) {
      invertedShells++;
      for (const f of component) flip[f] = flip[f] === 1 ? 0 : 1;
    }
  }

  const out = new Uint32Array(indices.length);
  let flippedTriangles = 0;
  let volume = 0;

  for (let f = 0; f < F; f++) {
    const o = f * 3;
    if (flip[f] === 1) {
      flippedTriangles++;
      out[o] = indices[o];
      out[o + 1] = indices[o + 2];
      out[o + 2] = indices[o + 1];
    } else {
      out[o] = indices[o];
      out[o + 1] = indices[o + 1];
      out[o + 2] = indices[o + 2];
    }
    volume += signedTetraVolume(positions, out, f, false);
  }

  return {
    mesh: { positions, indices: out },
    flippedTriangles,
    volume,
    conflicts,
    invertedShells,
  };
}

/** 원점과 삼각형이 이루는 사면체의 부호 있는 부피. 전부 더하면 닫힌 메시의 부피가 된다. */
function signedTetraVolume(
  positions: Float32Array,
  indices: Uint32Array,
  f: number,
  flipped: boolean,
): number {
  const o = f * 3;
  const ia = indices[o];
  const ib = indices[o + (flipped ? 2 : 1)];
  const ic = indices[o + (flipped ? 1 : 2)];

  const ax = positions[ia * 3];
  const ay = positions[ia * 3 + 1];
  const az = positions[ia * 3 + 2];
  const bx = positions[ib * 3];
  const by = positions[ib * 3 + 1];
  const bz = positions[ib * 3 + 2];
  const cx = positions[ic * 3];
  const cy = positions[ic * 3 + 1];
  const cz = positions[ic * 3 + 2];

  return (
    (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6
  );
}
