/**
 * 큰 STL 파일에서 파이프라인이 어디서 얼마나 메모리를 쓰는지 재현한다.
 *
 *   npx tsx bench/probe.ts <파일...>
 */
import { weldVertices } from '../src/core/weld.ts';
import { buildTopology } from '../src/core/halfEdge.ts';
import { traceBoundaryLoops } from '../src/core/boundary.ts';
import { runPipeline } from '../src/core/pipeline.ts';
import type { MeshData } from '../src/core/types.ts';
import { readBinarySTL } from './readStl.ts';

const mb = () => Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
const step = (label: string, fn: () => unknown) => {
  const t0 = Date.now();
  const before = mb();
  const result = fn();
  console.log(
    `  ${label.padEnd(22)} ${String(Date.now() - t0).padStart(7)}ms   힙 ${before} → ${mb()} MB`,
  );
  return result;
};

for (const path of process.argv.slice(2)) {
  console.log(`\n=== ${path} ===`);
  const mesh = step('STL 읽기', () => readBinarySTL(path)) as MeshData;
  console.log(
    `  삼각형 ${(mesh.indices.length / 3).toLocaleString()} · 정점 ${(mesh.positions.length / 3).toLocaleString()}`,
  );

  // 단계별 측정은 중간 결과를 계속 붙잡고 있어 최대 메모리가 부풀려진다.
  // 실제 사용 환경의 수치를 보려면 파이프라인만 단독으로 돌려야 한다.
  if (process.env.PIPELINE_ONLY === '1') {
    const result = step('파이프라인 단독', () => runPipeline(mesh, { upAxis: 'z' })) as ReturnType<
      typeof runPipeline
    >;
    console.log(
      `  점수 ${result.weldedScore.total} → ${result.repairedScore.total} · 밀폐 ${result.repaired.watertight} · 반복 ${result.capPasses}회`,
    );
    console.log(`  최대 RSS ${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB`);
    continue;
  }

  try {
    const welded = step('용접', () => weldVertices(mesh)) as ReturnType<typeof weldVertices>;
    console.log(
      `  용접 후 정점 ${(welded.mesh.positions.length / 3).toLocaleString()} (${welded.mergedVertices.toLocaleString()}개 병합)`,
    );

    const topology = step('위상 분석', () => buildTopology(welded.mesh)) as ReturnType<typeof buildTopology>;
    console.log(`  에지 ${topology.edgeCount.toLocaleString()} · 경계 ${topology.boundaryEdgeCount.toLocaleString()}`);

    const loops = step('테두리 추적', () => traceBoundaryLoops(topology)) as ReturnType<typeof traceBoundaryLoops>;
    console.log(`  구멍 ${loops.length}개`);

    const result = step('전체 파이프라인', () => runPipeline(mesh, { upAxis: 'z' })) as ReturnType<
      typeof runPipeline
    >;
    const t = result.timings;
    console.log(
      `    용접 ${t.weld.toFixed(0)} · 분석 ${t.analyze.toFixed(0)} · 메우기 ${t.cap.toFixed(0)} · 정렬 ${t.orient.toFixed(0)} · 검증 ${t.validate.toFixed(0)} ms`,
    );
    console.log(
      `  점수 ${result.weldedScore.total} → ${result.repairedScore.total} · 구멍 ${result.holes.length}개 · 밀폐 ${result.repaired.watertight}`,
    );
    for (const [label, r] of [
      ['용접 후', result.welded],
      ['보정 후', result.repaired],
    ] as const) {
      console.log(
        `    ${label} 경계 ${r.boundaryEdgeCount} · 테두리 ${r.boundaryLoopCount} · 비다양체 에지 ${r.nonManifoldEdgeCount} · ` +
          `방향불일치 ${r.inconsistentEdgeCount} · 연결요소 ${r.connectedComponents} · 퇴화 ${r.degenerateTriangles}`,
      );
    }
    for (const item of result.repairedScore.items) {
      console.log(`    ${item.label.padEnd(10)} ${item.earned}/${item.max}  ${item.detail}`);
    }
    console.log(`  최대 RSS ${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB`);

    const byStrategy = new Map<string, number>();
    for (const hole of result.holes) {
      byStrategy.set(hole.appliedStrategy, (byStrategy.get(hole.appliedStrategy) ?? 0) + 1);
    }
    console.log(`  전략 분포 ${JSON.stringify(Object.fromEntries(byStrategy))}`);
    console.log(`  닫힌 테두리 ${result.holes.filter((h) => h.closed).length} / ${result.holes.length}`);
    for (const hole of result.holes.slice(0, 5)) {
      console.log(
        `    #${hole.id} 정점 ${hole.vertexCount} 닫힘 ${hole.closed} 전략 ${hole.appliedStrategy} 추가 ${hole.addedTriangles}`,
      );
    }
  } catch (error) {
    console.error(`  실패: ${error instanceof Error ? error.message : String(error)}`);
  }
}
