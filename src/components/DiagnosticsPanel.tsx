import type { PipelineResult } from '../core/pipeline.ts';
import { Delta, Panel, Stat } from './ui.tsx';

export function DiagnosticsPanel({ result }: { result: PipelineResult }) {
  const { raw, welded, repaired, weldSummary, orientSummary } = result;

  return (
    <>
      <Panel title="용접 전처리">
        <p className="text-[12px] leading-relaxed text-ink-400 mb-2.5">
          좌표가 같은데 인덱스만 다른 정점을 먼저 합칩니다. 이 단계를 건너뛰면 멀쩡한 면 사이의
          이음매까지 구멍으로 잡힙니다.
        </p>
        <Stat label="병합 반경" value={weldSummary.epsilon.toExponential(2)} hint="bbox 대각선 대비 1e-6" />
        <Stat label="병합된 정점" value={weldSummary.mergedVertices} tone={weldSummary.mergedVertices > 0 ? 'flaw' : 'muted'} />
        <Stat label="미참조 정점" value={weldSummary.unreferencedVertices} tone="muted" />
        <Stat label="퇴화 삼각형 제거" value={weldSummary.removedDegenerateTriangles} tone="muted" />
        <Stat label="중복 삼각형 제거" value={weldSummary.removedDuplicateTriangles} tone="muted" />
        {weldSummary.removedInvalidTriangles > 0 && (
          <Stat label="NaN 좌표 삼각형 제거" value={weldSummary.removedInvalidTriangles} tone="flaw" />
        )}

        <div className="mt-3 pt-3 border-t border-ink-800">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[12.5px] text-ink-400">경계 에지 오탐</span>
            <Delta before={raw.boundaryEdgeCount} after={welded.boundaryEdgeCount} />
          </div>
          <p className="text-[11px] text-ink-600 mt-1.5 leading-relaxed">
            용접 전 수치는 실제 구멍이 아니라 쪼개진 정점 때문에 부풀려진 값입니다.
          </p>
        </div>
      </Panel>

      <Panel title="위상 진단">
        <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0 items-baseline">
          <span className="text-[12.5px] text-ink-400">경계 에지</span>
          <Delta before={welded.boundaryEdgeCount} after={repaired.boundaryEdgeCount} />
          <span className="text-[12.5px] text-ink-400">구멍 개수</span>
          <Delta before={welded.boundaryLoopCount} after={repaired.boundaryLoopCount} />
          <span className="text-[12.5px] text-ink-400">비다양체 에지</span>
          <Delta before={welded.nonManifoldEdgeCount} after={repaired.nonManifoldEdgeCount} />
          <span className="text-[12.5px] text-ink-400">방향 불일치 에지</span>
          <Delta before={welded.inconsistentEdgeCount} after={repaired.inconsistentEdgeCount} />
          <span className="text-[12.5px] text-ink-400">퇴화 삼각형</span>
          <Delta before={welded.degenerateTriangles} after={repaired.degenerateTriangles} />
          <span className="text-[12.5px] text-ink-400">연결 요소</span>
          <Delta before={welded.connectedComponents} after={repaired.connectedComponents} />
        </div>

        <div className="mt-3 pt-3 border-t border-ink-800">
          <Stat
            label="오일러 지표"
            value={repaired.eulerCharacteristic}
            tone={repaired.eulerCharacteristic === 2 ? 'good' : 'muted'}
            hint="닫힌 구 위상이면 2입니다"
          />
          <Stat
            label="밀폐 여부"
            value={repaired.watertight ? '밀폐됨' : '열려 있음'}
            tone={repaired.watertight ? 'good' : 'flaw'}
          />
          <Stat
            label="뚜껑 관통"
            value={
              repaired.selfIntersectionChecked ? repaired.capSelfIntersections : '검사 생략'
            }
            tone={repaired.capSelfIntersections > 0 ? 'flaw' : 'good'}
          />
        </div>
      </Panel>

      <Panel title="형상 및 규모">
        <Stat label="정점" value={repaired.vertexCount} />
        <Stat label="삼각형" value={repaired.triangleCount} />
        <Stat
          label="추가된 삼각형"
          value={repaired.triangleCount - welded.triangleCount}
          tone="muted"
        />
        <Stat label="표면적" value={repaired.surfaceArea.toFixed(3)} unit="u²" />
        <Stat label="부피" value={repaired.volume.toFixed(3)} unit="u³" />
        {orientSummary.flippedTriangles > 0 && (
          <Stat label="방향 되돌린 면" value={orientSummary.flippedTriangles} tone="muted" />
        )}
        {orientSummary.invertedShells > 0 && (
          <Stat
            label="바깥으로 뒤집은 껍질"
            value={orientSummary.invertedShells}
            tone="muted"
            hint="법선이 안쪽을 향하던 덩어리입니다"
          />
        )}
      </Panel>

      <Panel title="처리 시간">
        <Stat label="용접" value={result.timings.weld.toFixed(1)} unit="ms" tone="muted" />
        <Stat label="위상 분석 · 분류" value={result.timings.analyze.toFixed(1)} unit="ms" tone="muted" />
        <Stat label="구멍 메우기" value={result.timings.cap.toFixed(1)} unit="ms" tone="muted" />
        <Stat label="법선 정렬" value={result.timings.orient.toFixed(1)} unit="ms" tone="muted" />
        <Stat label="검증" value={result.timings.validate.toFixed(1)} unit="ms" tone="muted" />
        <div className="mt-2 pt-2 border-t border-ink-800">
          <Stat label="전체" value={result.timings.total.toFixed(1)} unit="ms" />
        </div>
      </Panel>
    </>
  );
}
