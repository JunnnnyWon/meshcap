import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dropzone } from '../components/Dropzone.tsx';
import { Viewer, type FocusRequest } from '../components/Viewer.tsx';
import { DiagnosticsPanel } from '../components/DiagnosticsPanel.tsx';
import { ScoreCard } from '../components/ScoreCard.tsx';
import { HoleList } from '../components/HoleList.tsx';
import { Badge, Button, SegmentedControl } from '../components/ui.tsx';
import { loadMeshFromFile } from '../io/loadMesh.ts';
import { derivedFileName, downloadBlob, toBinarySTL, toGLB } from '../io/exportMesh.ts';
import { runPipelineInWorker } from '../worker/client.ts';
import {
  estimatePayloadBytes,
  probeServer,
  repairOnServer,
  uploadLimitBytes,
  type ServerInfo,
} from '../net/remote.ts';
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

export type Engine = 'auto' | 'browser' | 'server';

/** 이 아래로는 어떤 기기에서도 브라우저가 금방 끝낸다. 굳이 내보낼 이유가 없다. */
const BROWSER_COMFORTABLE_TRIANGLES = 500_000;

/** 이 위로는 브라우저 메모리가 위태로워 여유 있는 기기라도 서버로 보낸다. */
const BROWSER_RISKY_TRIANGLES = 4_000_000;

/**
 * 자동 모드에서 어디서 계산할지 정한다.
 *
 * 서버가 무조건 빠른 것이 아니다. 파이프라인은 단일 스레드라 코어 수가 도움이
 * 되지 않고, 실측에서 서버(Ryzen 5 5600)가 최신 노트북보다 오히려 느렸다.
 * 게다가 삼백만 삼각형이면 좌표만 140메가바이트를 실어 보내야 한다.
 *
 * 그래서 서버는 빠르라고 쓰는 것이 아니라, 브라우저가 감당하지 못할 때 쓴다.
 * 기기가 넉넉하면 큰 모델이라도 그냥 브라우저에서 끝내는 편이 빠르다.
 */
function shouldOffload(triangles: number, hasServer: boolean): boolean {
  if (!hasServer) return false;
  if (triangles <= BROWSER_COMFORTABLE_TRIANGLES) return false;
  if (triangles > BROWSER_RISKY_TRIANGLES) return true;

  const navigatorWithMemory = navigator as Navigator & { deviceMemory?: number };
  // deviceMemory는 크롬 계열에서만 오고 8에서 잘린다. 없으면 넉넉한 쪽으로 본다.
  const memoryGB = navigatorWithMemory.deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency || 4;

  return memoryGB < 8 || cores < 8;
}

export function ToolPage() {
  const [source, setSource] = useState<Source | null>(null);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [engine, setEngine] = useState<Engine>('auto');
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);
  const [usedEngine, setUsedEngine] = useState<'browser' | 'server' | null>(null);

  const [upAxis, setUpAxis] = useState<UpAxis>('y');
  const [flatBase, setFlatBase] = useState(true);
  const [mode, setMode] = useState<ViewMode>('before');
  const [wireframe, setWireframe] = useState(false);
  const [selectedHole, setSelectedHole] = useState<number | null>(null);
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const [resetNonce, setResetNonce] = useState(0);

  const runToken = useRef(0);

  // 서버가 붙어 있는지 한 번만 확인한다. 없으면 브라우저 처리만 남는다.
  useEffect(() => {
    void probeServer().then(setServerInfo);
  }, []);

  const analyze = useCallback(
    async (mesh: MeshData, axis: UpAxis, useFlatBase: boolean, preference: Engine, server: ServerInfo | null) => {
      const token = ++runToken.current;
      const options = { upAxis: axis, disableFlatBase: !useFlatBase };
      const triangles = triangleCount(mesh);

      let wantsServer =
        preference === 'server' || (preference === 'auto' && shouldOffload(triangles, server !== null));

      // 보낼 수 없는 크기라면 올리다가 잘리기 전에 미리 접는다.
      const payloadBytes = estimatePayloadBytes(mesh);
      const limitBytes = uploadLimitBytes(server);
      const tooBigToSend = wantsServer && payloadBytes > limitBytes;
      if (tooBigToSend) wantsServer = false;

      setBusy(true);
      setStatus(null);
      setError(null);
      setNotice(null);

      const runLocally = async () => {
        const value = await runPipelineInWorker(mesh, options, (stage: PipelineStage) => {
          if (token === runToken.current) setStatus(STAGE_LABEL[stage]);
        });
        return { value, engine: 'browser' as const };
      };

      try {
        let outcome: { value: PipelineResult; engine: 'browser' | 'server' };

        if (wantsServer && server) {
          try {
            const value = await repairOnServer(mesh, options, (progress) => {
              if (token !== runToken.current) return;
              if (progress.phase === 'upload') {
                setStatus(`서버로 보내는 중 ${Math.round((progress.uploaded ?? 0) * 100)}%`);
              } else if (progress.phase === 'compute') {
                setStatus('연산 서버가 처리하는 중');
              } else {
                setStatus('결과를 받는 중');
              }
            });
            outcome = { value, engine: 'server' };
          } catch (serverError) {
            // 서버가 죽어 있어도 도구는 계속 쓸 수 있어야 한다.
            if (token !== runToken.current) return;
            setNotice(
              `${serverError instanceof Error ? serverError.message : '연산 서버 오류'} 브라우저에서 대신 처리했습니다.`,
            );
            outcome = await runLocally();
          }
        } else {
          if (tooBigToSend) {
            setNotice(
              `보낼 기하가 ${(payloadBytes / 1024 / 1024).toFixed(0)}MB로 전송 한계 ` +
                `${(limitBytes / 1024 / 1024).toFixed(0)}MB를 넘어 브라우저에서 처리했습니다.`,
            );
          } else if (preference === 'server' && !server) {
            setNotice('연산 서버에 연결할 수 없어 브라우저에서 처리했습니다.');
          }
          outcome = await runLocally();
        }

        if (token !== runToken.current) return;
        setResult(outcome.value);
        setUsedEngine(outcome.engine);
        setMode('before');
        setSelectedHole(null);
      } catch (err) {
        if (token !== runToken.current) return;
        setError(err instanceof Error ? err.message : '메시를 처리하지 못했습니다.');
        setResult(null);
        setUsedEngine(null);
      } finally {
        if (token === runToken.current) {
          setBusy(false);
          setStatus(null);
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
        await analyze(loaded.mesh, loaded.suggestedUpAxis, flatBase, engine, serverInfo);
      } catch (err) {
        setError(err instanceof Error ? err.message : '파일을 읽지 못했습니다.');
        setBusy(false);
      }
    },
    [analyze, flatBase, engine, serverInfo],
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
      await analyze(mesh, sample.upAxis, flatBase, engine, serverInfo);
    },
    [analyze, flatBase, engine, serverInfo],
  );

  const reanalyze = useCallback(
    (axis: UpAxis, useFlatBase: boolean, preference: Engine = engine) => {
      if (source) void analyze(source.mesh, axis, useFlatBase, preference, serverInfo);
    },
    [analyze, source, engine, serverInfo],
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
                {status ?? '모델을 읽는 중'}
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

        <section className="px-4 py-3 border-b border-ink-800">
          <div className="flex items-center justify-between gap-3 mb-2">
            <span className="label-caps">연산 위치</span>
            {usedEngine && (
              <Badge tone={usedEngine === 'server' ? 'patch' : 'neutral'}>
                {usedEngine === 'server' ? '서버에서 처리됨' : '브라우저에서 처리됨'}
              </Badge>
            )}
          </div>

          <SegmentedControl
            options={[
              { id: 'auto', label: '자동' },
              { id: 'browser', label: '브라우저' },
              { id: 'server', label: '연산 서버' },
            ]}
            value={engine}
            onChange={(next) => {
              setEngine(next);
              reanalyze(upAxis, flatBase, next);
            }}
          />

          <p className="mt-2 text-[11px] leading-relaxed text-ink-600">
            {engine === 'browser'
              ? '모든 계산이 브라우저 안에서 끝나고 기하가 전송되지 않습니다.'
              : engine === 'server'
                ? '좌표와 인덱스를 팀 서버로 보내 처리합니다. 텍스처와 원본 파일은 보내지 않습니다.'
                : serverInfo
                  ? '큰 모델이면서 이 기기의 메모리나 코어가 빠듯할 때만 서버로 보냅니다. 서버가 더 빠른 것은 아니라서, 여유 있는 기기에서는 그냥 브라우저에서 끝내는 편이 낫습니다.'
                  : '연산 서버에 연결되지 않아 브라우저에서만 처리합니다.'}
          </p>

          {serverInfo && (
            <p className="mt-1 font-mono text-[10.5px] text-ink-700">
              서버 {serverInfo.cores}코어 · 메모리 {(serverInfo.totalMemoryMB / 1024).toFixed(0)}GB · 최대{' '}
              {serverInfo.maxUploadMB}MB
            </p>
          )}
        </section>

        {error && (
          <div
            role="alert"
            className="mx-4 my-3 rounded-lg border border-flaw/30 bg-flaw/8 px-3 py-2.5 text-[12px] text-flaw"
          >
            {error}
          </div>
        )}

        {notice && (
          <div className="mx-4 my-3 rounded-lg border border-amber-accent/30 bg-amber-accent/8 px-3 py-2.5 text-[12px] text-amber-accent">
            {notice}
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
