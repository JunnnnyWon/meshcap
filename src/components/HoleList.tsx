import type { CapStrategy } from '../core/classify.ts';
import type { HoleReport } from '../core/pipeline.ts';
import { Badge } from './ui.tsx';

export const STRATEGY_LABEL: Record<CapStrategy, string> = {
  single: '삼각형 하나',
  fan: '부채꼴',
  planar: '평면으로 메움',
  liepa: '곡면으로 메움',
  flatBase: '바닥 받침',
  collapse: '작게 닫음',
  skip: '건너뜀',
};

export const STRATEGY_REASON: Record<CapStrategy, string> = {
  single: '점이 셋뿐이라 삼각형 하나로 끝납니다',
  fan: '작은 구멍이라 가운데에서 부채꼴로 막았습니다',
  planar: '테두리가 거의 평평해서 그대로 삼각형으로 나눴습니다',
  liepa: '테두리가 평평하지 않아서, 꺾이는 각이 작게 채웠습니다',
  flatBase: '아래를 향한 큰 구멍이라 바닥을 평평하게 막았습니다',
  collapse: '점이 너무 가까워 삼각형을 넣지 않고 한 점으로 모았습니다',
  skip: '테두리가 안 닫혀서 억지로 메우지 않았습니다',
};

const STRATEGY_TONE: Record<CapStrategy, 'neutral' | 'patch' | 'amber' | 'flaw'> = {
  single: 'neutral',
  fan: 'neutral',
  planar: 'patch',
  liepa: 'amber',
  flatBase: 'patch',
  collapse: 'neutral',
  skip: 'flaw',
};

export function HoleList({
  holes,
  selectedId,
  onSelect,
}: {
  holes: HoleReport[];
  selectedId: number | null;
  onSelect: (hole: HoleReport) => void;
}) {
  if (holes.length === 0) {
    return (
      <section className="border-b border-ink-800 px-4 py-4">
        <h2 className="label-caps mb-2">구멍 목록</h2>
        <p className="text-[12px] text-ink-400 leading-relaxed">
          겹친 점을 합치니 남은 구멍이 없습니다. 열려 보이던 자리는 점이 갈라져 있던 탓입니다.
        </p>
      </section>
    );
  }

  return (
    <section className="border-b border-ink-800">
      <header className="flex items-center justify-between px-4 pt-4 pb-2">
        <h2 className="label-caps">구멍 목록</h2>
        <span className="font-mono text-[11px] text-ink-400">{holes.length}개</span>
      </header>

      <div className="pb-2">
        {holes.map((hole) => {
          const active = hole.id === selectedId;
          return (
            <button
              key={hole.id}
              type="button"
              onClick={() => onSelect(hole)}
              className={`w-full text-left px-4 py-2.5 border-l-2 transition-colors ${
                active
                  ? 'border-amber-accent bg-ink-850'
                  : 'border-transparent hover:bg-ink-900 hover:border-ink-700'
              }`}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <span className="font-mono text-[11px] text-ink-600 w-6 shrink-0">
                  #{String(hole.id + 1).padStart(2, '0')}
                </span>
                <Badge tone={STRATEGY_TONE[hole.appliedStrategy]}>
                  {STRATEGY_LABEL[hole.appliedStrategy]}
                </Badge>
                {hole.fellBack && <Badge tone="flaw">다른 방법</Badge>}
                {!hole.closed && <Badge tone="flaw">테두리 안 닫힘</Badge>}
              </div>

              <div className="flex items-center gap-3 font-mono text-[11px] text-ink-400 pl-8">
                <span title="테두리 점 수">{hole.vertexCount}점</span>
                <span title="테두리 길이">둘레 {hole.perimeter.toFixed(2)}</span>
                <span title="얼마나 평평한지. 0이면 완전히 평평합니다">
                  평평함 {hole.planarity.toFixed(3)}
                </span>
                {hole.addedTriangles > 0 && (
                  <span className="text-patch ml-auto">+{hole.addedTriangles}면</span>
                )}
              </div>

              {active && (
                <p className="text-[11px] text-ink-600 mt-1.5 pl-8 leading-snug">
                  {STRATEGY_REASON[hole.appliedStrategy]}
                </p>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
