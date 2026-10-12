/**
 * 결함이 모델 어디에 몰려 있는지 재고, 국소 수리로 감당할 만한지 판정한다.
 *
 *   npx tsx bench/regions.ts <파일...>
 *
 * 전체를 다시 뽑는 솔리드화 대신 결함 부위만 손보는 경로를 만들 수 있는지
 * 판단하는 도구다. 업로드 그대로(비트 동일 용접, 슬라이서가 보는 것)와
 * 허용오차 용접 후(파이프라인이 실제로 고치는 것)를 나란히 잰다.
 * 파이프라인 세 갈래를 다 돌리므로 큰 모델에서는 오래 걸린다. SKIP_PIPELINE=1로 뺄 수 있다.
 */
import { measureInput, runPipeline } from '../src/core/pipeline.ts';
import { localizationVerdict, summarizeDefects } from '../src/core/defectRegions.ts';
import { buildTopology } from '../src/core/halfEdge.ts';
import { weldVertices } from '../src/core/weld.ts';
import { readBinarySTL } from './readStl.ts';
import type { MeshData } from '../src/core/types.ts';

const percent = (value: number) => `${(value * 100).toFixed(2)}%`;
const count = (value: number) => value.toLocaleString('ko-KR');

function describe(label: string, mesh: MeshData): void {
  const topology = buildTopology(mesh);
  const all = summarizeDefects(mesh);
  const tangled = summarizeDefects(mesh, { includeOpenEdges: false });

  console.log(
    `  [${label}] 삼각형 ${count(all.triangleCount)} · 비다양체 ${count(all.nonManifoldEdges)} · ` +
      `열린 모서리 ${count(all.openEdges)} · 연결 요소 ${count(topology.connectedComponents)} · ` +
      `밀폐 ${topology.boundaryEdgeCount === 0 ? 'O' : 'X'} · 관통 ${count(all.intersectingPairs)}쌍` +
      `${all.pairsComplete ? '' : ' 이상'}`,
  );
  console.log(
    `    관통 연루 면 ${count(all.intersectingTriangles)} (${percent(all.intersectingTriangles / (all.triangleCount || 1))}) · 표면적 ${all.surfaceArea.toFixed(3)}`,
  );

  for (const [kind, summary] of [
    ['구멍 포함', all],
    ['겹침·관통만', tangled],
  ] as const) {
    const verdict = localizationVerdict(summary);
    const big = summary.regions.filter((r) => r.triangleCount > 200).length;
    console.log(
      `    ${kind} 덩어리 ${count(summary.regions.length)}곳 (200면 초과 ${big}곳) · ` +
        `면적 ${percent(summary.areaRatio)} · 최대 대각 ${percent(summary.maxRegionDiagonalRatio)} · ` +
        `판정 ${verdict.localized ? '국소적' : '국소 아님'}`,
    );
    for (const reason of verdict.reasons) console.log(`      · ${reason}`);
    for (const region of summary.regions.slice(0, 4)) {
      console.log(
        `      #${region.id + 1} 면 ${count(region.triangleCount)} · 면적 ${percent(region.area / (summary.surfaceArea || 1))} · ` +
          `대각 ${percent(region.diagonal / (summary.modelDiagonal || 1))} · ` +
          `겹침 ${region.causes.nonManifold} · 관통 ${region.causes.intersecting} · 열림 ${region.causes.open}`,
      );
    }
    if (summary.regions.length > 4) console.log(`      … 그 외 ${count(summary.regions.length - 4)}곳`);
  }
}

function report(label: string, mesh: MeshData, upAxis: 'y' | 'z'): void {
  const before = measureInput(mesh);
  const weld = weldVertices(mesh);

  console.log(`\n=== ${label} ===`);
  console.log(`  업로드 그대로 점수 ${before.score.total}`);
  describe('업로드 그대로 · 비트 동일 용접', before.asIs.mesh);
  console.log(
    `  [허용오차 용접 후] 점 ${count(weld.mesh.positions.length / 3)} (병합 ${count(weld.mergedVertices)} · ` +
      `중복 면 ${count(weld.removedDuplicateTriangles)} · 퇴화 ${count(weld.removedDegenerateTriangles)})`,
  );
  describe('허용오차 용접 후', weld.mesh);

  if (process.env.SKIP_PIPELINE === '1') return;

  for (const engine of ['auto', 'patch', 'solid'] as const) {
    const started = Date.now();
    const result = runPipeline(mesh, { upAxis, engine });
    const fidelity = result.fidelity ? ` · 원래 모양 유지 ${percent(result.fidelity.inputCoverage)}` : '';
    const left = result.engine === 'solid' ? '' : ` · 남은 관통 ${count(result.repaired.selfIntersections)}쌍`;
    console.log(
      `  ${(engine === 'auto' ? '자동' : engine === 'patch' ? '구멍' : '솔리드').padEnd(4)} ${result.engine} · ` +
        `${result.inputScore.total} → ${result.repairedScore.total}점 · 밀폐 ${result.repaired.watertight ? 'O' : 'X'} · ` +
        `연결 요소 ${result.repaired.connectedComponents} · ${((Date.now() - started) / 1000).toFixed(1)}초${fidelity}${left}`,
    );
    if (engine === 'auto') console.log(`    ${result.engineReason}`);
    if (result.solid) {
      const stats = result.solid;
      console.log(
        `    격자 ${stats.grid.join('×')} (해상도 ${stats.resolution}) · 두께 입힌 면 ${count(stats.thickenedTriangles)} · ` +
          `채운 속 ${count(stats.filledVoidPoints)}점 · 버린 조각 ${stats.removedShells} · ` +
          `새로 채운 면 ${count(stats.newTriangles)} / ${count(stats.outputTriangles)}`,
      );
    }
  }
}

const paths = process.argv.slice(2);
if (paths.length === 0) {
  console.error('파일 경로가 필요합니다.  npx tsx bench/regions.ts <파일.stl>');
  process.exit(1);
}

for (const path of paths) {
  report(path.split('/').pop() ?? path, readBinarySTL(path), 'z');
}
