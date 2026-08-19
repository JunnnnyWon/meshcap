import { useMemo, useState } from 'react';
import rawResults from '../bench/results.json';
import {
  SOURCE_LABEL,
  VARIANT_DESCRIPTION,
  VARIANT_IDS,
  VARIANT_LABEL,
  type BenchmarkFile,
  type ModelBenchmark,
  type ModelSource,
} from '../bench/schema.ts';
import { VariantBars } from '../components/bench/VariantBars.tsx';
import { BenchIngest } from '../components/bench/BenchIngest.tsx';
import { STRATEGY_LABEL } from '../components/HoleList.tsx';
import { Badge } from '../components/ui.tsx';
import type { CapStrategy } from '../core/classify.ts';

const data = rawResults as BenchmarkFile;

export function BenchmarkPage() {
  const [expanded, setExpanded] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const bySource = new Map<ModelSource, ModelBenchmark[]>();
    for (const model of data.models) {
      const list = bySource.get(model.source) ?? [];
      list.push(model);
      bySource.set(model.source, list);
    }
    return bySource;
  }, []);

  const hasRealData = grouped.has('meshy') || grouped.has('tripo');
  const order: ModelSource[] = ['meshy', 'tripo', 'synthetic'];

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[1080px] px-6 py-12">
        <header className="mb-10 max-w-[760px]">
          <div className="label-caps mb-3">정량 비교</div>
          <h1 className="text-[30px] leading-tight font-semibold tracking-[-0.02em] text-ink-100">
            같은 모델을 네 단계로 잘라, 점수가 어디서 오르는지 봅니다
          </h1>
          <p className="mt-4 text-[14px] leading-relaxed text-ink-300">
            다른 도구 결과만 놓고 비교하면 왜 올랐는지 안 보입니다. 그래서 우리 파이프라인을 한
            단계씩 떼어 재 봤습니다. 용접만으로 사라지는 결함이 있고, 아무렇게나 메워도 되는 구멍이
            있고, 분류와 법선 정렬이 있어야 넘어가는 것도 있습니다.
          </p>
        </header>

        <section className="mb-10 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {VARIANT_IDS.map((variant, index) => (
            <div key={variant} className="rounded-lg border border-ink-800 bg-ink-900/40 p-4">
              <div className="flex items-baseline gap-2 mb-2">
                <span className="font-mono text-[11px] text-ink-600">0{index + 1}</span>
                <span className="text-[13px] font-medium text-ink-100">{VARIANT_LABEL[variant]}</span>
              </div>
              <p className="text-[11.5px] leading-relaxed text-ink-400">
                {VARIANT_DESCRIPTION[variant]}
              </p>
            </div>
          ))}
        </section>

        {!hasRealData && (
          <div className="mb-10 rounded-lg border border-amber-accent/25 bg-amber-accent/5 px-5 py-4">
            <p className="text-[13px] leading-relaxed text-ink-200">
              아직 Meshy·Tripo 실측이 없어서 합성 대조군만 보여 줍니다. 아래 패널에 두 서비스 파일을
              넣으면 같은 기준으로 잰 숫자로 바뀝니다.
            </p>
          </div>
        )}

        {order.map((source) => {
          const models = grouped.get(source);
          if (!models || models.length === 0) return null;

          return (
            <section key={source} className="mb-12">
              <div className="flex items-baseline gap-3 mb-5 pb-2.5 border-b border-ink-800">
                <h2 className="text-[16px] font-medium text-ink-100">{SOURCE_LABEL[source]}</h2>
                <span className="font-mono text-[11px] text-ink-600">{models.length}개 모델</span>
              </div>

              <div className="space-y-7">
                {models.map((model) => {
                  const open = expanded === model.id;
                  const gain = model.variants.meshcap.score - model.variants.raw.score;

                  return (
                    <article key={model.id}>
                      <div className="flex items-baseline justify-between gap-3 mb-3 flex-wrap">
                        <div className="flex items-baseline gap-2.5">
                          <h3 className="text-[14px] text-ink-100">{model.label}</h3>
                          <span className="font-mono text-[10.5px] text-ink-600">{model.concept}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[11px] text-good">+{gain}점</span>
                          <button
                            type="button"
                            onClick={() => setExpanded(open ? null : model.id)}
                            className="font-mono text-[11px] text-ink-400 hover:text-ink-100 transition-colors"
                          >
                            {open ? '접기' : '상세'}
                          </button>
                        </div>
                      </div>

                      <VariantBars model={model} />

                      {open && <ModelDetail model={model} />}
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}

        <BenchIngest existing={data.models} />

        <p className="mt-6 font-mono text-[11px] text-ink-600">
          측정 시각 {new Date(data.generatedAt).toLocaleString('ko-KR')} · {data.note}
        </p>
      </div>
    </div>
  );
}

function ModelDetail({ model }: { model: ModelBenchmark }) {
  const rows: { label: string; key: keyof ModelBenchmark['variants']['raw']; unit?: string }[] = [
    { label: '삼각형', key: 'triangles' },
    { label: '추가된 삼각형', key: 'addedTriangles' },
    { label: '경계 에지', key: 'boundaryEdges' },
    { label: '구멍', key: 'holes' },
    { label: '비다양체 에지', key: 'nonManifoldEdges' },
    { label: '방향 불일치 에지', key: 'inconsistentEdges' },
    { label: '연결 요소', key: 'components' },
    { label: '처리 시간', key: 'elapsedMs', unit: 'ms' },
  ];

  const strategies = Object.entries(model.strategyCounts) as [CapStrategy, number][];

  return (
    <div className="mt-4 rounded-lg border border-ink-800 bg-ink-900/40 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-ink-800">
              <th className="text-left font-normal text-ink-400 px-4 py-2.5 whitespace-nowrap">지표</th>
              {VARIANT_IDS.map((variant) => (
                <th
                  key={variant}
                  className={`text-right font-normal px-4 py-2.5 whitespace-nowrap ${
                    variant === 'meshcap' ? 'text-ink-100' : 'text-ink-400'
                  }`}
                >
                  {VARIANT_LABEL[variant]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-b border-ink-800/60 last:border-0">
                <td className="px-4 py-2 text-ink-400 whitespace-nowrap">{row.label}</td>
                {VARIANT_IDS.map((variant) => {
                  const value = model.variants[variant][row.key];
                  return (
                    <td
                      key={variant}
                      className={`px-4 py-2 text-right font-mono ${
                        variant === 'meshcap' ? 'text-ink-100' : 'text-ink-400'
                      }`}
                    >
                      {typeof value === 'number' ? value.toLocaleString('ko-KR') : String(value)}
                      {row.unit && <span className="text-ink-600 ml-0.5 text-[10px]">{row.unit}</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="px-4 py-3 border-t border-ink-800 flex items-center gap-4 flex-wrap">
        <span className="label-caps">적용 전략</span>
        {strategies.length === 0 ? (
          <span className="text-[11.5px] text-ink-400">메울 구멍이 없었습니다</span>
        ) : (
          strategies.map(([strategy, count]) => (
            <Badge key={strategy} tone="patch">
              {STRATEGY_LABEL[strategy]} {count}
            </Badge>
          ))
        )}

        <span className="ml-auto font-mono text-[11px] text-ink-600">
          정점 병합률 {(model.weld.mergedRatio * 100).toFixed(1)}%
        </span>
      </div>
    </div>
  );
}
