import { runPipeline } from '../core/pipeline.ts';
import { scorePrintability } from '../core/score.ts';
import type { MeshData } from '../core/types.ts';
import type { UpAxis } from '../core/classify.ts';
import type { ValidationReport } from '../core/validate.ts';
import type { ModelBenchmark, ModelSource, VariantId, VariantMetrics } from './schema.ts';

export interface ModelMeta {
  id: string;
  label: string;
  source: ModelSource;
  concept: string;
  fileName: string;
  fileBytes: number;
  upAxis: UpAxis;
}

function toMetrics(report: ValidationReport, baseTriangles: number, elapsedMs: number): VariantMetrics {
  const score = scorePrintability(report);
  return {
    vertices: report.vertexCount,
    triangles: report.triangleCount,
    addedTriangles: report.triangleCount - baseTriangles,
    boundaryEdges: report.boundaryEdgeCount,
    holes: report.boundaryLoopCount,
    nonManifoldEdges: report.nonManifoldEdgeCount,
    inconsistentEdges: report.inconsistentEdgeCount,
    components: report.connectedComponents,
    degenerateTriangles: report.degenerateTriangles,
    watertight: report.watertight,
    volume: report.volume,
    score: score.total,
    grade: score.grade,
    elapsedMs: Math.round(elapsedMs * 100) / 100,
  };
}

/**
 * 같은 모델을 네 가지 처리 수준으로 돌려 비교표 한 줄을 만든다.
 *
 * 무처리에서 MeshCap까지 한 단계씩 올려가며 재기 때문에, 최종 점수 차이 중
 * 어디까지가 단순한 정점 용접 덕이고 어디부터가 분류와 전략 분기 덕인지 분리된다.
 * 외부 도구와 비교하는 대신 우리 파이프라인을 절제하는 방식이라, 누구든 같은
 * 스크립트로 같은 숫자를 재현할 수 있다.
 */
export function measureModel(mesh: MeshData, meta: ModelMeta): ModelBenchmark {
  const options = { upAxis: meta.upAxis };

  const diagnostic = runPipeline(mesh, { ...options, diagnoseOnly: true });
  const rawTriangles = diagnostic.raw.triangleCount;

  const naiveStart = now();
  const naive = runPipeline(mesh, {
    ...options,
    skipOrient: true,
    disableFlatBase: true,
    forceStrategy: 'fan',
  });
  const naiveElapsed = now() - naiveStart;

  const fullStart = now();
  const full = runPipeline(mesh, options);
  const fullElapsed = now() - fullStart;

  const strategyCounts: Record<string, number> = {};
  for (const hole of full.holes) {
    strategyCounts[hole.appliedStrategy] = (strategyCounts[hole.appliedStrategy] ?? 0) + 1;
  }

  const variants: Record<VariantId, VariantMetrics> = {
    raw: toMetrics(diagnostic.raw, rawTriangles, 0),
    weldOnly: toMetrics(diagnostic.welded, rawTriangles, diagnostic.timings.weld),
    naiveFan: toMetrics(naive.repaired, rawTriangles, naiveElapsed),
    meshcap: toMetrics(full.repaired, rawTriangles, fullElapsed),
  };

  const largestHole = full.holes.reduce((max, hole) => Math.max(max, hole.relativeSize), 0);
  const originalVertices = diagnostic.raw.vertexCount || 1;

  return {
    id: meta.id,
    label: meta.label,
    source: meta.source,
    concept: meta.concept,
    fileName: meta.fileName,
    fileBytes: meta.fileBytes,
    upAxis: meta.upAxis,
    variants,
    strategyCounts,
    weld: {
      mergedVertices: full.weldSummary.mergedVertices,
      mergedRatio: full.weldSummary.mergedVertices / originalVertices,
    },
    largestHoleRelativeSize: Math.round(largestHole * 10000) / 10000,
  };
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
