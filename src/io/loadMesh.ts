import { BufferGeometry, Group, Mesh, Object3D, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import type { UpAxis } from '../core/classify.ts';
import type { MeshData } from '../core/types.ts';

export type MeshFormat = 'glb' | 'gltf' | 'obj' | 'stl' | 'ply';

export const SUPPORTED_EXTENSIONS = ['.glb', '.gltf', '.obj', '.stl', '.ply'] as const;

export interface LoadedMesh {
  mesh: MeshData;
  format: MeshFormat;
  fileName: string;
  byteSize: number;
  /** 원본이 몇 개의 서브메시로 나뉘어 있었는지. */
  partCount: number;
  /**
   * 파일 형식으로부터 추정한 위 방향 축.
   * glTF와 OBJ는 Y-up이 규약이고, 프린팅용 STL·PLY는 대체로 Z-up이다.
   */
  suggestedUpAxis: UpAxis;
}

export function detectFormat(fileName: string): MeshFormat | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.glb')) return 'glb';
  if (lower.endsWith('.gltf')) return 'gltf';
  if (lower.endsWith('.obj')) return 'obj';
  if (lower.endsWith('.stl')) return 'stl';
  if (lower.endsWith('.ply')) return 'ply';
  return null;
}

let dracoLoader: DRACOLoader | null = null;

/**
 * Meshy와 Tripo가 내려주는 GLB는 Draco로 압축된 경우가 흔하다.
 *
 * setDecoderPath를 부르지 않는 것이 의도한 동작이다. three가 디코더 경로를
 * import.meta.url로 잡아두어 번들러가 디코더를 함께 배포하므로, CDN에 붙지 않고도
 * 압축된 파일을 연다. 파일이 브라우저 밖으로 나가지 않는다는 전제도 지켜진다.
 */
function getDracoLoader(): DRACOLoader {
  if (!dracoLoader) dracoLoader = new DRACOLoader();
  return dracoLoader;
}

export async function loadMeshFromFile(file: File): Promise<LoadedMesh> {
  const format = detectFormat(file.name);
  if (!format) {
    throw new Error(`지원하지 않는 형식입니다. ${SUPPORTED_EXTENSIONS.join(', ')} 파일을 넣어주세요.`);
  }

  const buffer = await file.arrayBuffer();
  const root = await parseToObject(buffer, format);
  const { mesh, partCount } = flattenToMeshData(root);

  if (mesh.indices.length === 0) {
    throw new Error('삼각형을 찾지 못했습니다. 점군이나 선만 담긴 파일일 수 있습니다.');
  }

  return {
    mesh,
    format,
    fileName: file.name,
    byteSize: file.size,
    partCount,
    suggestedUpAxis: format === 'stl' || format === 'ply' ? 'z' : 'y',
  };
}

async function parseToObject(buffer: ArrayBuffer, format: MeshFormat): Promise<Object3D> {
  switch (format) {
    case 'glb':
    case 'gltf': {
      const loader = new GLTFLoader();
      loader.setDRACOLoader(getDracoLoader());
      const gltf = await loader.parseAsync(buffer, '');
      return gltf.scene;
    }
    case 'obj': {
      const text = new TextDecoder().decode(buffer);
      return new OBJLoader().parse(text);
    }
    case 'stl': {
      return wrapGeometry(new STLLoader().parse(buffer));
    }
    case 'ply': {
      return wrapGeometry(new PLYLoader().parse(buffer));
    }
  }
}

function wrapGeometry(geometry: BufferGeometry): Object3D {
  const group = new Group();
  group.add(new Mesh(geometry));
  return group;
}

/**
 * 씬 그래프의 모든 메시를 월드 좌표계의 단일 삼각형 목록으로 합친다.
 *
 * 생성형 서비스의 출력물은 몸통·머리카락·소품이 별도 노드로 나뉘어 있고 각각
 * 변환 행렬을 갖는 경우가 많다. 위상을 제대로 보려면 먼저 하나로 펴야 한다.
 */
export function flattenToMeshData(root: Object3D): { mesh: MeshData; partCount: number } {
  root.updateMatrixWorld(true);

  const positions: number[] = [];
  const indices: number[] = [];
  const scratch = new Vector3();
  let partCount = 0;

  root.traverse((object) => {
    const asMesh = object as Mesh;
    if (!asMesh.isMesh) return;

    const geometry = asMesh.geometry as BufferGeometry | undefined;
    const attribute = geometry?.getAttribute('position');
    if (!geometry || !attribute) return;

    partCount++;
    const offset = positions.length / 3;

    for (let i = 0; i < attribute.count; i++) {
      scratch.fromBufferAttribute(attribute, i).applyMatrix4(asMesh.matrixWorld);
      positions.push(scratch.x, scratch.y, scratch.z);
    }

    const index = geometry.getIndex();
    if (index) {
      for (let i = 0; i < index.count; i++) indices.push(offset + index.getX(i));
    } else {
      // 인덱스가 없으면 세 정점씩 순서대로 삼각형을 이룬다.
      for (let i = 0; i < attribute.count; i++) indices.push(offset + i);
    }
  });

  return {
    mesh: {
      positions: new Float32Array(positions),
      indices: new Uint32Array(indices),
    },
    partCount,
  };
}
