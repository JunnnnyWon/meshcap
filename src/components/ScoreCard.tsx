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

  return (
    <section className="border-b border-ink-800 px-4 py-4">
      <h2 className="label-caps mb-3">출력해도 되는지</h2>
      <p className="text-[12px] leading-relaxed text-ink-400 mb-3">
        막힘 점수보다 찢어진 자리가 주변 곡면에 이어져 보이는지가 먼저입니다. 점수는 진단용입니다.
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
            {before.total}
            <span className="mx-1.5 text-ink-600">→</span>
            <span className={gained > 0 ? 'text-good' : 'text-ink-300'}>
              {after.total}
            </span>
          </div>
          {gained > 0 && (
            <div className="font-mono text-[11px] text-good mt-0.5">+{gained}점 개선</div>
          )}
        </div>

        <div
          className={`ml-auto pb-1 font-mono text-[28px] font-semibold leading-none ${GRADE_TONE[after.grade]}`}
        >
          {after.grade}
        </div>
      </div>

      <p className="text-[12px] leading-relaxed text-ink-300 mb-4 pb-4 border-b border-ink-800">
        {after.verdict}
      </p>

      <div className="space-y-2.5">
        {after.items.map((item) => {
          const ratio = item.max > 0 ? item.earned / item.max : 0;
          const full = item.earned === item.max;

          return (
            <div key={item.id}>
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <span className="text-[12px] text-ink-300">{item.label}</span>
                <span className={`font-mono text-[11px] ${full ? 'text-good' : 'text-amber-accent'}`}>
                  {item.earned}/{item.max}
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
