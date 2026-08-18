import { BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial } from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import type { MeshData } from '../core/types.ts';

/**
 * 바이너리 STL로 직렬화한다.
 *
 * three의 익스포터를 거치지 않고 직접 쓴다. 중간에 씬을 만들 필요가 없어 큰
 * 메시에서 메모리를 절반 넘게 아끼고, 슬라이서가 읽는 바이트 배치를 그대로 통제할 수 있다.
 */
export function toBinarySTL(mesh: MeshData, header = 'MeshCap'): ArrayBuffer {
  const { positions, indices } = mesh;
  const triangles = indices.length / 3;

  const buffer = new ArrayBuffer(84 + triangles * 50);
  const view = new DataView(buffer);

  const headerBytes = new TextEncoder().encode(header.slice(0, 79));
  new Uint8Array(buffer, 0, 80).set(headerBytes);
  view.setUint32(80, triangles, true);

  let offset = 84;

  for (let t = 0; t < triangles; t++) {
    const ia = indices[t * 3] * 3;
    const ib = indices[t * 3 + 1] * 3;
    const ic = indices[t * 3 + 2] * 3;

    const ax = positions[ia];
    const ay = positions[ia + 1];
    const az = positions[ia + 2];
    const bx = positions[ib];
    const by = positions[ib + 1];
    const bz = positions[ib + 2];
    const cx = positions[ic];
    const cy = positions[ic + 1];
    const cz = positions[ic + 2];

    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;

    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len > 0) {
      nx /= len;
      ny /= len;
      nz /= len;
    }

    view.setFloat32(offset, nx, true);
    view.setFloat32(offset + 4, ny, true);
    view.setFloat32(offset + 8, nz, true);
    view.setFloat32(offset + 12, ax, true);
    view.setFloat32(offset + 16, ay, true);
    view.setFloat32(offset + 20, az, true);
    view.setFloat32(offset + 24, bx, true);
    view.setFloat32(offset + 28, by, true);
    view.setFloat32(offset + 32, bz, true);
    view.setFloat32(offset + 36, cx, true);
    view.setFloat32(offset + 40, cy, true);
    view.setFloat32(offset + 44, cz, true);
    view.setUint16(offset + 48, 0, true);

    offset += 50;
  }

  return buffer;
}

export function toGeometry(mesh: MeshData): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(mesh.positions, 3));
  geometry.setIndex(new BufferAttribute(mesh.indices, 1));
  geometry.computeVertexNormals();
  return geometry;
}

export async function toGLB(mesh: MeshData): Promise<ArrayBuffer> {
  const object = new Mesh(toGeometry(mesh), new MeshStandardMaterial({ color: 0xdddddd }));
  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(object, { binary: true });
  return result as ArrayBuffer;
}

export function downloadBlob(data: ArrayBuffer | string, fileName: string, mime: string): void {
  const blob = new Blob([data as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** 원본 이름에 접미사를 붙이고 확장자를 바꾼다. */
export function derivedFileName(original: string, suffix: string, extension: string): string {
  const base = original.replace(/\.[^.]+$/, '');
  return `${base}_${suffix}.${extension}`;
}
