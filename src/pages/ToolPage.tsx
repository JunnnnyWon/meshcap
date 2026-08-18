import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dropzone } from '../components/Dropzone.tsx';
import { Viewer, type FocusRequest } from '../components/Viewer.tsx';
import { DiagnosticsPanel } from '../components/DiagnosticsPanel.tsx';
import { ScoreCard } from '../components/ScoreCard.tsx';
import { HoleList } from '../components/HoleList.tsx';
import { Button, SegmentedControl } from '../components/ui.tsx';
import { loadMeshFromFile } from '../io/loadMesh.ts';
import { derivedFileName, downloadBlob, toBinarySTL, toGLB } from '../io/exportMesh.ts';
import { runPipelineInWorker } from '../worker/client.ts';
import { STAGE_LABEL, type HoleReport, type PipelineResult, type PipelineStage } from '../core/pipeline.ts';
import { triangleCount } from '../core/types.ts';
import type { UpAxis } from '../core/classify.ts';
import type { MeshData } from '../core/types.ts';
import type { SampleModel } from '../samples/index.ts';
import type { ViewMode } from '../viewer/MeshViewer.ts';

interface Source {
  mesh: MeshData;
  name: string;
  byteSize: number;
  partCount: number;
  origin: 'file' | 'sample';
}

export function ToolPage() {
  const [source, setSource] = useState<Source | null>(null);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<PipelineStage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [upAxis, setUpAxis] = useState<UpAxis>('y');
  const [flatBase, setFlatBase] = useState(true);
  const [mode, setMode] = useState<ViewMode>('before');
  const [wireframe, setWireframe] = useState(false);
  const [selectedHole, setSelectedHole] = useState<number | null>(null);
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const [resetNonce, setResetNonce] = useState(0);

  const runToken = useRef(0);

  const analyze = useCallback(
    async (mesh: MeshData, axis: UpAxis, useFlatBase: boolean) => {
      const token = ++runToken.current;
      setBusy(true);
      setStage(null);
      setError(null);

      try {
        const next = await runPipelineInWorker(
          mesh,
          { upAxis: axis, disableFlatBase: !useFlatBase },
          (current) => {
            if (token === runToken.current) setStage(current);
          },
        );
        if (token !== runToken.current) return;
        setResult(next);
        setMode('before');
        setSelectedHole(null);
      } catch (err) {
        if (token !== runToken.current) return;
        setError(err instanceof Error ? err.message : '메시를 처리하지 못했습니다.');
        setResult(null);
      } finally {
        if (token === runToken.current) {
          setBusy(false);
          setStage(null);
        }
      }
    },
    [],
  );

  const handleFile = useCallback(
    async (file: File) => {
      setBusy(true);
      setError(null);
      try {
        const loaded = await loadMeshFromFile(file);
        setSource({
          mesh: loaded.mesh,
          name: loaded.fileName,
          byteSize: loaded.byteSize,
          partCount: loaded.partCount,
          origin: 'file',
        });
        setUpAxis(loaded.suggestedUpAxis);
        await analyze(loaded.mesh, loaded.suggestedUpAxis, flatBase);
      } catch (err) {
        setError(err instanceof Error ? err.message : '파일을 읽지 못했습니다.');
        setBusy(false);
      }
    },
    [analyze, flatBase],
  );

  const handleSample = useCallback(
    async (sample: SampleModel) => {
      const mesh = sample.build();
      setSource({
        mesh,
        name: `${sample.name}.generated`,
        byteSize: mesh.positions.byteLength + mesh.indices.byteLength,
        partCount: 1,
        origin: 'sample',
      });
      setUpAxis(sample.upAxis);
      await analyze(mesh, sample.upAxis, flatBase);
    },
    [analyze, flatBase],
  );

  const reanalyze = useCallback(
    (axis: UpAxis, useFlatBase: boolean) => {
      if (source) void analyze(source.mesh, axis, useFlatBase);
    },
    [analyze, source],
  );

  const viewerInput = useMemo(() => {
    if (!result) return null;
    return {
      before: result.weldedMesh,
      after: result.mesh,
      capTriangleStart: result.capTriangleStart,
      loops: result.holes.map((hole) => hole.loop),
      upAxis,
    };
  }, [result, upAxis]);

  const handleSelectHole = useCallback((hole: HoleReport) => {
    setSelectedHole(hole.id);
    setFocus({
      point: hole.centroid,
      approach: hole.capNormal,
      spread: Math.max(hole.perimeter / 6, 1e-3),
      nonce: Date.now(),
    });
  }, []);

  // 보정 결과를 보여줄 때는 구멍 선택을 풀어 색이 겹치지 않게 한다.
  useEffect(() => {
    if (mode === 'after') setSelectedHole(null);
  }, [mode]);

  const handleReset = useCallback(() => {
    setSource(null);
    setResult(null);
    setError(null);
    setSelectedHole(null);
  }, []);

  if (!source) {
    return <Dropzone onFile={handleFile} onSample={handleSample} error={error} busy={busy} />;
  }

  // 백만 삼각형이 넘어가면 처리에 수 초가 걸리고 뷰어도 무거워진다.
  const heavyMesh = triangleCount(source.mesh) > 1_000_000;

  return (
    <div className="flex-1 flex flex-col lg:flex-row min-h-0">
      <div className="relative flex-1 min-h-[420px] lg:min-h-0 bg-ink-900">
        <Viewer
          input={viewerInput}
          mode={mode}
          wireframe={wireframe}
          focus={focus}
          resetNonce={resetNonce}
        />

        <div className="absolute top-4 left-4 flex items-center gap-2 flex-wrap">
          <SegmentedControl
            options={[
              { id: 'before', label: '보정 전' },
              { id: 'after', label: '보정 후' },
            ]}
            value={mode}
            onChange={setMode}
          />
          <div className="inline-flex rounded-md border border-ink-700 bg-ink-900/80 backdrop-blur p-0.5">
            <button
              type="button"
              onClick={() => setWireframe(!wireframe)}
              className={`px-3 py-1 rounded text-[12px] font-medium transition-colors ${
                wireframe ? 'bg-ink-700 text-ink-100' : 'text-ink-400 hover:text-ink-300'
              }`}
            >
              와이어프레임
            </button>
          </div>
          <Button variant="outline" onClick={() => setResetNonce((n) => n + 1)} className="bg-ink-900/80 backdrop-blur">
            시점 초기화
          </Button>
        </div>

        {mode === 'before' && result && result.holes.length > 0 && (
          <div className="absolute bottom-4 left-4 flex items-center gap-4 rounded-md border border-ink-800 bg-ink-950/85 backdrop-blur px-3 py-2">
            <LegendDot color="#ff4d4f" label="구멍 테두리" />
            <LegendDot color="#9aa4b2" label="기존 표면" />
          </div>
        )}
        {mode === 'after' && result && result.capTriangleStart < result.repaired.triangleCount && (
          <div className="absolute bottom-4 left-4 flex items-center gap-4 rounded-md border border-ink-800 bg-ink-950/85 backdrop-blur px-3 py-2">
            <LegendDot color="#22d3ee" label="새로 만든 면" />
            <LegendDot color="#9aa4b2" label="기존 표면" />
          </div>
        )}

        {busy && (
          <div className="absolute inset-0 flex items-center justify-center bg-ink-950/60 backdrop-blur-sm">
            <div className="text-center">
              <div className="flex items-center justify-center gap-3 text-[13px] text-ink-200">
                <span className="w-3 h-3 rounded-full border-2 border-amber-accent border-t-transparent animate-spin" />
                {stage ? STAGE_LABEL[stage] : '모델을 읽는 중'}
              </div>
              {heavyMesh && (
                <p className="mt-2.5 text-[11.5px] text-ink-400 max-w-[280px]">
                  삼각형이 {triangleCount(source.mesh).toLocaleString('ko-KR')}개라 몇 초 걸립니다.
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      <aside className="w-full lg:w-[400px] shrink-0 border-l border-ink-800 bg-ink-950 overflow-y-auto lg:h-[calc(100vh-3.5rem)]">
        <header className="px-4 py-3.5 border-b border-ink-800 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] text-ink-100 truncate" title={source.name}>
              {source.name}
            </div>
            <div className="font-mono text-[11px] text-ink-400 mt-0.5">
              {formatBytes(source.byteSize)} · 삼각형 {triangleCount(source.mesh).toLocaleString('ko-KR')}
              {source.partCount > 1 && ` · 서브메시 ${source.partCount}개`}
            </div>
          </div>
          <Button variant="ghost" onClick={handleReset}>
            다른 파일
          </Button>
        </header>

        <section className="px-4 py-3 border-b border-ink-800 flex items-center gap-4 flex-wrap">
          <label className="flex items-center gap-2 text-[12px] text-ink-400">
            위 방향
            <select
              value={upAxis}
              onChange={(e) => {
                const next = e.target.value as UpAxis;
                setUpAxis(next);
                reanalyze(next, flatBase);
              }}
              className="bg-ink-850 border border-ink-700 rounded px-2 py-1 font-mono text-[12px] text-ink-100 outline-none focus:border-ink-600"
            >
              <option value="y">Y-up</option>
              <option value="z">Z-up</option>
              <option value="x">X-up</option>
            </select>
          </label>

          <label className="flex items-center gap-2 text-[12px] text-ink-400 cursor-pointer">
            <input
              type="checkbox"
              checked={flatBase}
              onChange={(e) => {
                setFlatBase(e.target.checked);
                reanalyze(upAxis, e.target.checked);
              }}
              className="accent-amber-accent"
            />
            바닥 받침 생성
          </label>
        </section>

        {error && (
          <div
            role="alert"
            className="mx-4 my-3 rounded-lg border border-flaw/30 bg-flaw/8 px-3 py-2.5 text-[12px] text-flaw"
          >
            {error}
          </div>
        )}

        {result && (
          <>
            <ScoreCard before={result.weldedScore} after={result.repairedScore} />

            <section className="px-4 py-3.5 border-b border-ink-800 flex gap-2">
              <Button
                variant="primary"
                className="flex-1"
                onClick={() =>
                  downloadBlob(
                    toBinarySTL(result.mesh, `MeshCap ${source.name}`),
                    derivedFileName(source.name, 'capped', 'stl'),
                    'model/stl',
                  )
                }
              >
                STL 내려받기
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                onClick={async () =>
                  downloadBlob(
                    await toGLB(result.mesh),
                    derivedFileName(source.name, 'capped', 'glb'),
                    'model/gltf-binary',
                  )
                }
              >
                GLB 내려받기
              </Button>
            </section>

            <HoleList holes={result.holes} selectedId={selectedHole} onSelect={handleSelectHole} />
            <DiagnosticsPanel result={result} />
          </>
        )}
      </aside>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-ink-300">
      <span className="w-2 h-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
