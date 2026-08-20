/**
 * 3D AI 원본 STL을 보기용으로 줄여 public/examples에 넣는다.
 *
 * 격자로 모든 점을 합치면 머리카락처럼 얇은 자리가 찢어져 가짜 구멍이 수천 개
 * 생긴다. 그래서 원본을 용접한 뒤, 진짜 테두리 정점은 합치지 않고 안쪽만 줄인다.
 *
 *   npx tsx scripts/prepare-examples.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTopology } from '../src/core/halfEdge.ts';
import type { MeshData } from '../src/core/types.ts';
import { weldVertices } from '../src/core/weld.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'examples');
const TARGET_TRIANGLES = 160_000;

const JOBS = [
  { src: '/Users/junnnny/Downloads/meshy.stl', dest: 'character-a.stl', name: '3D AI A' },
  { src: '/Users/junnnny/Downloads/Tripo.stl', dest: 'character-b.stl', name: '3D AI B' },
];

function readBinaryStl(path: string): Float32Array {
  const buf = readFileSync(path);
  const triCount = buf.readUInt32LE(80);
  const expected = 84 + triCount * 50;
  if (buf.length < expected) {
    throw new Error(`${path}: 바이너리 STL 길이가 삼각형 수와 안 맞습니다.`);
  }
  const positions = new Float32Array(triCount * 9);
  let o = 0;
  for (let t = 0; t < triCount; t++) {
    const base = 84 + t * 50 + 12;
    for (let k = 0; k < 9; k++) {
      positions[o++] = buf.readFloatLE(base + k * 4);
    }
  }
  return positions;
}

function soupToMesh(positions: Float32Array): MeshData {
  const indices = new Uint32Array(positions.length / 3);
  for (let i = 0; i < indices.length; i++) indices[i] = i;
  return weldVertices({ positions, indices }).mesh;
}

function bounds(mesh: MeshData): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = mesh.positions[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max };
}

/**
 * 격자 클러스터. 경계 정점은 셀에 넣지 않아 원본 구멍이 찢어지지 않게 한다.
 */
function cluster(mesh: MeshData, cell: number, protectBoundary: boolean): MeshData {
  const V = mesh.positions.length / 3;
  const boundary = new Uint8Array(V);
  if (protectBoundary) {
    const topology = buildTopology(mesh);
    for (let i = 0; i < topology.boundaryFrom.length; i++) {
      boundary[topology.boundaryFrom[i]] = 1;
      boundary[topology.boundaryTo[i]] = 1;
    }
  }

  const map = new Map<string, number>();
  const verts: number[] = [];
  const remap = new Int32Array(V).fill(-1);

  const keyOf = (v: number) => {
    if (boundary[v]) return `b:${v}`;
    const o = v * 3;
    const x = Math.floor(mesh.positions[o] / cell);
    const y = Math.floor(mesh.positions[o + 1] / cell);
    const z = Math.floor(mesh.positions[o + 2] / cell);
    return `${x}|${y}|${z}`;
  };

  for (let v = 0; v < V; v++) {
    const key = keyOf(v);
    const existing = map.get(key);
    if (existing !== undefined) {
      remap[v] = existing;
      continue;
    }
    const id = map.size;
    map.set(key, id);
    remap[v] = id;
    const o = v * 3;
    verts.push(mesh.positions[o], mesh.positions[o + 1], mesh.positions[o + 2]);
  }

  const indices: number[] = [];
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = remap[mesh.indices[t]];
    const b = remap[mesh.indices[t + 1]];
    const c = remap[mesh.indices[t + 2]];
    if (a < 0 || b < 0 || c < 0) continue;
    if (a === b || b === c || c === a) continue;
    indices.push(a, b, c);
  }

  return { positions: new Float32Array(verts), indices: new Uint32Array(indices) };
}

function writeBinaryStl(path: string, mesh: MeshData, name: string) {
  const triCount = mesh.indices.length / 3;
  const buf = Buffer.alloc(84 + triCount * 50);
  buf.write(`MeshCap example ${name}`.padEnd(80, ' '), 0, 80, 'ascii');
  buf.writeUInt32LE(triCount, 80);

  for (let t = 0; t < triCount; t++) {
    const ia = mesh.indices[t * 3] * 3;
    const ib = mesh.indices[t * 3 + 1] * 3;
    const ic = mesh.indices[t * 3 + 2] * 3;
    const ax = mesh.positions[ia];
    const ay = mesh.positions[ia + 1];
    const az = mesh.positions[ia + 2];
    const bx = mesh.positions[ib];
    const by = mesh.positions[ib + 1];
    const bz = mesh.positions[ib + 2];
    const cx = mesh.positions[ic];
    const cy = mesh.positions[ic + 1];
    const cz = mesh.positions[ic + 2];
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    const base = 84 + t * 50;
    buf.writeFloatLE(nx, base);
    buf.writeFloatLE(ny, base + 4);
    buf.writeFloatLE(nz, base + 8);
    buf.writeFloatLE(ax, base + 12);
    buf.writeFloatLE(ay, base + 16);
    buf.writeFloatLE(az, base + 20);
    buf.writeFloatLE(bx, base + 24);
    buf.writeFloatLE(by, base + 28);
    buf.writeFloatLE(bz, base + 32);
    buf.writeFloatLE(cx, base + 36);
    buf.writeFloatLE(cy, base + 40);
    buf.writeFloatLE(cz, base + 44);
    buf.writeUInt16LE(0, base + 48);
  }

  writeFileSync(path, buf);
}

function reduceToTarget(mesh: MeshData, target: number) {
  const { min, max } = bounds(mesh);
  const diag = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  let lo = diag / 4000;
  let hi = diag / 40;
  let best = cluster(mesh, (lo + hi) / 2, true);

  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) / 2;
    const reduced = cluster(mesh, mid, true);
    const tris = reduced.indices.length / 3;
    best = reduced;
    if (tris > target * 1.15) lo = mid;
    else if (tris < target * 0.85) hi = mid;
    else break;
  }

  return best;
}

mkdirSync(OUT_DIR, { recursive: true });

for (const job of JOBS) {
  if (!existsSync(job.src)) {
    console.warn(`건너뜀 ${job.name}: 원본이 없습니다 (${job.src})`);
    continue;
  }
  console.log(`읽는 중 ${job.name}: ${job.src}`);
  const soup = readBinaryStl(job.src);
  console.log(`  원본 삼각형 ${soup.length / 9}`);
  const welded = soupToMesh(soup);
  console.log(`  용접 후 정점 ${welded.positions.length / 3}, 삼각형 ${welded.indices.length / 3}`);
  const mesh = reduceToTarget(welded, TARGET_TRIANGLES);
  const dest = join(OUT_DIR, job.dest);
  writeBinaryStl(dest, mesh, job.name);
  const mb = (readFileSync(dest).length / 1024 / 1024).toFixed(1);
  console.log(`  보기용 삼각형 ${mesh.indices.length / 3}, 정점 ${mesh.positions.length / 3}, ${mb}MB → ${dest}`);
}
