/// <reference lib="webworker" />
import { createFieldTaskHandler, type FieldMessage } from '../core/solid/parallel.ts';

/**
 * 와인딩 넘버 격자의 z층 묶음을 계산하는 보조 워커. 파이프라인 워커가 여러 개를 띄운다.
 */
const ctx = self as unknown as DedicatedWorkerGlobalScope;
const handle = createFieldTaskHandler();

ctx.onmessage = (event: MessageEvent<FieldMessage>) => {
  try {
    const out = handle(event.data);
    if (out) ctx.postMessage(out.reply, out.transfer);
  } catch (error) {
    ctx.postMessage({
      kind: 'error',
      job: event.data.job,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
