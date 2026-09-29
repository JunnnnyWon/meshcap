/// <reference lib="webworker" />
import {
  runPipelineAsync,
  type PipelineOptions,
  type PipelineResult,
  type PipelineStage,
} from '../core/pipeline.ts';
import type { MeshData } from '../core/types.ts';
import { createBrowserFieldEvaluator } from './fieldPool.ts';

export interface CapWorkerRequest {
  id: number;
  mesh: MeshData;
  options: PipelineOptions;
}

export type CapWorkerResponse =
  | { id: number; kind: 'progress'; stage: PipelineStage }
  | { id: number; kind: 'done'; result: PipelineResult }
  | { id: number; kind: 'error'; error: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;
// 솔리드화의 와인딩 넘버 격자는 보조 워커 여러 개로 나눠 계산한다. 결과는 한 스레드와 같다.
const evaluateField = createBrowserFieldEvaluator();

// 요청은 받은 순서대로 하나씩 처리한다. 격자 계산을 기다리는 동안 다음 요청이 끼어들면
// 메모리를 두 배로 쓴다.
let chain: Promise<void> = Promise.resolve();
ctx.onmessage = (event: MessageEvent<CapWorkerRequest>) => {
  chain = chain.then(() => handle(event.data));
};

async function handle({ id, mesh, options }: CapWorkerRequest): Promise<void> {
  try {
    const result = await runPipelineAsync(
      mesh,
      options,
      (stage) => {
        ctx.postMessage({ id, kind: 'progress', stage } satisfies CapWorkerResponse);
      },
      evaluateField,
    );

    // 같은 버퍼를 두 번 넘기면 예외가 나므로 걸러낸다.
    const transfer = [
      ...new Set<ArrayBufferLike>([
        result.mesh.positions.buffer,
        result.mesh.indices.buffer,
        result.inputMesh.positions.buffer,
        result.inputMesh.indices.buffer,
        result.beforeDefectEdges.buffer,
        result.afterDefectEdges.buffer,
      ]),
    ] as Transferable[];

    ctx.postMessage({ id, kind: 'done', result } satisfies CapWorkerResponse, transfer);
  } catch (error) {
    ctx.postMessage({
      id,
      kind: 'error',
      error: error instanceof Error ? error.message : String(error),
    } satisfies CapWorkerResponse);
  }
}
