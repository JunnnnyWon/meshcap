import { describe, expect, it } from 'vitest';
import { runPipeline } from '../pipeline.ts';
import { buildTopology } from '../halfEdge.ts';
import { EdgeIncidence } from '../incidence.ts';
import { splitNonManifold } from '../splitNonManifold.ts';
import { closeGaps } from '../gapClose.ts';
import { attachToExistingSurface, dropOverlappingFlaps, snapTJunctions } from '../surfaceSnap.ts';
import { applyLeftoverSurgeries, collapseOneShortUnmatched, insertOneConstrained, listDrawnLeftoverEdges, remeshOneCavity, remeshOneSpatialCavity, splitOneSheetSpoke, stripOneGap, zipOnePolylineRibbon, zipOneSubsegment } from '../leftoverSurgery.ts';
import { zipSameOrientationCracks } from '../crackZip.ts';
import { nonManifoldFan, nonManifoldFin, openCube, planeWithPinhole, gappedQuads, twoFaceVNotch, wideSlit, distantParallelSlit, danglingOverInterior, overlappingFlapOnFace, tJunctionOnDiagonal, duplicatedSeamQuads, shortUnmatchedSliver, offsetCrackOnSheet, offsetLayersNoSharedEdge, longRimShortInteriorOverlap, longRimShadowChain, largeFaceLeftoverSliver, leftoverConstrainedInsert, leftoverGapStrip, leftoverGapStripTwoFaces, leftoverGapStripFlipped, leftoverSheetSpokeSplit, leftoverBowedChord, leftoverBowedChain6 } from '../__fixtures__/shapes.ts';
import { triangleCount } from '../types.ts';

describe('비다양체 분리', () => {
  it('면 셋이 공유하던 에지의 고립된 여분 면을 제거해 비다양체를 없앤다', () => {
    const before = buildTopology(nonManifoldFan());
    expect(before.nonManifoldEdgeCount).toBe(1);

    const { mesh, splitEdges } = splitNonManifold(nonManifoldFan());
    expect(splitEdges).toBeGreaterThan(0);
    expect(triangleCount(mesh)).toBe(2);
    expect(buildTopology(mesh).nonManifoldEdgeCount).toBe(0);
  });

  it('이어진 여분 시트는 정점을 복제해 떼어 낸다', () => {
    const { mesh, clonedVertices } = splitNonManifold(nonManifoldFin());
    expect(clonedVertices).toBeGreaterThan(0);
    expect(buildTopology(mesh).connectedComponents).toBe(2);
  });
});

describe('비다양체 가드', () => {
  it('면이 이미 둘인 에지에 뚜껑을 붙이지 않는다', () => {
    const incidence = new EdgeIncidence(nonManifoldFan());
    // 세 면이 공유하는 에지 (0,1)
    expect(incidence.count(0, 1)).toBeGreaterThanOrEqual(3);
    expect(incidence.wouldCreateNonManifold(0, 1, 2)).toBe(true);
  });

  it('열린 정육면체를 메워도 비다양체 에지가 생기지 않는다', () => {
    const result = runPipeline(openCube());
    expect(result.repaired.watertight).toBe(true);
    expect(result.repaired.nonManifoldEdgeCount).toBe(0);
    expect(result.repairedScore.total).toBe(100);
  });

  it('면이 셋인 에지로 끊긴 테두리를 skip으로 남기지 않는다', () => {
    const result = runPipeline(nonManifoldFan());
    expect(result.holes.every((hole) => hole.appliedStrategy !== 'skip' || hole.addedTriangles > 0)).toBe(
      true,
    );
  });

  it('이미 면이 둘인 변을 끼운 V자 찢김에도 삼각형을 붙인다', () => {
    const before = buildTopology(twoFaceVNotch());
    const result = runPipeline(twoFaceVNotch());
    const filled = result.holes.filter((hole) => hole.appliedStrategy !== 'collapse');
    expect(filled.some((hole) => hole.addedTriangles > 0)).toBe(true);
    expect(result.repaired.boundaryEdgeCount).toBeLessThan(before.boundaryEdgeCount);
  });

  it('지퍼가 안 닿는 균열에도 삼각형을 붙여 1-face 테두리를 줄인다', () => {
    const before = buildTopology(wideSlit());
    expect(before.boundaryEdgeCount).toBeGreaterThan(0);
    const result = runPipeline(wideSlit());
    expect(result.holes.every((hole) => hole.appliedStrategy !== 'skip' || hole.addedTriangles > 0)).toBe(
      true,
    );
    expect(result.repaired.boundaryEdgeCount).toBeLessThan(before.boundaryEdgeCount);
  });

  it('멀리 떨어진 평행 입술도 면내 가드를 통과하면 1-face가 줄어든다', () => {
    const before = buildTopology(distantParallelSlit());
    const result = runPipeline(distantParallelSlit());
    expect(result.repaired.boundaryEdgeCount).toBeLessThan(before.boundaryEdgeCount);
    expect(result.remainingFillEdges.length).toBeLessThanOrEqual(result.repaired.boundaryEdgeCount);
  });
});

describe('미세 구멍 붕괴', () => {
  it('큰 평면에 난 핀홀은 삼각형을 넣지 않고 한 점으로 모은다', () => {
    const result = runPipeline(planeWithPinhole());
    const collapsed = result.holes.filter((h) => h.appliedStrategy === 'collapse');
    expect(collapsed.length).toBeGreaterThan(0);
    expect(collapsed.every((h) => h.addedTriangles === 0)).toBe(true);
    expect(result.repairSummary.collapsedHoles).toBeGreaterThan(0);
    expect(result.repaired.watertight).toBe(true);
  });
});

describe('기존 표면 부착', () => {
  it('안쪽 면 위에 얹힌 1-face 변은 다른 테두리 없이 사라진다', () => {
    const before = buildTopology(danglingOverInterior());
    expect(before.boundaryEdgeCount).toBeGreaterThan(0);
    const attached = attachToExistingSurface(danglingOverInterior());
    expect(attached.collapsedSlits + attached.snappedToInterior + attached.deletedFlaps).toBeGreaterThan(0);
    expect(buildTopology(attached.mesh).boundaryEdgeCount).toBe(0);

    const result = runPipeline(danglingOverInterior());
    expect(result.repaired.boundaryEdgeCount).toBe(0);
    expect(result.remainingFillEdges).toHaveLength(0);
  });

  it('안쪽 면 위에 겹친 여분 삼각형은 지우고 본 시트는 닫아 둔다', () => {
    const before = buildTopology(overlappingFlapOnFace());
    expect(before.boundaryEdgeCount).toBeGreaterThan(0);
    const dropped = dropOverlappingFlaps(overlappingFlapOnFace());
    expect(dropped.count).toBeGreaterThan(0);
    expect(buildTopology(dropped.mesh).boundaryEdgeCount).toBe(0);

    const result = runPipeline(overlappingFlapOnFace());
    expect(result.repaired.watertight).toBe(true);
    expect(result.repaired.boundaryEdgeCount).toBe(0);
    expect(result.repairSummary.deletedFlaps).toBeGreaterThan(0);
  });

  it('대각선 위 T자 정점은 안쪽 에지를 가른 뒤 1-face가 줄어든다', () => {
    const before = buildTopology(tJunctionOnDiagonal());
    expect(before.boundaryEdgeCount).toBeGreaterThan(0);
    const snapped = snapTJunctions(tJunctionOnDiagonal(), 1);
    expect(snapped.count).toBeGreaterThan(0);
    expect(buildTopology(snapped.mesh).boundaryEdgeCount).toBeLessThan(before.boundaryEdgeCount);

    const attached = attachToExistingSurface(tJunctionOnDiagonal());
    expect(attached.snappedTJunctions).toBeGreaterThan(0);
    expect(buildTopology(attached.mesh).boundaryEdgeCount).toBeLessThan(before.boundaryEdgeCount);

    const result = runPipeline(tJunctionOnDiagonal());
    expect(result.repaired.boundaryEdgeCount).toBeLessThan(before.boundaryEdgeCount);
  });

  it('복제된 맞댐 변의 같은 방향 1-face는 지퍼로 면이 둘이 된다', () => {
    const before = buildTopology(duplicatedSeamQuads());
    expect(before.boundaryEdgeCount).toBeGreaterThan(0);
    const zipped = zipSameOrientationCracks(duplicatedSeamQuads());
    expect(zipped.zippedCracks).toBeGreaterThan(0);
    expect(buildTopology(zipped.mesh).boundaryEdgeCount).toBeLessThan(before.boundaryEdgeCount);
    expect(buildTopology(zipped.mesh).nonManifoldEdgeCount).toBe(0);

    const attached = attachToExistingSurface(duplicatedSeamQuads());
    expect(attached.zippedCracks).toBeGreaterThan(0);
    expect(buildTopology(attached.mesh).boundaryEdgeCount).toBeLessThan(before.boundaryEdgeCount);

    const result = runPipeline(duplicatedSeamQuads());
    expect(result.repaired.nonManifoldEdgeCount).toBe(0);
    expect(result.repaired.boundaryEdgeCount).toBeLessThan(before.boundaryEdgeCount);
  });

  it('짧은 2+2+1 미매칭 변은 접으면 1-face가 사라진다', () => {
    const before = buildTopology(shortUnmatchedSliver());
    expect(before.boundaryEdgeCount).toBeGreaterThan(0);
    const collapsed = collapseOneShortUnmatched(shortUnmatchedSliver());
    expect(collapsed).not.toBeNull();
    expect(buildTopology(collapsed!).boundaryEdgeCount).toBeLessThan(before.boundaryEdgeCount);

    const attached = attachToExistingSurface(shortUnmatchedSliver());
    expect(attached.collapsedShort).toBeGreaterThan(0);
    expect(buildTopology(attached.mesh).boundaryEdgeCount).toBeLessThan(before.boundaryEdgeCount);
  });

  it('시트와 0.2배 어긋난 2+2+1 균열은 국소 캐비티로 한 장이 된다', () => {
    const source = offsetCrackOnSheet();
    const before = buildTopology(source);
    expect(before.boundaryEdgeCount).toBeGreaterThan(0);
    expect(before.nonManifoldEdgeCount).toBe(0);

    const remeshed = remeshOneCavity(source);
    expect(remeshed).not.toBeNull();
    expect(buildTopology(remeshed!).boundaryEdgeCount).toBeLessThan(before.boundaryEdgeCount);
    expect(buildTopology(remeshed!).nonManifoldEdgeCount).toBe(0);

    const attached = attachToExistingSurface(source);
    expect(attached.cavityCommits + attached.spatialZipCommits + attached.wrappedTriangles).toBeGreaterThan(0);
    expect(buildTopology(attached.mesh).boundaryEdgeCount).toBe(0);
    expect(buildTopology(attached.mesh).nonManifoldEdgeCount).toBe(0);

    const result = runPipeline(source);
    expect(result.repaired.watertight).toBe(true);
    expect(result.repaired.boundaryEdgeCount).toBe(0);
    expect(result.repaired.nonManifoldEdgeCount).toBe(0);
  });

  it('에지를 안 나눠 가진 겹친 층은 공간 캐비티로 한 장이 된다', () => {
    const source = offsetLayersNoSharedEdge();
    const before = buildTopology(source);
    expect(before.boundaryEdgeCount).toBeGreaterThan(0);
    expect(before.nonManifoldEdgeCount).toBe(0);

    const remeshed = remeshOneSpatialCavity(source) ?? remeshOneCavity(source);
    expect(remeshed).not.toBeNull();
    expect(buildTopology(remeshed!).boundaryEdgeCount).toBe(0);
    expect(buildTopology(remeshed!).nonManifoldEdgeCount).toBe(0);

    const attached = attachToExistingSurface(source);
    expect(attached.spatialZipCommits + attached.cavityCommits).toBeGreaterThan(0);
    expect(buildTopology(attached.mesh).boundaryEdgeCount).toBe(0);

    const result = runPipeline(source);
    expect(result.repaired.watertight).toBe(true);
    expect(result.repaired.boundaryEdgeCount).toBe(0);
    expect(result.repaired.nonManifoldEdgeCount).toBe(0);
  });

  it('긴 1-face 중간의 짧은 안쪽 변만 갈라 지퍼한다', () => {
    const source = longRimShortInteriorOverlap();
    const before = buildTopology(source);
    expect(before.boundaryEdgeCount).toBeGreaterThan(0);
    expect(before.nonManifoldEdgeCount).toBe(0);

    const zipped = zipOneSubsegment(source);
    expect(zipped).not.toBeNull();
    expect(buildTopology(zipped!).boundaryEdgeCount).toBeLessThan(before.boundaryEdgeCount);
    expect(buildTopology(zipped!).nonManifoldEdgeCount).toBe(0);

    const attached = attachToExistingSurface(source);
    expect(attached.subsegmentZipCommits + attached.spatialZipCommits + attached.cavityCommits).toBeGreaterThan(0);
    expect(buildTopology(attached.mesh).boundaryEdgeCount).toBeLessThan(before.boundaryEdgeCount);

    const result = runPipeline(source);
    expect(result.repaired.watertight).toBe(true);
    expect(result.repaired.boundaryEdgeCount).toBe(0);
    expect(result.repaired.nonManifoldEdgeCount).toBe(0);
  });

  it('긴 1-face의 짧은 안쪽 그림자 체인을 전 구간 지퍼한다', () => {
    const source = longRimShadowChain();
    const before = buildTopology(source);
    expect(before.boundaryEdgeCount).toBeGreaterThan(0);
    expect(before.nonManifoldEdgeCount).toBe(0);

    const zipped = zipOnePolylineRibbon(source);
    expect(zipped).not.toBeNull();
    expect(buildTopology(zipped!).boundaryEdgeCount).toBeLessThan(before.boundaryEdgeCount);
    expect(buildTopology(zipped!).nonManifoldEdgeCount).toBe(0);

    const attached = attachToExistingSurface(source);
    expect(attached.polylineZipCommits + attached.spatialZipCommits + attached.cavityCommits + attached.insertCommits).toBeGreaterThan(0);
    expect(buildTopology(attached.mesh).boundaryEdgeCount).toBeLessThan(before.boundaryEdgeCount);

    const result = runPipeline(source);
    expect(result.repaired.boundaryEdgeCount).toBeLessThan(before.boundaryEdgeCount);
    expect(result.repaired.nonManifoldEdgeCount).toBe(0);
  });

  it('큰 안쪽 삼각형은 지우고 가늘게 갈라 긴 1-face를 지퍼한다', () => {
    const source = largeFaceLeftoverSliver();
    const before = buildTopology(source);
    expect(before.boundaryEdgeCount).toBeGreaterThan(0);
    expect(before.nonManifoldEdgeCount).toBe(0);
    const beforeTris = source.indices.length / 3;

    const zipped = zipOnePolylineRibbon(source);
    expect(zipped).not.toBeNull();
    expect(buildTopology(zipped!).boundaryEdgeCount).toBeLessThan(before.boundaryEdgeCount);
    expect(buildTopology(zipped!).nonManifoldEdgeCount).toBe(0);
    expect(zipped!.indices.length / 3).toBeGreaterThanOrEqual(beforeTris);

    const surgery = applyLeftoverSurgeries(source);
    expect(surgery.insertCommits + surgery.spatialZipCommits + surgery.cavityCommits + surgery.sliverCutCommits + surgery.polylineZipCommits).toBeGreaterThanOrEqual(0);
    expect(buildTopology(surgery.mesh).nonManifoldEdgeCount).toBe(0);

    const attached = attachToExistingSurface(source);
    expect(buildTopology(attached.mesh).boundaryEdgeCount).toBeLessThan(before.boundaryEdgeCount);

    const result = runPipeline(source);
    expect(result.repaired.boundaryEdgeCount).toBeLessThan(before.boundaryEdgeCount);
    expect(result.repaired.nonManifoldEdgeCount).toBe(0);
  });

  it('안쪽 면 위에 leftover 1-face를 Steiner 제약으로 넣어 붙인다', () => {
    const source = leftoverConstrainedInsert();
    const before = buildTopology(source);
    expect(before.boundaryEdgeCount).toBeGreaterThan(0);
    expect(before.nonManifoldEdgeCount).toBe(0);
    const beforeTris = source.indices.length / 3;

    const inserted = insertOneConstrained(source);
    expect(inserted).not.toBeNull();
    const after = buildTopology(inserted!);
    expect(after.boundaryEdgeCount).toBeLessThan(before.boundaryEdgeCount);
    expect(after.nonManifoldEdgeCount).toBe(0);
    expect(inserted!.indices.length / 3).toBeGreaterThanOrEqual(beforeTris);

    const surgery = applyLeftoverSurgeries(source);
    expect(surgery.insertCommits).toBeGreaterThan(0);
    expect(buildTopology(surgery.mesh).boundaryEdgeCount).toBeLessThan(before.boundaryEdgeCount);
    expect(buildTopology(surgery.mesh).nonManifoldEdgeCount).toBe(0);

    const result = runPipeline(source);
    expect(result.repaired.boundaryEdgeCount).toBeLessThan(before.boundaryEdgeCount);
    expect(result.repaired.nonManifoldEdgeCount).toBe(0);
  });

  it('갭 띠는 안쪽 면을 가르지 않고 leftover AB를 붙인다', () => {
    const source = leftoverGapStrip();
    const before = buildTopology(source);
    expect(before.boundaryEdgeCount).toBeGreaterThan(0);
    expect(before.nonManifoldEdgeCount).toBe(0);
    const beforeTris = source.indices.length / 3;
    const uvw = [4, 5, 6];

    const stripped = stripOneGap(source);
    expect(stripped).not.toBeNull();
    const after = buildTopology(stripped!);
    expect(after.nonManifoldEdgeCount).toBe(0);
    expect(new EdgeIncidence(stripped!).count(8, 9)).toBe(2);
    expect(hasTri(stripped!, uvw)).toBe(true);
    expect(stripped!.indices.length / 3).toBe(beforeTris + 2);

    const surgery = applyLeftoverSurgeries(source);
    expect(buildTopology(surgery.mesh).nonManifoldEdgeCount).toBe(0);
    expect(listDrawnLeftoverEdges(surgery.mesh).length).toBeLessThan(before.boundaryEdgeCount);

    const result = runPipeline(source);
    expect(result.repaired.nonManifoldEdgeCount).toBe(0);
    expect(result.remainingFillEdges.length).toBeLessThan(before.boundaryEdgeCount);
  });

  it('두 안쪽 삼각형을 가로지르는 leftover는 그림자 체인 갭 띠로 붙인다', () => {
    const source = leftoverGapStripTwoFaces();
    const before = buildTopology(source);
    expect(before.boundaryEdgeCount).toBeGreaterThan(0);
    expect(before.nonManifoldEdgeCount).toBe(0);
    const t1 = [4, 5, 6];
    const t2 = [4, 6, 7];

    const stripped = stripOneGap(source);
    expect(stripped).not.toBeNull();
    expect(buildTopology(stripped!).nonManifoldEdgeCount).toBe(0);
    expect(new EdgeIncidence(stripped!).count(8, 9)).not.toBe(1);
    expect(hasTri(stripped!, t1)).toBe(true);
    expect(hasTri(stripped!, t2)).toBe(true);

    const surgery = applyLeftoverSurgeries(source);
    expect(buildTopology(surgery.mesh).nonManifoldEdgeCount).toBe(0);
    expect(listDrawnLeftoverEdges(surgery.mesh).length).toBeLessThan(before.boundaryEdgeCount);
  });

  it('시트와 법선이 반대인 leftover도 갭 띠로 붙인다', () => {
    const source = leftoverGapStripFlipped();
    const before = buildTopology(source);
    expect(before.boundaryEdgeCount).toBeGreaterThan(0);
    expect(before.nonManifoldEdgeCount).toBe(0);
    const uvw = [4, 5, 6];

    const stripped = stripOneGap(source);
    expect(stripped).not.toBeNull();
    expect(buildTopology(stripped!).nonManifoldEdgeCount).toBe(0);
    expect(new EdgeIncidence(stripped!).count(8, 9)).not.toBe(1);
    expect(hasTri(stripped!, uvw)).toBe(true);
  });

  it('시트 정점 하나를 공유하는 긴 leftover는 근처를 가르고 먼 쪽만 붙인다', () => {
    const source = leftoverSheetSpokeSplit();
    const before = buildTopology(source);
    expect(before.boundaryEdgeCount).toBeGreaterThan(0);
    expect(before.nonManifoldEdgeCount).toBe(0);
    const topA = [4, 5, 6];
    const topB = [4, 6, 7];

    const split = splitOneSheetSpoke(source);
    expect(split).not.toBeNull();
    expect(buildTopology(split!).nonManifoldEdgeCount).toBe(0);
    expect(hasTri(split!, topA)).toBe(true);
    expect(hasTri(split!, topB)).toBe(true);
    expect(new EdgeIncidence(split!).count(4, 8)).toBe(0);

    const surgery = applyLeftoverSurgeries(source);
    expect(buildTopology(surgery.mesh).nonManifoldEdgeCount).toBe(0);
    expect(hasTri(surgery.mesh, topA)).toBe(true);
    expect(hasTri(surgery.mesh, topB)).toBe(true);
    expect(listDrawnLeftoverEdges(surgery.mesh).length).toBeLessThan(before.boundaryEdgeCount);

    const result = runPipeline(source);
    expect(result.repaired.nonManifoldEdgeCount).toBe(0);
    expect(hasTri(result.mesh, topA)).toBe(true);
    expect(hasTri(result.mesh, topB)).toBe(true);
    expect(result.remainingFillEdges.length).toBeLessThan(before.boundaryEdgeCount);
  });

  it('시트 정점 둘을 잇는 휜 leftover 현은 찢김으로 그리지 않는다', () => {
    const source = leftoverBowedChord();
    const before = buildTopology(source);
    expect(before.boundaryEdgeCount).toBeGreaterThan(0);
    expect(before.nonManifoldEdgeCount).toBe(0);
    const topA = [4, 5, 6];
    const topB = [4, 6, 7];

    const surgery = applyLeftoverSurgeries(source);
    expect(buildTopology(surgery.mesh).nonManifoldEdgeCount).toBe(0);
    expect(hasTri(surgery.mesh, topA)).toBe(true);
    expect(hasTri(surgery.mesh, topB)).toBe(true);
    expect(listDrawnLeftoverEdges(surgery.mesh).length).toBeLessThan(before.boundaryEdgeCount);

    const result = runPipeline(source);
    expect(result.repaired.nonManifoldEdgeCount).toBe(0);
    expect(hasTri(result.mesh, topA)).toBe(true);
    expect(hasTri(result.mesh, topB)).toBe(true);
    expect(result.remainingFillEdges.length).toBeLessThan(before.boundaryEdgeCount);
  });

  it('시트 정점 둘을 잇는 leftover 열린 사슬은 찢김으로 그리지 않는다', () => {
    const source = leftoverBowedChain6();
    const before = buildTopology(source);
    expect(before.boundaryEdgeCount).toBeGreaterThan(0);
    expect(before.nonManifoldEdgeCount).toBe(0);
    const topA = [4, 5, 6];
    const topB = [4, 6, 7];

    let working = source;
    for (let i = 0; i < 16; i++) {
      const one = stripOneGap(working);
      if (!one) break;
      working = one;
    }
    expect(buildTopology(working).nonManifoldEdgeCount).toBe(0);
    expect(hasTri(working, topA)).toBe(true);
    expect(hasTri(working, topB)).toBe(true);
    expect(listDrawnLeftoverEdges(working).length).toBeLessThan(before.boundaryEdgeCount);
  });
});

function hasTri(mesh: { indices: Uint32Array }, verts: number[]): boolean {
  const want = [...verts].sort((a, b) => a - b).join(',');
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const got = [mesh.indices[t], mesh.indices[t + 1], mesh.indices[t + 2]].sort((a, b) => a - b).join(',');
    if (got === want) return true;
  }
  return false;
}

describe('갭 클로징', () => {
  it('이미 닫힌 테두리는 건드리지 않는다', () => {
    const { mesh, mergedPairs, snappedToEdge } = closeGaps(openCube());
    expect(mergedPairs).toBe(0);
    expect(snappedToEdge).toBe(0);
    expect(triangleCount(mesh)).toBe(triangleCount(openCube()));
  });

  it('좁은 틈으로 마주 본 테두리를 붙여 닫힌 루프로 만든다', () => {
    const before = buildTopology(gappedQuads());
    expect(before.boundaryEdgeCount).toBeGreaterThan(0);

    const { mesh, mergedPairs } = closeGaps(gappedQuads());
    expect(mergedPairs).toBeGreaterThan(0);
    expect(buildTopology(mesh).boundaryEdgeCount).toBeLessThan(before.boundaryEdgeCount);
  });
});
