import type { PipelineResult } from '../core/pipeline.ts';
import { Badge } from './ui.tsx';

export const ENGINE_LABEL: Record<'patch' | 'solid', string> = {
  patch: '구멍 메우기',
  solid: '솔리드화',
};

/** 어떤 방식으로 고쳤는지와, 원본 형상을 얼마나 지켰는지 보여 준다. 점수와는 따로 둔다. */
export function EnginePanel({ result }: { result: PipelineResult }) {
  const fidelity = result.fidelity;
  const coverage = fidelity ? fidelity.inputCoverage * 100 : null;

  return (
    <section className="border-b border-ink-800 px-4 py-4">
      <div className="flex items-center justify-between gap-3 mb-2">
        <h2 className="label-caps">고친 방식</h2>
        <Badge tone={result.engine === 'solid' ? 'patch' : 'neutral'}>
          {ENGINE_LABEL[result.engine]}
          {result.requestedEngine === 'auto' ? ' · 자동' : ''}
        </Badge>
      </div>
      <p className="text-[12px] leading-relaxed text-ink-300">{result.engineReason}</p>
      {result.alternative && (
        <p className="text-[11px] text-ink-600 mt-1">
          함께 돌려 본 {ENGINE_LABEL[result.alternative.engine]}: {result.alternative.score}점
        </p>
      )}
      <p className="text-[11px] leading-relaxed text-ink-600 mt-2">
        {result.engine === 'solid'
          ? '안과 밖을 다시 정해 닫힌 표면을 새로 뽑았습니다. 원래 삼각형·UV·텍스처는 남지 않고, 두께가 없던 면에는 최소 두께를 줍니다.'
          : '원래 삼각형을 지키고 찾은 구멍만 막았습니다. 겹친 모서리와 면끼리의 관통은 그대로 남을 수 있습니다.'}
      </p>

      {fidelity && coverage !== null && (
        <div className="mt-3 pt-3 border-t border-ink-800">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[12px] text-ink-300">원래 모양 유지</span>
            <span className={`font-mono text-[13px] ${coverage >= 97 ? 'text-good' : coverage >= 90 ? 'text-amber-accent' : 'text-flaw'}`}>
              {coverage.toFixed(1)}%
            </span>
          </div>
          <p className="text-[11px] text-ink-600 mt-1 leading-relaxed">
            바깥 표면 넓이 중 결과와 가장 긴 축의 {(fidelity.toleranceRatio * 100).toFixed(1)}% 안으로 붙어 있는 비율입니다.
            가장 먼 5%는 {(fidelity.inputP95Ratio * 100).toFixed(2)}%까지 벗어났습니다. 점수에는 넣지 않습니다.
          </p>
          <div className="mt-1.5 grid grid-cols-[1fr_auto] gap-x-3 font-mono text-[11px] text-ink-400">
            <span className="font-sans">속에 묻혀 있던 면</span>
            <span>{(fidelity.buriedRatio * 100).toFixed(1)}%</span>
            <span className="font-sans">새로 생긴 면</span>
            <span>{(fidelity.outputNewRatio * 100).toFixed(1)}%</span>
          </div>
        </div>
      )}
    </section>
  );
}
