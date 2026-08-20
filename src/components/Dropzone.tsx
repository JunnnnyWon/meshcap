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
          <div className="label-caps mb-4">AI 3D 구멍 메우기</div>
          <h1 className="text-[38px] leading-[1.15] font-semibold tracking-[-0.02em] text-ink-100">
            미리보기에서는 괜찮은데
            <br />
            <span className="text-amber-accent">안쪽과 바닥이 뚫려 있습니다.</span>
          </h1>
          <p className="mt-5 text-[14.5px] leading-relaxed text-ink-300">
            3D AI로 만든 캐릭터를 슬라이서에 넣으면 팔 아래, 머리카락 사이, 바닥이 자주
            뚫려 있습니다. 슬라이서는 면이 어느 쪽을 보는지로 안팎을 가리기 때문에, 뚫린
            곳은 속이 비어 버립니다. 파일을 넣으면 구멍을 나눠 메운 다음, 출력해도 되는지
            100점으로 채점합니다.
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
            {busy ? '분석하는 중' : '파일을 여기 놓거나 클릭해서 고르세요'}
          </p>
          <p className="mt-1.5 font-mono text-[11.5px] text-ink-400">
            GLB · GLTF · OBJ · STL · PLY
          </p>
          <p className="mt-4 text-[11.5px] text-ink-600 max-w-[420px] mx-auto leading-relaxed">
            기본은 이 브라우저에서 처리합니다. 큰 모델은 팀 서버로 보낼 수 있는데, 그때도
            좌표와 인덱스만 가고 원본과 텍스처는 안 나갑니다.
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
          <div className="label-caps mb-3">3D AI 예제</div>
          <p className="text-[12px] leading-relaxed text-ink-500 mb-3">
            원본은 백만 삼각형이 넘어서, 구멍과 실루엣은 두고 면만 줄인 보기용입니다.
          </p>
          <div className="grid sm:grid-cols-2 gap-3">
            {SAMPLES.filter((sample) => sample.url).map((sample) => (
              <SampleCard key={sample.id} sample={sample} onSample={onSample} busy={busy} />
            ))}
          </div>

          <div className="label-caps mt-8 mb-3">파일이 없으면 합성 예제로 보세요</div>
          <div className="grid sm:grid-cols-2 gap-3">
            {SAMPLES.filter((sample) => sample.build).map((sample) => (
              <SampleCard key={sample.id} sample={sample} onSample={onSample} busy={busy} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SampleCard({
  sample,
  onSample,
  busy,
}: {
  sample: SampleModel;
  onSample: (sample: SampleModel) => void;
  busy: boolean;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => onSample(sample)}
      className="text-left rounded-lg border border-ink-800 bg-ink-900/50 px-4 py-3.5 hover:border-ink-600 hover:bg-ink-850 transition-colors group disabled:opacity-50 disabled:pointer-events-none"
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[13.5px] font-medium text-ink-100">{sample.name}</span>
        <span className="text-ink-600 group-hover:text-amber-accent transition-colors">→</span>
      </div>
      <p className="text-[11.5px] leading-relaxed text-ink-400">{sample.description}</p>
    </button>
  );
}
