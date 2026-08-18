import type { PipelineOptions, PipelineResult, PipelineStage } from '../core/pipeline.ts';
import { triangleCount, type MeshData } from '../core/types.ts';
import type { CapWorkerRequest, CapWorkerResponse } from './capWorker.ts';

let worker: Worker | null = null;
let nextId = 1;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./capWorker.ts', import.meta.url), { type: 'module' });
  }
  return worker;
}

export function terminateWorker(): void {
  worker?.terminate();
  worker = null;
}

/**
 * 파이프라인을 워커에서 실행한다.
 *
 * 수십만 삼각형짜리 메시에서는 위상 분석과 삼각화가 몇 초씩 걸린다. 메인
 * 스레드에서 돌리면 그동안 뷰어가 완전히 멈춰 사용자가 브라우저가 죽은 줄 안다.
 */
export function runPipelineInWorker(
  mesh: MeshData,
  options: PipelineOptions,
  onStage?: (stage: PipelineStage) => void,
): Promise<PipelineResult> {
  const id = nextId++;
  const instance = getWorker();
  const triangles = triangleCount(mesh);

  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent<CapWorkerResponse>) => {
      const data = event.data;
      if (data.id !== id) return;

      if (data.kind === 'progress') {
        onStage?.(data.stage);
        return;
      }

      cleanup();
      if (data.kind === 'done') resolve(data.result);
      else reject(new Error(data.error));
    };

    /*
     * 워커가 메모리를 다 써서 죽으면 예외가 아니라 error 이벤트로 오고, 메시지가
     * 비어 있는 경우가 많다. 그대로 두면 "알 수 없는 오류"만 보여 사용자가 원인을
     * 짐작할 수 없으므로, 모델 규모를 함께 알려 준다. 죽은 워커는 다음 요청에서도
     * 계속 실패하므로 반드시 버리고 새로 만든다.
     */
    const onError = (event: ErrorEvent) => {
      cleanup();
      terminateWorker();
      reject(
        new Error(
          event.message ||
            `삼각형 ${triangles.toLocaleString('ko-KR')}개를 처리하다 작업이 중단되었습니다. ` +
              '메모리가 부족했을 가능성이 큽니다. 모델을 단순화한 뒤 다시 시도해 주세요.',
        ),
      );
    };

    const onMessageError = () => {
      cleanup();
      terminateWorker();
      reject(new Error('처리 결과를 주고받지 못했습니다. 모델이 너무 큰지 확인해 주세요.'));
    };

    const cleanup = () => {
      instance.removeEventListener('message', onMessage);
      instance.removeEventListener('error', onError);
      instance.removeEventListener('messageerror', onMessageError);
    };

    instance.addEventListener('message', onMessage);
    instance.addEventListener('error', onError);
    instance.addEventListener('messageerror', onMessageError);

    const request: CapWorkerRequest = { id, mesh, options };
    instance.postMessage(request);
  });
}
