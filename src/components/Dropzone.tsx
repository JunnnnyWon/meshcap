import { useCallback, useRef, useState } from 'react';
import { SAMPLES, type SampleModel } from '../samples/index.ts';
import { SUPPORTED_EXTENSIONS } from '../io/loadMesh.ts';

export function Dropzone({
  onFile,
  onSample,
  error,
  busy,
}: {
  onFile: (file: File) => void;
  onSample: (sample: SampleModel) => void;
  error: string | null;
  busy: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setDragging(false);
      const file = event.dataTransfer.files?.[0];
      if (file) onFile(file);
    },
    [onFile],
  );

  return (
    <div className="flex-1 grid-backdrop flex items-center justify-center px-6 py-14">
      <div className="w-full max-w-[880px]">
        <div className="mb-10 max-w-[620px]">
          <div className="label-caps mb-4">3D AI 메시 진단 · 자동 보정</div>
          <h1 className="text-[38px] leading-[1.15] font-semibold tracking-[-0.02em] text-ink-100">
            생성형 3D는 예쁘게 나옵니다.
            <br />
            <span className="text-amber-accent">출력이 안 될 뿐입니다.</span>
          </h1>
          <p className="mt-5 text-[14.5px] leading-relaxed text-ink-300">
            Meshy와 Tripo가 만든 모델은 겨드랑이, 머리카락 사이, 바닥 개구부에 구멍이 남습니다.
            슬라이서는 열린 메시의 안팎을 판정하지 못해 형상을 통째로 잘못 해석합니다. MeshCap은
            구멍을 찾아 크기와 평면성, 방향에 따라 서로 다른 방식으로 메우고, 그 결과가 정말
            출력 가능한 상태인지 점수로 알려줍니다.
          </p>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={`relative rounded-xl border-2 border-dashed px-8 py-14 text-center cursor-pointer transition-colors ${
            dragging
              ? 'border-amber-accent bg-amber-accent/5'
              : 'border-ink-700 hover:border-ink-600 bg-ink-900/40'
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept={SUPPORTED_EXTENSIONS.join(',')}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onFile(file);
              e.target.value = '';
            }}
          />

          <svg
            width="34"
            height="34"
            viewBox="0 0 24 24"
            fill="none"
            className="mx-auto mb-4 text-ink-600"
            aria-hidden="true"
          >
            <path
              d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M3.5 15v3a2.5 2.5 0 0 0 2.5 2.5h12a2.5 2.5 0 0 0 2.5-2.5v-3"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>

          <p className="text-[15px] text-ink-100 font-medium">
            {busy ? '분석 중입니다' : '모델 파일을 여기에 놓으세요'}
          </p>
          <p className="mt-1.5 font-mono text-[11.5px] text-ink-400">
            GLB · GLTF · OBJ · STL · PLY
          </p>
          <p className="mt-4 text-[11.5px] text-ink-600">
            모든 처리는 브라우저 안에서 끝납니다. 파일이 서버로 전송되지 않습니다.
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="mt-4 rounded-lg border border-flaw/30 bg-flaw/8 px-4 py-3 text-[13px] text-flaw"
          >
            {error}
          </div>
        )}

        <div className="mt-10">
          <div className="label-caps mb-3">파일이 없다면 예제로 확인하세요</div>
          <div className="grid sm:grid-cols-2 gap-3">
            {SAMPLES.map((sample) => (
              <button
                key={sample.id}
                type="button"
                onClick={() => onSample(sample)}
                className="text-left rounded-lg border border-ink-800 bg-ink-900/50 px-4 py-3.5 hover:border-ink-600 hover:bg-ink-850 transition-colors group"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[13.5px] font-medium text-ink-100">{sample.name}</span>
                  <span className="text-ink-600 group-hover:text-amber-accent transition-colors">→</span>
                </div>
                <p className="text-[11.5px] leading-relaxed text-ink-400">{sample.description}</p>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
