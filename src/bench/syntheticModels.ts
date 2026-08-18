import type { MeshData } from '../core/types.ts';
import type { UpAxis } from '../core/classify.ts';
import { SAMPLES } from '../samples/index.ts';

export interface SyntheticBenchModel {
  id: string;
  label: string;
  concept: string;
  upAxis: UpAxis;
  build: () => MeshData;
}

/** 위도·경도로 나눈 구. 닫힌 상태로 시작한다. */
function sphere(segments: number, rings: number, radius = 1): MeshData {
  const positions: number[] = [];
  const indices: number[] = [];

  for (let r = 0; r <= rings; r++) {
    const phi = (r / rings) * Math.PI;
    for (let s = 0; s < segments; s++) {
      const theta = (s / segments) * Math.PI * 2;
      positions.push(
        Math.sin(phi) * Math.cos(theta) * radius,
        Math.cos(phi) * radius,
        Math.sin(phi) * Math.sin(theta) * radius,
      );
    }
  }

  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      const next = (s + 1) % segments;
      const a = r * segments + s;
      const b = r * segments + next;
      const c = (r + 1) * segments + next;
      const d = (r + 1) * segments + s;
      indices.push(a, c, b);
      indices.push(a, d, c);
    }
  }

  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

/** 결정적인 의사난수. 같은 시드는 언제나 같은 결함을 만든다. */
function rng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

/** 표면 곳곳에 작은 구멍을 흩뿌린다. 머리카락 사이나 겨드랑이 결함을 흉내 낸다. */
function scatterHoles(mesh: MeshData, count: number, radius: number, seed: number): MeshData {
  const random = rng(seed);
  const { positions, indices } = mesh;
  const triangleCount = indices.length / 3;

  const seeds: [number, number, number][] = [];
  for (let i = 0; i < count; i++) {
    const t = Math.floor(random() * triangleCount) * 3;
    const v = indices[t] * 3;
    seeds.push([positions[v], positions[v + 1], positions[v + 2]]);
  }

  const kept: number[] = [];
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

    const inside = seeds.some(([sx, sy, sz]) => Math.hypot(cx - sx, cy - sy, cz - sz) < radius);
    if (!inside) kept.push(indices[t], indices[t + 1], indices[t + 2]);
  }

  return { positions, indices: new Uint32Array(kept) };
}

/** 모든 삼각형이 자기 정점을 갖도록 완전히 분해한다. STL이나 심한 UV seam 상태다. */
function explode(mesh: MeshData): MeshData {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < mesh.indices.length; i++) {
    const v = mesh.indices[i] * 3;
    positions.push(mesh.positions[v], mesh.positions[v + 1], mesh.positions[v + 2]);
    indices.push(i);
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

function flipEvery(mesh: MeshData, step: number): MeshData {
  const indices = Uint32Array.from(mesh.indices);
  for (let t = 0; t < indices.length / 3; t += step) {
    const o = t * 3;
    const tmp = indices[o + 1];
    indices[o + 1] = indices[o + 2];
    indices[o + 2] = tmp;
  }
  return { positions: mesh.positions, indices };
}

const bust = SAMPLES.find((s) => s.id === 'bust');
const wavy = SAMPLES.find((s) => s.id === 'wavy');

/**
 * 난이도를 단계별로 올린 대조군.
 *
 * 실제 생성형 출력물의 결함을 종류별로 분해해 각각이 파이프라인의 어느 단계에서
 * 걸러지는지 보이도록 구성했다. 정점 분리만 있는 모델은 용접 단계에서 끝나고,
 * 큰 개구부가 있는 모델은 분류와 전략 분기가 있어야 점수가 오른다.
 */
export const SYNTHETIC_BENCH_MODELS: SyntheticBenchModel[] = [
  {
    id: 'syn-split-only',
    label: '정점 분리만 있는 구',
    concept: '난이도 하',
    upAxis: 'y',
    build: () => explode(sphere(48, 32)),
  },
  {
    id: 'syn-scattered',
    label: '작은 구멍이 흩어진 구',
    concept: '난이도 중',
    upAxis: 'y',
    build: () => explode(scatterHoles(sphere(48, 32), 12, 0.16, 20260818)),
  },
  {
    id: 'syn-bust',
    label: '결함 합성 흉상',
    concept: '난이도 중',
    upAxis: 'y',
    build: () => bust!.build(),
  },
  {
    id: 'syn-wavy',
    label: '물결 개구부 튜브',
    concept: '난이도 상',
    upAxis: 'y',
    build: () => wavy!.build(),
  },
  {
    id: 'syn-worst',
    label: '복합 결함 구',
    concept: '난이도 상',
    upAxis: 'y',
    build: () => flipEvery(explode(scatterHoles(sphere(64, 40), 24, 0.2, 77)), 13),
  },
];
