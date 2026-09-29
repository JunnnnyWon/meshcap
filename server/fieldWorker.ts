/**
 * 연산 서버의 보조 스레드. 와인딩 넘버 격자의 z층 묶음을 계산한다.
 * 브라우저 보조 워커와 같은 처리기를 쓴다.
 */
import { parentPort } from 'node:worker_threads';
import { createFieldTaskHandler, type FieldMessage } from '../src/core/solid/parallel.ts';

const port = parentPort;
if (!port) throw new Error('보조 스레드로만 실행합니다.');
const handle = createFieldTaskHandler();

port.on('message', (message: FieldMessage) => {
  try {
    const out = handle(message);
    if (out) port.postMessage(out.reply, out.transfer);
  } catch (error) {
    port.postMessage({ kind: 'error', job: message.job, error: error instanceof Error ? error.message : String(error) });
  }
});
