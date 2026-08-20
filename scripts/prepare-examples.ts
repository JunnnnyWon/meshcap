/**
 * 3D AI 원본 STL을 보기용으로 줄여 public/examples에 넣는다.
 *
 *   npx tsx scripts/prepare-examples.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

function bounds(positions: Float32Array): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max };
}

function cluster(positions: Float32Array, cell: number): { positions: Float32Array; indices: Uint32Array } {
  const map = new Map<string, number>();
  const verts: number[] = [];
  const indices: number[] = [];

  const keyOf = (x: number, y: number, z: number) =>
    `${Math.floor(x / cell)}|${Math.floor(y / cell)}|${Math.floor(z / cell)}`;

  const vertex = (x: number, y: number, z: number) => {
    const key = keyOf(x, y, z);
    const existing = map.get(key);
    if (existing !== undefined) return existing;
    const id = map.size;
    map.set(key, id);
    verts.push(x, y, z);
    return id;
  };

  const triCount = positions.length / 9;
  for (let t = 0; t < triCount; t++) {
    const o = t * 9;
    const a = vertex(positions[o], positions[o + 1], positions[o + 2]);
    const b = vertex(positions[o + 3], positions[o + 4], positions[o + 5]);
    const c = vertex(positions[o + 6], positions[o + 7], positions[o + 8]);
    if (a === b || b === c || c === a) continue;
    indices.push(a, b, c);
  }

  return { positions: new Float32Array(verts), indices: new Uint32Array(indices) };
}

function writeBinaryStl(path: string, mesh: { positions: Float32Array; indices: Uint32Array }, name: string) {
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

function reduceToTarget(positions: Float32Array, target: number) {
  const { min, max } = bounds(positions);
  const diag = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  let lo = diag / 4000;
  let hi = diag / 40;
  let best = cluster(positions, (lo + hi) / 2);

  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) / 2;
    const mesh = cluster(positions, mid);
    const tris = mesh.indices.length / 3;
    best = mesh;
    if (tris > target * 1.15) lo = mid;
    else if (tris < target * 0.85) hi = mid;
    else break;
  }

  return best;
}

mkdirSync(OUT_DIR, { recursive: true });

for (const job of JOBS) {
  console.log(`읽는 중 ${job.name}: ${job.src}`);
  const soup = readBinaryStl(job.src);
  console.log(`  원본 삼각형 ${soup.length / 9}`);
  const mesh = reduceToTarget(soup, TARGET_TRIANGLES);
  const dest = join(OUT_DIR, job.dest);
  writeBinaryStl(dest, mesh, job.name);
  const mb = (readFileSync(dest).length / 1024 / 1024).toFixed(1);
  console.log(`  보기용 삼각형 ${mesh.indices.length / 3}, 정점 ${mesh.positions.length / 3}, ${mb}MB → ${dest}`);
}
