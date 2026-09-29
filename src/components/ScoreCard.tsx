import type { PrintabilityScore } from '../core/score.ts';

const GRADE_TONE: Record<PrintabilityScore['grade'], string> = {
  A: 'text-good',
  B: 'text-good',
  C: 'text-amber-accent',
  D: 'text-amber-accent',
  F: 'text-flaw',
};

export function ScoreCard({ before, after }: { before: PrintabilityScore; after: PrintabilityScore }) {
  const gained = after.total - before.total;
  const beforeItems = new Map(before.items.map((item) => [item.id, item]));

  return (
    <section className="border-b border-ink-800 px-4 py-4">
      <h2 className="label-caps mb-3">출력해도 되는지</h2>
      <p className="text-[12px] leading-relaxed text-ink-400 mb-3">
        보정 전 점수는 올린 파일을 그대로 잰 값입니다. 좌표가 완전히 같은 점만 합쳤고 면은 하나도
        빼지 않았습니다. 보정 전과 후 모두 같은 기준으로, 면끼리 뚫고 지나가는지까지 메시 전체를 봅니다.
      </p>

      <div className="flex items-end gap-4 mb-4">
        <div>
          <div className="flex items-baseline gap-1.5">
            <span className={`font-mono text-[42px] leading-none font-semibold ${GRADE_TONE[after.grade]}`}>
              {after.total}
            </span>
            <span className="font-mono text-[15px] text-ink-600">/100</span>
          </div>
          <div className="label-caps mt-1.5">보정 후</div>
        </div>

        <div className="pb-1">
          <div className="font-mono text-[13px] text-ink-400">
            <span title="올린 파일 그대로">{before.total}</span>
            <span className="mx-1.5 text-ink-600">→</span>
            <span className={gained > 0 ? 'text-good' : gained < 0 ? 'text-flaw' : 'text-ink-300'}>{after.total}</span>
          </div>
          {gained > 0 && <div className="font-mono text-[11px] text-good mt-0.5">+{gained}점 개선</div>}
          {gained < 0 && <div className="font-mono text-[11px] text-flaw mt-0.5">{gained}점 나빠짐</div>}
          <div className="text-[10.5px] text-ink-600 mt-0.5">올린 그대로 → 보정 후</div>
        </div>

        <div className={`ml-auto pb-1 font-mono text-[28px] font-semibold leading-none ${GRADE_TONE[after.grade]}`}>
          {after.grade}
        </div>
      </div>

      <p className="text-[12px] leading-relaxed text-ink-300 mb-4 pb-4 border-b border-ink-800">{after.verdict}</p>

      <div className="space-y-2.5">
        {after.items.map((item) => {
          const ratio = item.max > 0 ? item.earned / item.max : 0;
          const full = item.earned === item.max;
          const prior = beforeItems.get(item.id);
          const delta = prior ? item.earned - prior.earned : 0;

          return (
            <div key={item.id}>
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <span className="text-[12px] text-ink-300">{item.label}</span>
                <span className="font-mono text-[11px]">
                  {prior && (
                    <>
                      <span className="text-ink-600">{prior.earned}</span>
                      <span className="text-ink-700 mx-1">→</span>
                    </>
                  )}
                  <span className={full ? 'text-good' : delta < 0 ? 'text-flaw' : 'text-amber-accent'}>
                    {item.earned}/{item.max}
                  </span>
                </span>
              </div>
              <div className="h-[3px] rounded-full bg-ink-800 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    full ? 'bg-good' : ratio > 0 ? 'bg-amber-accent' : 'bg-flaw'
                  }`}
                  style={{ width: `${Math.max(ratio * 100, ratio > 0 ? 4 : 2)}%` }}
                />
              </div>
              <p className="text-[11px] text-ink-600 mt-1 leading-snug">{item.detail}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
