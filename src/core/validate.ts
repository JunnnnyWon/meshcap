import { buildTopology } from './halfEdge.ts';
import { countBoundaryLoops } from './boundary.ts';
import { computeBounds, type MeshData } from './types.ts';

export interface ValidationReport {
  vertexCount: number;
  triangleCount: number;
  edgeCount: number;
  boundaryEdgeCount: number;
  boundaryLoopCount: number;
  nonManifoldEdgeCount: number;
  nonManifoldVertexCount: number;
  inconsistentEdgeCount: number;
  connectedComponents: number;
  eulerCharacteristic: number;
  /** 경계 에지가 하나도 없는 상태. 슬라이서가 요구하는 최소 조건이다. */
  watertight: boolean;
  degenerateTriangles: number;
  degenerateRatio: number;
  /** 부호 없는 부피. 법선 정렬 후에 재야 의미가 있다. */
  volume: number;
  surfaceArea: number;
  /** 새로 만든 뚜껑이 기존 표면을 뚫고 지나간 횟수. */
  capSelfIntersections: number;
  /** 메시가 너무 커서 교차 검사를 건너뛰었는지. */
  selfIntersectionChecked: boolean;
}

export interface ValidateOptions {
  /**
   * 뚜껑 삼각형이 시작되는 인덱스. 파이프라인은 뚜껑을 항상 뒤에 덧붙이므로
   * 이 지점 이후만 검사하면 새로 만든 면이 기존 표면을 뚫었는지 알 수 있다.
   */
  capTriangleStart?: number;
  /** 이 삼각형 수를 넘으면 교차 검사를 건너뛴다. */
  selfIntersectionLimit?: number;
}

const DEFAULT_SELF_INTERSECTION_LIMIT = 600_000;

export function validateMesh(mesh: MeshData, options: ValidateOptions = {}): ValidationReport {
  const topology = buildTopology(mesh);
  // 개수만 쓰므로 정점 목록은 만들지 않는다. 정점이 쪼개진 원본에서는 테두리가
  // 수백만 개로 잡히는데, 그때마다 배열을 만들면 진단 한 번에 메모리가 바닥난다.
  const boundaryLoopCount = countBoundaryLoops(topology);
  const bounds = computeBounds(mesh.positions);

  const { positions, indices } = mesh;
  const F = indices.length / 3;

  const areaThreshold = Math.max(bounds.diagonal * bounds.diagonal * 1e-10, Number.MIN_VALUE);
  let degenerateTriangles = 0;
  let surfaceArea = 0;
  let volume = 0;

  for (let f = 0; f < F; f++) {
    const o = f * 3;
    const ia = indices[o] * 3;
    const ib = indices[o + 1] * 3;
    const ic = indices[o + 2] * 3;

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

    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;

    const area = Math.hypot(nx, ny, nz) / 2;
    surfaceArea += area;
    if (area <= areaThreshold) degenerateTriangles++;

    volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }

  const limit = options.selfIntersectionLimit ?? DEFAULT_SELF_INTERSECTION_LIMIT;
  const canCheck = options.capTriangleStart !== undefined && F <= limit;
  const capSelfIntersections = canCheck
    ? countCapIntersections(mesh, options.capTriangleStart as number, bounds.diagonal)
    : 0;

  return {
    vertexCount: topology.vertexCount,
    triangleCount: topology.triangleCount,
    edgeCount: topology.edgeCount,
    boundaryEdgeCount: topology.boundaryEdgeCount,
    boundaryLoopCount,
    nonManifoldEdgeCount: topology.nonManifoldEdgeCount,
    nonManifoldVertexCount: topology.nonManifoldVertexCount,
    inconsistentEdgeCount: topology.inconsistentEdgeCount,
    connectedComponents: topology.connectedComponents,
    eulerCharacteristic: topology.eulerCharacteristic,
    watertight: topology.boundaryEdgeCount === 0,
    degenerateTriangles,
    degenerateRatio: F > 0 ? degenerateTriangles / F : 0,
    volume: Math.abs(volume),
    surfaceArea,
    capSelfIntersections,
    selfIntersectionChecked: canCheck,
  };
}

/**
 * 새로 만든 뚜껑 삼각형이 기존 표면을 관통했는지 센다.
 *
 * 메시 전체의 자기교차를 찾으려면 훨씬 무거운 자료구조가 필요하지만, 실제로
 * 문제가 되는 것은 우리가 방금 만들어 넣은 면이다. 균일 격자에 삼각형을 넣고
 * 같은 칸에 든 후보끼리만 분리축 검사를 하면 뚜껑 개수에 비례하는 비용으로 끝난다.
 */
function countCapIntersections(mesh: MeshData, capStart: number, diagonal: number): number {
  const { positions, indices } = mesh;
  const F = indices.length / 3;
  if (capStart >= F || diagonal <= 0) return 0;

  const cell = diagonal / 64;
  const buckets = new Map<number, number[]>();

  const hash = (ix: number, iy: number, iz: number) =>
    (Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791)) | 0;

  const triBounds = (f: number) => {
    const o = f * 3;
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (let k = 0; k < 3; k++) {
      const p = indices[o + k] * 3;
      const x = positions[p];
      const y = positions[p + 1];
      const z = positions[p + 2];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }
    return { minX, minY, minZ, maxX, maxY, maxZ };
  };

  for (let f = 0; f < F; f++) {
    const b = triBounds(f);
    const x0 = Math.floor(b.minX / cell);
    const x1 = Math.floor(b.maxX / cell);
    const y0 = Math.floor(b.minY / cell);
    const y1 = Math.floor(b.maxY / cell);
    const z0 = Math.floor(b.minZ / cell);
    const z1 = Math.floor(b.maxZ / cell);

    // 지나치게 큰 삼각형이 격자를 뒤덮는 것을 막는다.
    if ((x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > 512) continue;

    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        for (let iz = z0; iz <= z1; iz++) {
          const key = hash(ix, iy, iz);
          const bucket = buckets.get(key);
          if (bucket) bucket.push(f);
          else buckets.set(key, [f]);
        }
      }
    }
  }

  const eps = diagonal * 1e-9;
  const seen = new Set<number>();
  let count = 0;

  for (let f = capStart; f < F; f++) {
    const b = triBounds(f);
    const x0 = Math.floor(b.minX / cell);
    const x1 = Math.floor(b.maxX / cell);
    const y0 = Math.floor(b.minY / cell);
    const y1 = Math.floor(b.maxY / cell);
    const z0 = Math.floor(b.minZ / cell);
    const z1 = Math.floor(b.maxZ / cell);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > 512) continue;

    const candidates = new Set<number>();
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        for (let iz = z0; iz <= z1; iz++) {
          const bucket = buckets.get(hash(ix, iy, iz));
          if (!bucket) continue;
          for (const g of bucket) if (g !== f) candidates.add(g);
        }
      }
    }

    for (const g of candidates) {
      const pairKey = f < g ? f * F + g : g * F + f;
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);
      if (sharesVertex(indices, f, g)) continue;
      if (trianglesIntersect(positions, indices, f, g, eps)) count++;
    }
  }

  return count;
}

function sharesVertex(indices: Uint32Array, f: number, g: number): boolean {
  const fo = f * 3;
  const go = g * 3;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      if (indices[fo + i] === indices[go + j]) return true;
    }
  }
  return false;
}

/** 분리축 정리로 두 삼각형이 겹치는지 판정한다. 면 법선 2개와 에지 외적 9개를 본다. */
function trianglesIntersect(
  positions: Float32Array,
  indices: Uint32Array,
  f: number,
  g: number,
  eps: number,
): boolean {
  const A: number[][] = [];
  const B: number[][] = [];
  for (let i = 0; i < 3; i++) {
    const pa = indices[f * 3 + i] * 3;
    A.push([positions[pa], positions[pa + 1], positions[pa + 2]]);
    const pb = indices[g * 3 + i] * 3;
    B.push([positions[pb], positions[pb + 1], positions[pb + 2]]);
  }

  const edgesA = [
    [A[1][0] - A[0][0], A[1][1] - A[0][1], A[1][2] - A[0][2]],
    [A[2][0] - A[1][0], A[2][1] - A[1][1], A[2][2] - A[1][2]],
    [A[0][0] - A[2][0], A[0][1] - A[2][1], A[0][2] - A[2][2]],
  ];
  const edgesB = [
    [B[1][0] - B[0][0], B[1][1] - B[0][1], B[1][2] - B[0][2]],
    [B[2][0] - B[1][0], B[2][1] - B[1][1], B[2][2] - B[1][2]],
    [B[0][0] - B[2][0], B[0][1] - B[2][1], B[0][2] - B[2][2]],
  ];

  const axes: number[][] = [
    crossOf(edgesA[0], edgesA[1]),
    crossOf(edgesB[0], edgesB[1]),
  ];
  for (const ea of edgesA) {
    for (const eb of edgesB) axes.push(crossOf(ea, eb));
  }

  for (const axis of axes) {
    const len = Math.hypot(axis[0], axis[1], axis[2]);
    if (len < 1e-20) continue; // 평행한 에지에서 나오는 퇴화 축은 건너뛴다

    const ax = axis[0] / len;
    const ay = axis[1] / len;
    const az = axis[2] / len;

    let minA = Infinity;
    let maxA = -Infinity;
    let minB = Infinity;
    let maxB = -Infinity;

    for (let i = 0; i < 3; i++) {
      const pa = A[i][0] * ax + A[i][1] * ay + A[i][2] * az;
      if (pa < minA) minA = pa;
      if (pa > maxA) maxA = pa;
      const pb = B[i][0] * ax + B[i][1] * ay + B[i][2] * az;
      if (pb < minB) minB = pb;
      if (pb > maxB) maxB = pb;
    }

    // 살짝 스치는 정도는 교차로 세지 않는다.
    if (maxA < minB + eps || maxB < minA + eps) return false;
  }

  return true;
}

function crossOf(a: number[], b: number[]): number[] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
