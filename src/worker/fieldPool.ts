import { createParallelFieldEvaluator, type FieldReply, type FieldWorkerHandle } from '../core/solid/parallel.ts';
import type { FieldEvaluator } from '../core/pipeline.ts';

/** 브라우저에서 쓸 스레드 수. 파이프라인 워커 하나는 남겨 두고, 너무 많이 띄우지 않는다. */
function browserThreads(): number {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
  return Math.max(1, Math.min(8, cores - 1));
}

/**
 * 파이프라인 워커 안에서 보조 워커 여러 개로 격자를 계산하는 함수를 만든다.
 * 워커 안에서 워커를 만들 수 없는 브라우저면 undefined를 돌려주고, 그때는 한 스레드로 계산한다.
 */
export function createBrowserFieldEvaluator(): FieldEvaluator | undefined {
  if (typeof Worker === 'undefined') return undefined;
  const threads = browserThreads();
  if (threads <= 1) return undefined;
  return createParallelFieldEvaluator({
    threads,
    createWorker: (): FieldWorkerHandle => {
      const worker = new Worker(new URL('./fieldWorker.ts', import.meta.url), { type: 'module' });
      return {
        post: (message, transfer) => worker.postMessage(message, transfer ?? []),
        onReply: (listener) => worker.addEventListener('message', (event: MessageEvent<FieldReply>) => listener(event.data)),
        onFailure: (listener) => {
          worker.addEventListener('error', () => listener(new Error('보조 워커가 멈췄습니다.')));
          worker.addEventListener('messageerror', () => listener(new Error('보조 워커와 주고받지 못했습니다.')));
        },
        terminate: () => worker.terminate(),
      };
    },
  });
}
