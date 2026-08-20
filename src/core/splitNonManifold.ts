import { estimateEdgeCount, hash2, IntHashTable } from './intHash.ts';
import type { MeshData } from './types.ts';

export interface SplitResult {
  mesh: MeshData;
  /** 고립된 여분 면을 제거한 에지 수. */
  splitEdges: number;
  /** 시트를 찢기 위해 복제한 정점 수. */
  clonedVertices: number;
}

/**
 * 면이 셋 이상 모인 자리를 다양체에 가깝게 만든다.
 *
 * 1. 그 에지에만 붙어 있는 고립 삼각형은 제거한다.
 * 2. 작은 여분 시트(3~80면)는 정점을 복제해 본 표면에서 떼어 낸다.
 *    머리카락처럼 큰 시트는 통째로 떨어지므로 건드리지 않는다.
 * 3. 나비넥타이처럼 팬이 둘인 정점은 복사본으로 나눈다.
 */
export function splitNonManifold(mesh: MeshData): SplitResult {
  const dropped = dropIsolatedExtras(mesh);
  const split = splitManifoldFans(dropped.mesh);
  return {
    mesh: split.mesh,
    splitEdges: dropped.splitEdges,
    clonedVertices: split.clonedVertices,
  };
}

function dropIsolatedExtras(mesh: MeshData): SplitResult {
  const { positions, indices } = mesh;
  const triangleCount = indices.length / 3;
  if (triangleCount === 0) {
    return { mesh, splitEdges: 0, clonedVertices: 0 };
  }

  const { edges, lookup } = collectEdgeFaces(mesh);
  const drop = new Uint8Array(triangleCount);
  let splitEdges = 0;

  for (const edge of edges) {
    if (edge.faces.length < 3) continue;

    const fwd: number[] = [];
    const back: number[] = [];
    for (let i = 0; i < edge.faces.length; i++) {
      if (edge.orient[i] > 0) fwd.push(edge.faces[i]);
      else back.push(edge.faces[i]);
    }

    if (fwd.length > 0 && back.length > 0) {
      fwd.pop();
      back.pop();
    } else if (fwd.length >= 2) {
      fwd.pop();
      fwd.pop();
    } else if (back.length >= 2) {
      back.pop();
      back.pop();
    } else {
      continue;
    }

    const leftover = [...fwd, ...back];
    if (leftover.length === 0) continue;

    let dropped = 0;
    for (const face of leftover) {
      if (drop[face]) continue;
      if (!isIsolatedOnEdge(indices, face, edge.lo, edge.hi, lookup)) continue;
      drop[face] = 1;
      dropped++;
    }
    if (dropped > 0) splitEdges++;
  }

  if (splitEdges === 0) {
    return { mesh, splitEdges: 0, clonedVertices: 0 };
  }

  const out: number[] = [];
  for (let t = 0; t < indices.length; t += 3) {
    if (drop[t / 3]) continue;
    out.push(indices[t], indices[t + 1], indices[t + 2]);
  }

  return {
    mesh: { positions, indices: new Uint32Array(out) },
    splitEdges,
    clonedVertices: 0,
  };
}

/**
 * 정점 v에 모인 면을, 면이 둘인 에지만 건너며 팬으로 나눈다.
 * 팬이 둘인 나비넥타이 정점만 복사한다. 면이 셋인 에지의 머리카락 시트는
 * 통째로 떨어지므로 가드에 맡긴다.
 */
function splitManifoldFans(mesh: MeshData): SplitResult {
  const { positions, indices } = mesh;
  const triangleCount = indices.length / 3;
  const V = positions.length / 3;
  if (triangleCount === 0) {
    return { mesh, splitEdges: 0, clonedVertices: 0 };
  }

  const { lookup } = collectEdgeFaces(mesh);
  const vertFaces: number[][] = Array.from({ length: V }, () => []);
  for (let t = 0; t < triangleCount; t++) {
    const o = t * 3;
    vertFaces[indices[o]].push(t);
    vertFaces[indices[o + 1]].push(t);
    vertFaces[indices[o + 2]].push(t);
  }

  const outIndices = Uint32Array.from(indices);
  const extra: number[] = [];
  let clonedVertices = 0;
  let next = V;

  for (let v = 0; v < V; v++) {
    const incident = vertFaces[v];
    if (incident.length < 2) continue;

    const fans = fansAroundVertex(v, incident, indices, lookup);
    if (fans.length !== 2) continue;
    if (incident.length > 6) continue;
    if (fans[0].length < 3 || fans[1].length < 3) continue;
    fans.sort((a, b) => b.length - a.length);

    for (let f = 1; f < fans.length; f++) {
      const clone = next++;
      const o = v * 3;
      extra.push(positions[o], positions[o + 1], positions[o + 2]);
      clonedVertices++;
      for (const face of fans[f]) {
        const base = face * 3;
        if (outIndices[base] === v) outIndices[base] = clone;
        if (outIndices[base + 1] === v) outIndices[base + 1] = clone;
        if (outIndices[base + 2] === v) outIndices[base + 2] = clone;
      }
    }
  }

  if (clonedVertices === 0) {
    return { mesh, splitEdges: 0, clonedVertices: 0 };
  }

  const outPositions = new Float32Array(positions.length + extra.length);
  outPositions.set(positions);
  outPositions.set(extra, positions.length);

  return {
    mesh: { positions: outPositions, indices: outIndices },
    splitEdges: 0,
    clonedVertices,
  };
}

function fansAroundVertex(
  v: number,
  incident: number[],
  indices: Uint32Array,
  lookup: (a: number, b: number) => EdgeFaceList | undefined,
): number[][] {
  const unvisited = new Set(incident);
  const fans: number[][] = [];

  while (unvisited.size > 0) {
    let seed = -1;
    for (const face of unvisited) {
      seed = face;
      break;
    }
    const fan: number[] = [];
    const stack = [seed];
    unvisited.delete(seed);

    while (stack.length > 0) {
      const face = stack.pop()!;
      fan.push(face);
      const o = face * 3;
      const tri = [indices[o], indices[o + 1], indices[o + 2]];
      for (let k = 0; k < 3; k++) {
        if (tri[k] !== v) continue;
        const u = tri[(k + 1) % 3];
        const w = tri[(k + 2) % 3];
        tryPushFan(face, v, u, unvisited, stack, lookup);
        tryPushFan(face, v, w, unvisited, stack, lookup);
      }
    }

    fans.push(fan);
  }

  return fans;
}

function tryPushFan(
  face: number,
  v: number,
  u: number,
  unvisited: Set<number>,
  stack: number[],
  lookup: (a: number, b: number) => EdgeFaceList | undefined,
): void {
  const edge = lookup(v, u);
  if (!edge || edge.faces.length !== 2) return;
  const other = edge.faces[0] === face ? edge.faces[1] : edge.faces[0];
  if (!unvisited.has(other)) return;
  unvisited.delete(other);
  stack.push(other);
}

interface EdgeFaceList {
  lo: number;
  hi: number;
  faces: number[];
  orient: number[];
}

function isIsolatedOnEdge(
  indices: Uint32Array,
  face: number,
  lo: number,
  hi: number,
  lookup: (a: number, b: number) => EdgeFaceList | undefined,
): boolean {
  const o = face * 3;
  const tri = [indices[o], indices[o + 1], indices[o + 2]];
  const w = tri.find((x) => x !== lo && x !== hi);
  if (w === undefined) return true;

  const loCount = lookup(lo, w)?.faces.length ?? 1;
  const hiCount = lookup(hi, w)?.faces.length ?? 1;
  return loCount === 1 && hiCount === 1;
}

function collectEdgeFaces(mesh: MeshData): {
  edges: EdgeFaceList[];
  lookup: (a: number, b: number) => EdgeFaceList | undefined;
} {
  const { indices } = mesh;
  const triangleCount = indices.length / 3;
  const capacity = estimateEdgeCount(mesh.positions.length / 3, triangleCount);
  const table = new IntHashTable(Math.max(1, indices.length), capacity);
  const edges: EdgeFaceList[] = [];

  const lookup = (a: number, b: number): EdgeFaceList | undefined => {
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    const key = hash2(lo, hi);
    for (let cand = table.first(key); cand >= 0; cand = table.after(cand)) {
      const edge = edges[cand];
      if (edge.lo === lo && edge.hi === hi) return edge;
    }
    return undefined;
  };

  const get = (a: number, b: number): EdgeFaceList => {
    const existing = lookup(a, b);
    if (existing) return existing;
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    const edge: EdgeFaceList = { lo, hi, faces: [], orient: [] };
    table.insert(hash2(lo, hi), edges.length);
    edges.push(edge);
    return edge;
  };

  for (let t = 0; t < indices.length; t += 3) {
    const face = t / 3;
    const a = indices[t];
    const b = indices[t + 1];
    const c = indices[t + 2];
    const add = (u: number, v: number) => {
      const edge = get(u, v);
      edge.faces.push(face);
      edge.orient.push(u < v ? 1 : -1);
    };
    add(a, b);
    add(b, c);
    add(c, a);
  }

  return { edges, lookup };
}
