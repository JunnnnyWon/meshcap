import { runPipeline, type PipelineResult } from '../core/pipeline.ts';
import type { MeshData } from '../core/types.ts';
import type { UpAxis } from '../core/classify.ts';
import type { ValidationReport } from '../core/validate.ts';
import type { PrintabilityScore } from '../core/score.ts';
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

function toMetrics(
  report: ValidationReport,
  score: PrintabilityScore,
  baseTriangles: number,
  elapsedMs: number,
  shapeKept: number,
  engine?: 'patch' | 'solid',
): VariantMetrics {
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
    selfIntersections: report.selfIntersections,
    watertight: report.watertight,
    volume: report.volume,
    score: score.total,
    grade: score.grade,
    elapsedMs: Math.round(elapsedMs),
    shapeKept: Math.round(shapeKept * 10000) / 10000,
    ...(engine ? { engine } : {}),
  };
}

function fromResult(result: PipelineResult, baseTriangles: number): VariantMetrics {
  return toMetrics(
    result.repaired,
    result.repairedScore,
    baseTriangles,
    result.timings.total,
    result.fidelity?.inputCoverage ?? 1,
    result.engine,
  );
}

/**
 * 같은 모델을 처리 수준별로 돌려 비교표 한 줄을 만든다.
 *
 * 보정 전은 올린 파일 그대로다. 구멍 메우기와 솔리드화를 각각 돌리고, 자동 선택이
 * 무엇을 골랐는지도 따로 적는다. 모든 변형을 같은 채점기(메시 전체 관통 검사 포함)로 잰다.
 */
export function measureModel(mesh: MeshData, meta: ModelMeta): ModelBenchmark {
  const options = { upAxis: meta.upAxis };

  const naive = runPipeline(mesh, {
    ...options,
    engine: 'patch',
    skipOrient: true,
    disableFlatBase: true,
    forceStrategy: 'fan',
  });
  const patch = runPipeline(mesh, { ...options, engine: 'patch' });
  const solid = runPipeline(mesh, { ...options, engine: 'solid' });
  const auto = runPipeline(mesh, { ...options, engine: 'auto' });

  const base = patch.input.triangleCount;
  const diagnoseMs = patch.timings.phases.find((phase) => phase.id === 'diagnose')?.ms ?? 0;

  const strategyCounts: Record<string, number> = {};
  for (const hole of patch.holes) {
    strategyCounts[hole.appliedStrategy] = (strategyCounts[hole.appliedStrategy] ?? 0) + 1;
  }

  const variants: Record<VariantId, VariantMetrics> = {
    raw: toMetrics(patch.input, patch.inputScore, base, diagnoseMs, 1),
    naiveFan: fromResult(naive, base),
    patch: fromResult(patch, base),
    solid: fromResult(solid, base),
    meshcap: fromResult(auto, base),
  };

  const largestHole = patch.holes.reduce((max, hole) => Math.max(max, hole.relativeSize), 0);
  const originalVertices = mesh.positions.length / 3 || 1;

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
      mergedVertices: patch.inputSummary.mergedVertices,
      mergedRatio: patch.inputSummary.mergedVertices / originalVertices,
    },
    largestHoleRelativeSize: Math.round(largestHole * 10000) / 10000,
  };
}
