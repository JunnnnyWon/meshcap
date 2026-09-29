import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import {
  createParallelFieldEvaluator,
  type FieldReply,
  type ParallelFieldEvaluator,
} from '../src/core/solid/parallel.ts';

/** 요청을 받는 스레드 하나는 남기고, 나머지로 격자를 나눠 계산한다. */
export function createNodeFieldEvaluator(
  threads = Math.max(1, Math.min(8, availableParallelism() - 1)),
): ParallelFieldEvaluator | undefined {
  if (threads <= 1) return undefined;
  return createParallelFieldEvaluator({
    threads,
    createWorker: () => {
      const worker = new Worker(new URL('./fieldWorker.ts', import.meta.url));
      return {
        // 쉬는 스레드가 프로세스를 붙잡지 않게 한다. 작업 중에는 붙잡아야 결과를 받기 전에
        // 프로세스가 끝나지 않는다. 리스너를 붙이면 다시 ref되므로 매번 명시적으로 부른다.
        keepAlive: (active) => (active ? worker.ref() : worker.unref()),
        post: (message, transfer) => worker.postMessage(message, transfer ?? []),
        onReply: (listener) => worker.on('message', (reply: FieldReply) => listener(reply)),
        onFailure: (listener) => {
          worker.on('error', (error) => listener(error instanceof Error ? error : new Error(String(error))));
          worker.on('exit', (code) => {
            if (code !== 0) listener(new Error(`보조 스레드가 ${code}로 끝났습니다.`));
          });
        },
        terminate: () => void worker.terminate(),
      };
    },
  });
}
