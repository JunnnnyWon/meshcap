import type { PipelineOptions, PipelineResult } from '../core/pipeline.ts';
import type { MeshData } from '../core/types.ts';
import type { CapWorkerRequest, CapWorkerResponse } from './capWorker.ts';

let worker: Worker | null = null;
let nextId = 1;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./capWorker.ts', import.meta.url), { type: 'module' });
  }
  return worker;
}

/**
 * 파이프라인을 워커에서 실행한다.
 *
 * 수십만 삼각형짜리 메시에서는 위상 분석과 삼각화가 몇 초씩 걸린다. 메인
 * 스레드에서 돌리면 그동안 뷰어가 완전히 멈춰 사용자가 브라우저가 죽은 줄 안다.
 */
export function runPipelineInWorker(mesh: MeshData, options: PipelineOptions): Promise<PipelineResult> {
  const id = nextId++;
  const instance = getWorker();

  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent<CapWorkerResponse>) => {
      if (event.data.id !== id) return;
      cleanup();
      if (event.data.ok) resolve(event.data.result);
      else reject(new Error(event.data.error));
    };

    const onError = (event: ErrorEvent) => {
      cleanup();
      reject(new Error(event.message || '메시 처리 중 오류가 발생했습니다.'));
    };

    const cleanup = () => {
      instance.removeEventListener('message', onMessage);
      instance.removeEventListener('error', onError);
    };

    instance.addEventListener('message', onMessage);
    instance.addEventListener('error', onError);

    const request: CapWorkerRequest = { id, mesh, options };
    instance.postMessage(request);
  });
}

export function terminateWorker(): void {
  worker?.terminate();
  worker = null;
}
