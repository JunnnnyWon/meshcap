import { describe, expect, it } from 'vitest';
import {
  createFieldTaskHandler,
  createParallelFieldEvaluator,
  type FieldMessage,
  type FieldReply,
  type FieldWorkerHandle,
} from '../solid/parallel.ts';
import { buildSoup, planSolidGrid, TriangleBVH } from '../solid/index.ts';
import { evaluateFieldHere, runPipeline, runPipelineAsync } from '../pipeline.ts';
import { openCube } from '../__fixtures__/shapes.ts';
import type { MeshData } from '../types.ts';

/** 같은 스레드 안에서 메시지를 비동기로 주고받는 가짜 워커. 실제 워커와 같은 처리기를 쓴다. */
function fakeWorker(mode: 'ok' | 'crash' | 'silent' = 'ok'): FieldWorkerHandle {
  const handle = createFieldTaskHandler();
  let reply: (r: FieldReply) => void = () => undefined;
  let failure: (e: Error) => void = () => undefined;
  let chunks = 0;
  return {
    post(message: FieldMessage) {
      setTimeout(() => {
        if (message.kind === 'chunk') chunks++;
        if (mode === 'crash' && chunks === 2) {
          failure(new Error('죽음'));
          return;
        }
        if (mode === 'silent' && message.kind === 'chunk') return;
        // 구조화 복제를 흉내 낸다.
        const out = handle(structuredClone(message));
        if (out) reply(structuredClone(out.reply));
      }, 0);
    },
    onReply(listener) {
      reply = listener;
    },
    onFailure(listener) {
      failure = listener;
    },
    terminate() {},
  };
}

function sphereLike(): MeshData {
  // 위도·경도 구. 격자 z층이 여러 묶음으로 나뉠 만큼 크다.
  const positions: number[] = [];
  const indices: number[] = [];
  const rings = 24;
  const segments = 32;
  for (let r = 0; r <= rings; r++) {
    const phi = (r / rings) * Math.PI;
    for (let s = 0; s < segments; s++) {
      const theta = (s / segments) * Math.PI * 2;
      positions.push(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta));
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      const n = (s + 1) % segments;
      const a = r * segments + s;
      const b = r * segments + n;
      const c = (r + 1) * segments + n;
      const d = (r + 1) * segments + s;
      indices.push(a, c, b, a, d, c);
    }
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

describe('병렬 와인딩 넘버 격자', () => {
  const request = () => {
    const bvh = new TriangleBVH(buildSoup(sphereLike()).soup);
    const grid = planSolidGrid(bvh.coords, bvh.count, { resolution: 40 })!;
    return { bvh, grid };
  };

  it('여러 스레드로 나눠 계산해도 한 스레드와 비트 단위로 같다', async () => {
    const req = request();
    const evaluate = createParallelFieldEvaluator({ threads: 3, createWorker: () => fakeWorker() });
    const parallel = await evaluate(req);
    const single = evaluateFieldHere(req);
    expect(Buffer.from(parallel.buffer).equals(Buffer.from(single.buffer))).toBe(true);
  });

  it('스레드가 죽으면 직접 계산해 같은 값을 돌려준다', async () => {
    const req = request();
    const evaluate = createParallelFieldEvaluator({ threads: 2, createWorker: () => fakeWorker('crash') });
    const field = await evaluate(req);
    expect(Buffer.from(field.buffer).equals(Buffer.from(evaluateFieldHere(req).buffer))).toBe(true);
  });

  it('스레드가 답 없이 멈추면 제한 시간 뒤 직접 계산한다', async () => {
    const req = request();
    const evaluate = createParallelFieldEvaluator({
      threads: 2,
      createWorker: () => fakeWorker('silent'),
      stallMs: 50,
    });
    const field = await evaluate(req);
    expect(Buffer.from(field.buffer).equals(Buffer.from(evaluateFieldHere(req).buffer))).toBe(true);
  });

  it('복사본 예산이 모자라면 스레드를 쓰지 않는다', async () => {
    const req = request();
    let created = 0;
    const evaluate = createParallelFieldEvaluator({
      threads: 4,
      createWorker: () => {
        created++;
        return fakeWorker();
      },
      copyBudgetBytes: 1,
    });
    await evaluate(req);
    expect(created).toBe(0);
  });

  it('비동기 파이프라인은 동기 파이프라인과 같은 결과를 낸다', async () => {
    const evaluate = createParallelFieldEvaluator({ threads: 2, createWorker: () => fakeWorker() });
    const options = { engine: 'solid' as const, solid: { resolution: 40 } };
    const a = await runPipelineAsync(openCube(), options, undefined, evaluate);
    const b = runPipeline(openCube(), options);
    expect(a.repairedScore.total).toBe(b.repairedScore.total);
    expect(Buffer.from(a.mesh.positions.buffer).equals(Buffer.from(b.mesh.positions.buffer))).toBe(true);
    expect(Buffer.from(a.mesh.indices.buffer).equals(Buffer.from(b.mesh.indices.buffer))).toBe(true);
  });
});
