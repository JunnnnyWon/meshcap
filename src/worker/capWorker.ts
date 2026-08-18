/// <reference lib="webworker" />
import { runPipeline, type PipelineOptions, type PipelineResult } from '../core/pipeline.ts';
import type { MeshData } from '../core/types.ts';

export interface CapWorkerRequest {
  id: number;
  mesh: MeshData;
  options: PipelineOptions;
}

export type CapWorkerResponse =
  | { id: number; ok: true; result: PipelineResult }
  | { id: number; ok: false; error: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (event: MessageEvent<CapWorkerRequest>) => {
  const { id, mesh, options } = event.data;

  try {
    const result = runPipeline(mesh, options);

    // 뚜껑을 하나도 안 만들었으면 두 메시가 같은 버퍼를 공유한다.
    // 같은 버퍼를 두 번 넘기면 예외가 나므로 걸러낸다.
    const transfer = [
      ...new Set<ArrayBufferLike>([
        result.mesh.positions.buffer,
        result.mesh.indices.buffer,
        result.weldedMesh.positions.buffer,
        result.weldedMesh.indices.buffer,
      ]),
    ] as Transferable[];

    ctx.postMessage({ id, ok: true, result } satisfies CapWorkerResponse, transfer);
  } catch (error) {
    ctx.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    } satisfies CapWorkerResponse);
  }
};
