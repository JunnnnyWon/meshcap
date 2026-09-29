import { buildTopology } from './halfEdge.ts';
import { countBoundaryLoops } from './boundary.ts';
import { computeBounds, type MeshData } from './types.ts';
import { countSelfIntersections } from './intersect.ts';

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
  /** 메시 전체에서 서로 뚫고 지나가는 삼각형 쌍의 수. */
  selfIntersections: number;
  /** 관통 검사를 끝까지 했는지. false면 점수를 주지 않는다. */
  selfIntersectionChecked: boolean;
  /** 개수가 많아 세기를 멈췄는지. true면 selfIntersections 이상이다. */
  selfIntersectionCapped: boolean;
}

export interface ValidateOptions {
  /** 'all'은 메시 전체의 관통을 센다. 'none'은 점수에 쓰지 않는 진단용이다. */
  intersections?: 'all' | 'none';
  /** 관통을 이만큼 찾으면 세기를 멈춘다. */
  intersectionCap?: number;
  /**
   * 위상 계산에서 뺀 찌그러진 삼각형 수. 정확 용접에서 꼭짓점이 겹쳐 빠진 면처럼,
   * 입력에는 있었지만 메시에 넣을 수 없던 면을 점수에 되돌려 넣는다.
   */
  extraDegenerateTriangles?: number;
}

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

  const extra = options.extraDegenerateTriangles ?? 0;
  degenerateTriangles += extra;
  const totalTriangles = F + extra;

  let selfIntersections = 0;
  let selfIntersectionChecked = false;
  let selfIntersectionCapped = false;
  if ((options.intersections ?? 'all') === 'all') {
    const result = countSelfIntersections(mesh, { cap: options.intersectionCap });
    selfIntersections = result.count;
    // 한도에 걸려 끝까지 못 봤다면, 이미 0점이 될 만큼 찾았을 때만 검사한 것으로 친다.
    selfIntersectionChecked = result.complete || result.count >= 5;
    selfIntersectionCapped = result.capped || !result.complete;
  }

  return {
    vertexCount: topology.vertexCount,
    triangleCount: totalTriangles,
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
    degenerateRatio: totalTriangles > 0 ? degenerateTriangles / totalTriangles : 0,
    volume: Math.abs(volume),
    surfaceArea,
    selfIntersections,
    selfIntersectionChecked,
    selfIntersectionCapped,
  };
}
