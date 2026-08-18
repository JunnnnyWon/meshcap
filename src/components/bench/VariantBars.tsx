import { VARIANT_IDS, VARIANT_LABEL, type ModelBenchmark } from '../../bench/schema.ts';

const BAR_TONE: Record<string, string> = {
  raw: 'bg-flaw/70',
  weldOnly: 'bg-amber-accent/60',
  naiveFan: 'bg-amber-accent',
  meshcap: 'bg-good',
};

export function VariantBars({ model }: { model: ModelBenchmark }) {
  return (
    <div className="space-y-1.5">
      {VARIANT_IDS.map((variant) => {
        const metrics = model.variants[variant];
        const isFinal = variant === 'meshcap';

        return (
          <div key={variant} className="flex items-center gap-3">
            <span
              className={`w-[92px] shrink-0 text-[11.5px] ${
                isFinal ? 'text-ink-100 font-medium' : 'text-ink-400'
              }`}
            >
              {VARIANT_LABEL[variant]}
            </span>

            <div className="flex-1 h-[18px] bg-ink-850 rounded-sm overflow-hidden relative">
              <div
                className={`h-full ${BAR_TONE[variant]} transition-all duration-700`}
                style={{ width: `${metrics.score}%` }}
              />
            </div>

            <span
              className={`w-9 shrink-0 text-right font-mono text-[12px] ${
                isFinal ? 'text-good' : 'text-ink-400'
              }`}
            >
              {metrics.score}
            </span>

            <span className="w-14 shrink-0 text-right font-mono text-[10.5px] text-ink-600">
              {metrics.watertight ? '밀폐' : `구멍 ${metrics.holes}`}
            </span>
          </div>
        );
      })}
    </div>
  );
}
