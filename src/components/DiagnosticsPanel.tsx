import type { PipelineResult } from '../core/pipeline.ts';
import { Delta, Panel, Stat } from './ui.tsx';

export function DiagnosticsPanel({ result }: { result: PipelineResult }) {
  const { input, repaired, inputSummary, patch, solid } = result;

  return (
    <>
      <Panel title="올린 그대로 → 보정 후">
        <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0 items-baseline">
          <span className="text-[12.5px] text-ink-400">열린 모서리</span>
          <Delta before={input.boundaryEdgeCount} after={repaired.boundaryEdgeCount} />
          <span className="text-[12.5px] text-ink-400">구멍 개수</span>
          <Delta before={input.boundaryLoopCount} after={repaired.boundaryLoopCount} />
          <span className="text-[12.5px] text-ink-400">겹친 모서리</span>
          <Delta before={input.nonManifoldEdgeCount} after={repaired.nonManifoldEdgeCount} />
          <span className="text-[12.5px] text-ink-400">나비 모양으로 겹친 점</span>
          <Delta before={input.nonManifoldVertexCount} after={repaired.nonManifoldVertexCount} />
          <span className="text-[12.5px] text-ink-400">방향이 엇갈린 모서리</span>
          <Delta before={input.inconsistentEdgeCount} after={repaired.inconsistentEdgeCount} />
          <span className="text-[12.5px] text-ink-400">찌그러진 삼각형</span>
          <Delta before={input.degenerateTriangles} after={repaired.degenerateTriangles} />
          <span className="text-[12.5px] text-ink-400">떨어진 덩어리</span>
          <Delta before={input.connectedComponents} after={repaired.connectedComponents} />
          <span className="text-[12.5px] text-ink-400">서로 뚫고 지나가는 면(쌍)</span>
          <span className="font-mono text-[12px]">
            <span className="text-ink-400">
              {input.selfIntersectionChecked ? input.selfIntersections.toLocaleString('ko-KR') : '확인 못 함'}
              {input.selfIntersectionCapped ? '+' : ''}
            </span>
            <span className="text-ink-600 mx-1.5">→</span>
            <span className={repaired.selfIntersections === 0 && repaired.selfIntersectionChecked ? 'text-good' : 'text-flaw'}>
              {repaired.selfIntersectionChecked ? repaired.selfIntersections.toLocaleString('ko-KR') : '확인 못 함'}
              {repaired.selfIntersectionCapped ? '+' : ''}
            </span>
          </span>
        </div>
        <p className="text-[11px] text-ink-600 mt-2 leading-relaxed">
          겹친 모서리는 한 모서리에 면이 셋 이상 붙은 곳입니다. 관통은 1만 쌍까지만 셉니다.
        </p>

        <div className="mt-3 pt-3 border-t border-ink-800">
          <Stat
            label="구멍이 막혔는지"
            value={repaired.watertight ? '막힘' : '열려 있음'}
            tone={repaired.watertight ? 'good' : 'flaw'}
          />
          <Stat
            label="닫힌 공 모양"
            value={repaired.eulerCharacteristic}
            tone={repaired.eulerCharacteristic === 2 ? 'good' : 'muted'}
            hint="구멍이 다 막힌 한 덩어리 공이면 2입니다"
          />
        </div>
      </Panel>

      <Panel title="올린 파일 읽기">
        <p className="text-[12px] leading-relaxed text-ink-400 mb-2.5">
          보정 전 점수는 여기까지만 한 상태로 잽니다. 좌표가 비트 단위로 같은 점만 합칩니다.
        </p>
        <Stat label="올린 삼각형" value={inputSummary.inputTriangles} />
        <Stat label="같은 좌표라 합친 점" value={inputSummary.mergedVertices} tone="muted" />
        <Stat
          label="면적이 0인 삼각형"
          value={inputSummary.removedDegenerateTriangles}
          tone={inputSummary.removedDegenerateTriangles > 0 ? 'flaw' : 'muted'}
          hint="꼭짓점이 겹친 삼각형입니다. 찌그러진 삼각형으로 셉니다"
        />
        {inputSummary.removedInvalidTriangles > 0 && (
          <Stat label="잘못된 좌표 삼각형" value={inputSummary.removedInvalidTriangles} tone="flaw" />
        )}
      </Panel>

      {patch && (
        <Panel title="구멍 메우기 내부">
          <p className="text-[12px] leading-relaxed text-ink-400 mb-2.5">
            구멍을 찾기 전에 가까운 점을 합치고 같은 면을 하나로 줄입니다. 반대 방향으로 두 번 든
            면을 하나로 줄이면 그 가장자리가 새 테두리가 되므로, 이 단계의 구멍 수는 올린 파일보다
            많을 수 있습니다.
          </p>
          <Stat label="합치는 거리" value={patch.weldSummary.epsilon.toExponential(2)} hint="모델 대각선 대비 1e-6" />
          <Stat label="합친 점" value={patch.weldSummary.mergedVertices} tone="muted" />
          <Stat label="하나로 줄인 겹친 면" value={patch.weldSummary.removedDuplicateTriangles} tone="muted" />
          <Stat label="합친 뒤 열린 모서리" value={patch.welded.boundaryEdgeCount} tone="muted" />
          {(patch.repairSummary.splitEdges > 0 || patch.repairSummary.clonedVertices > 0) && (
            <Stat
              label="겹친 모서리 분리"
              value={patch.repairSummary.splitEdges + patch.repairSummary.clonedVertices}
              tone="muted"
            />
          )}
          {patch.repairSummary.gapMergedPairs + patch.repairSummary.gapSnappedToEdge > 0 && (
            <Stat
              label="틈 맞추기"
              value={patch.repairSummary.gapMergedPairs + patch.repairSummary.gapSnappedToEdge}
              tone="muted"
            />
          )}
          {patch.repairSummary.collapsedHoles > 0 && (
            <Stat label="작게 닫은 구멍" value={patch.repairSummary.collapsedHoles} tone="muted" />
          )}
          {patch.repairSummary.bridgedTriangles > 0 && (
            <Stat label="찢김을 이은 면" value={patch.repairSummary.bridgedTriangles} tone="muted" />
          )}
          {patch.orientSummary.flippedTriangles > 0 && (
            <Stat label="뒤집은 면" value={patch.orientSummary.flippedTriangles} tone="muted" />
          )}
          <Stat
            label="남은 면 표면에 붙이기"
            value={patch.surfaceAttach ? '실행' : '생략'}
            tone="muted"
            hint="큰 모델에서는 수 분이 걸리고 점수를 바꾸지 못해 기본으로 생략합니다"
          />
        </Panel>
      )}

      {solid && (
        <Panel title="솔리드화 내부">
          <Stat label="격자" value={solid.grid.join(' × ')} />
          <Stat
            label="칸 크기"
            value={`${formatLength(solid.voxelSize)} (${(solid.voxelRatio * 100).toFixed(2)}%)`}
            hint="괄호는 가장 긴 축 대비 비율입니다"
          />
          <Stat label="반대 방향 짝 면(두께 0)" value={solid.soup.sheetGroups} tone="muted" />
          <Stat label="같은 방향으로 겹친 면" value={solid.soup.duplicateTriangles} tone="muted" />
          <Stat
            label="두께를 준 얇은 면"
            value={solid.thickenedTriangles}
            tone="muted"
            hint={`양쪽이 모두 바깥인 면에 두께 ${formatLength(solid.finRadius * 2)}를 줬습니다`}
          />
          <Stat label="채운 속 빈 격자점" value={solid.filledVoidPoints} tone="muted" />
          <Stat
            label="버린 떠 있는 조각"
            value={
              solid.removedShells > 0
                ? `${solid.removedShells.toLocaleString('ko-KR')}개 · 부피 ${(solid.removedVolumeRatio * 100).toFixed(3)}%`
                : '없음'
            }
            tone="muted"
          />
        </Panel>
      )}

      <Panel title="크기">
        <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0 items-baseline mb-1">
          <span className="text-[12.5px] text-ink-400">삼각형</span>
          <span className="font-mono text-[12px] text-ink-300">
            {input.triangleCount.toLocaleString('ko-KR')}
            <span className="text-ink-600 mx-1.5">→</span>
            {repaired.triangleCount.toLocaleString('ko-KR')}
          </span>
        </div>
        <Stat label="점" value={repaired.vertexCount} />
        <Stat label="새로 만든 면" value={repaired.triangleCount - result.newTriangleStart} tone="muted" />
        <Stat label="겉넓이" value={repaired.surfaceArea.toPrecision(4)} unit="u²" />
        <Stat label="부피" value={repaired.volume.toPrecision(4)} unit="u³" />
      </Panel>

      <Panel title="처리 시간">
        {result.timings.phases.map((phase, i) => (
          <Stat key={`${phase.id}-${i}`} label={phase.label} value={formatMs(phase.ms)} tone="muted" />
        ))}
        <div className="mt-2 pt-2 border-t border-ink-800">
          <Stat label="전체" value={formatMs(result.timings.total)} />
        </div>
      </Panel>
    </>
  );
}

export function formatMs(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(1)}초`;
}

export function formatLength(value: number): string {
  if (!Number.isFinite(value)) return '-';
  if (value === 0) return '0';
  const abs = Math.abs(value);
  if (abs >= 100) return value.toFixed(0);
  if (abs >= 1) return value.toFixed(2);
  return value.toPrecision(2);
}
