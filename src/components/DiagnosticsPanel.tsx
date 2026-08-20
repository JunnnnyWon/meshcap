import type { PipelineResult } from '../core/pipeline.ts';
import { Delta, Panel, Stat } from './ui.tsx';

export function DiagnosticsPanel({ result }: { result: PipelineResult }) {
  const { raw, welded, repaired, weldSummary, orientSummary } = result;

  return (
    <>
      <Panel title="겹친 점 합치기">
        <p className="text-[12px] leading-relaxed text-ink-400 mb-2.5">
          위치가 같은데 따로 적혀 있는 점을 먼저 합칩니다. 이 단계를 건너뛰면 멀쩡히 붙은
          이음새까지 구멍으로 잡힙니다.
        </p>
        <Stat label="합치는 거리" value={weldSummary.epsilon.toExponential(2)} hint="모델 대각선 대비 1e-6" />
        <Stat label="합친 점" value={weldSummary.mergedVertices} tone={weldSummary.mergedVertices > 0 ? 'flaw' : 'muted'} />
        <Stat label="안 쓰인 점" value={weldSummary.unreferencedVertices} tone="muted" />
        <Stat label="찌그러진 삼각형 제거" value={weldSummary.removedDegenerateTriangles} tone="muted" />
        <Stat label="겹친 삼각형 제거" value={weldSummary.removedDuplicateTriangles} tone="muted" />
        {weldSummary.removedInvalidTriangles > 0 && (
          <Stat label="잘못된 좌표 삼각형 제거" value={weldSummary.removedInvalidTriangles} tone="flaw" />
        )}

        <div className="mt-3 pt-3 border-t border-ink-800">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[12.5px] text-ink-400">열린 모서리 오탐</span>
            <Delta before={raw.boundaryEdgeCount} after={welded.boundaryEdgeCount} />
          </div>
          <p className="text-[11px] text-ink-600 mt-1.5 leading-relaxed">
            합치기 전 숫자는 실제 구멍이 아니라, 점이 갈라져 있어서 부풀려진 값입니다.
          </p>
        </div>
      </Panel>

      <Panel title="구조 점검">
        <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0 items-baseline">
          <span className="text-[12.5px] text-ink-400">열린 모서리</span>
          <Delta before={welded.boundaryEdgeCount} after={repaired.boundaryEdgeCount} />
          <span className="text-[12.5px] text-ink-400">구멍 개수</span>
          <Delta before={welded.boundaryLoopCount} after={repaired.boundaryLoopCount} />
          <span className="text-[12.5px] text-ink-400">겹친 모서리</span>
          <Delta before={welded.nonManifoldEdgeCount} after={repaired.nonManifoldEdgeCount} />
          <span className="text-[12.5px] text-ink-400">방향이 엇갈린 모서리</span>
          <Delta before={welded.inconsistentEdgeCount} after={repaired.inconsistentEdgeCount} />
          <span className="text-[12.5px] text-ink-400">찌그러진 삼각형</span>
          <Delta before={welded.degenerateTriangles} after={repaired.degenerateTriangles} />
          <span className="text-[12.5px] text-ink-400">떨어진 덩어리</span>
          <Delta before={welded.connectedComponents} after={repaired.connectedComponents} />
        </div>

        <div className="mt-3 pt-3 border-t border-ink-800">
          <Stat
            label="닫힌 공 모양"
            value={repaired.eulerCharacteristic}
            tone={repaired.eulerCharacteristic === 2 ? 'good' : 'muted'}
            hint="구멍이 다 막힌 공이면 2입니다"
          />
          <Stat
            label="구멍이 막혔는지"
            value={repaired.watertight ? '막힘' : '열려 있음'}
            tone={repaired.watertight ? 'good' : 'flaw'}
          />
          <Stat
            label="메운 면이 뚫고 나가는지"
            value={
              repaired.selfIntersectionChecked ? repaired.capSelfIntersections : '검사 생략'
            }
            tone={repaired.capSelfIntersections > 0 ? 'flaw' : 'good'}
          />
        </div>
      </Panel>

      <Panel title="크기">
        <Stat label="점" value={repaired.vertexCount} />
        <Stat label="삼각형" value={repaired.triangleCount} />
        <Stat
          label="새로 만든 삼각형"
          value={repaired.triangleCount - welded.triangleCount}
          tone="muted"
        />
        <Stat label="겉넓이" value={repaired.surfaceArea.toFixed(3)} unit="u²" />
        <Stat label="부피" value={repaired.volume.toFixed(3)} unit="u³" />
        {orientSummary.flippedTriangles > 0 && (
          <Stat label="뒤집힌 면" value={orientSummary.flippedTriangles} tone="muted" />
        )}
        {orientSummary.invertedShells > 0 && (
          <Stat
            label="안팎을 뒤집은 덩어리"
            value={orientSummary.invertedShells}
            tone="muted"
            hint="면이 안쪽을 보고 있던 덩어리입니다"
          />
        )}
      </Panel>

      <Panel title="처리 시간">
        <Stat label="점 합치기" value={result.timings.weld.toFixed(1)} unit="ms" tone="muted" />
        <Stat label="구멍 찾기" value={result.timings.analyze.toFixed(1)} unit="ms" tone="muted" />
        <Stat label="구멍 메우기" value={result.timings.cap.toFixed(1)} unit="ms" tone="muted" />
        <Stat label="면 방향 맞추기" value={result.timings.orient.toFixed(1)} unit="ms" tone="muted" />
        <Stat label="점수 매기기" value={result.timings.validate.toFixed(1)} unit="ms" tone="muted" />
        <div className="mt-2 pt-2 border-t border-ink-800">
          <Stat label="전체" value={result.timings.total.toFixed(1)} unit="ms" />
        </div>
      </Panel>
    </>
  );
}
