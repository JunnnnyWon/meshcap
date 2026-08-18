import { useCallback, useRef, useState } from 'react';
import { loadMeshFromFile, SUPPORTED_EXTENSIONS } from '../../io/loadMesh.ts';
import { measureModel } from '../../bench/measure.ts';
import { downloadBlob } from '../../io/exportMesh.ts';
import { Badge, Button } from '../ui.tsx';
import {
  SOURCE_LABEL,
  type BenchmarkFile,
  type ModelBenchmark,
  type ModelSource,
} from '../../bench/schema.ts';

/** 파일 이름에 서비스 이름이 들어 있으면 출처를 자동으로 잡는다. */
function guessSource(fileName: string): ModelSource {
  const lower = fileName.toLowerCase();
  if (lower.includes('meshy')) return 'meshy';
  if (lower.includes('tripo')) return 'tripo';
  return 'meshy';
}

/** 접두어로 붙인 서비스 이름과 확장자를 떼어 콘셉트 이름만 남긴다. */
function guessConcept(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, '')
    .replace(/^(meshy|tripo)[-_ ]*/i, '')
    .replace(/[-_]/g, ' ')
    .trim();
}

export function BenchIngest({ existing }: { existing: ModelBenchmark[] }) {
  const [measured, setMeasured] = useState<ModelBenchmark[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(async (files: FileList) => {
    setError(null);
    const results: ModelBenchmark[] = [];

    for (const file of Array.from(files)) {
      setBusy(file.name);
      try {
        const loaded = await loadMeshFromFile(file);
        const source = guessSource(file.name);
        const concept = guessConcept(file.name);

        results.push(
          measureModel(loaded.mesh, {
            id: `${source}-${concept.replace(/\s+/g, '-')}`,
            label: `${SOURCE_LABEL[source]} · ${concept}`,
            source,
            concept,
            fileName: file.name,
            fileBytes: file.size,
            upAxis: loaded.suggestedUpAxis,
          }),
        );
      } catch (err) {
        setError(`${file.name}: ${err instanceof Error ? err.message : '처리 실패'}`);
      }
    }

    setBusy(null);
    setMeasured((prev) => [...prev, ...results]);
  }, []);

  const updateModel = (index: number, patch: Partial<ModelBenchmark>) => {
    setMeasured((prev) => prev.map((model, i) => (i === index ? { ...model, ...patch } : model)));
  };

  const exportMerged = () => {
    // 합성 대조군은 남기고 같은 id의 실측 데이터만 갈아 끼운다.
    const byId = new Map(existing.map((model) => [model.id, model]));
    for (const model of measured) byId.set(model.id, model);

    const file: BenchmarkFile = {
      generatedAt: new Date().toISOString(),
      note: '합성 대조군과 실제 서비스 출력물 측정 결과를 병합한 파일입니다.',
      models: [...byId.values()],
    };

    downloadBlob(JSON.stringify(file, null, 2), 'results.json', 'application/json');
  };

  return (
    <section className="rounded-xl border border-ink-800 bg-ink-900/40 p-6">
      <h2 className="text-[15px] font-medium text-ink-100 mb-1.5">측정 데이터 만들기</h2>
      <p className="text-[12.5px] leading-relaxed text-ink-400 mb-5 max-w-[720px]">
        Meshy·Tripo에서 내려받은 파일을 여기에 넣으면 위 표와 같은 네 단계 측정을 그대로 수행합니다.
        측정은 브라우저 안에서 끝나고, 결과 JSON만 내려받아 저장소의{' '}
        <code className="font-mono text-[11.5px] text-ink-300">src/bench/results.json</code>에 덮어쓰면
        이 페이지에 실측값이 반영됩니다. 파일 이름에 meshy 또는 tripo를 넣어 두면 출처를 자동으로 잡습니다.
      </p>

      <div className="flex items-center gap-3 flex-wrap">
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={SUPPORTED_EXTENSIONS.join(',')}
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <Button variant="outline" onClick={() => inputRef.current?.click()}>
          모델 파일 선택
        </Button>
        {measured.length > 0 && (
          <>
            <Button variant="primary" onClick={exportMerged}>
              results.json 내려받기
            </Button>
            <Button variant="ghost" onClick={() => setMeasured([])}>
              측정 결과 비우기
            </Button>
          </>
        )}
        {busy && <span className="text-[12px] text-ink-400">{busy} 측정 중…</span>}
      </div>

      {error && <p className="mt-3 text-[12px] text-flaw">{error}</p>}

      {measured.length > 0 && (
        <div className="mt-5 space-y-2">
          {measured.map((model, index) => (
            <div
              key={`${model.id}-${index}`}
              className="flex items-center gap-3 flex-wrap rounded-lg border border-ink-800 bg-ink-950 px-3 py-2.5"
            >
              <span className="font-mono text-[11px] text-ink-600 truncate max-w-[200px]">
                {model.fileName}
              </span>

              <select
                value={model.source}
                onChange={(e) => {
                  const source = e.target.value as ModelSource;
                  updateModel(index, {
                    source,
                    id: `${source}-${model.concept.replace(/\s+/g, '-')}`,
                    label: `${SOURCE_LABEL[source]} · ${model.concept}`,
                  });
                }}
                className="bg-ink-850 border border-ink-700 rounded px-2 py-1 text-[12px] text-ink-100 outline-none"
              >
                <option value="meshy">Meshy AI</option>
                <option value="tripo">Tripo AI</option>
                <option value="synthetic">합성 대조군</option>
              </select>

              <input
                value={model.concept}
                onChange={(e) => {
                  const concept = e.target.value;
                  updateModel(index, {
                    concept,
                    id: `${model.source}-${concept.replace(/\s+/g, '-')}`,
                    label: `${SOURCE_LABEL[model.source]} · ${concept}`,
                  });
                }}
                placeholder="콘셉트 이름"
                className="bg-ink-850 border border-ink-700 rounded px-2 py-1 text-[12px] text-ink-100 outline-none w-40"
              />

              <div className="ml-auto flex items-center gap-2 font-mono text-[11px]">
                <Badge tone="flaw">무처리 {model.variants.raw.score}</Badge>
                <span className="text-ink-600">→</span>
                <Badge tone="good">MeshCap {model.variants.meshcap.score}</Badge>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
