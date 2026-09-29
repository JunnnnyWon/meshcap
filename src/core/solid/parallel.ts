import { TriangleBVH, type BVHData } from './bvh.ts';
import { computeWindingSlab, type SolidGrid } from './remesh.ts';

/**
 * 와인딩 넘버 격자를 여러 스레드로 나눠 계산한다.
 *
 * 격자점마다 독립이라 z층 묶음으로 잘라 나눠 줘도 값이 한 비트도 달라지지 않는다.
 * 모델은 높이마다 밀도가 달라 층을 똑같이 나누면 한 스레드만 늦게 끝난다. 그래서 작은
 * 묶음을 큐에 넣고, 끝난 스레드가 다음 묶음을 가져가게 한다.
 *
 * 브라우저 Worker와 node worker_threads를 같은 코드로 다루려고 스레드를 FieldWorkerHandle로
 * 감싸 받는다.
 */

export type FieldMessage =
  | { kind: 'init'; job: number; bvh: BVHData; grid: SolidGrid }
  | { kind: 'chunk'; job: number; z0: number; z1: number };

export type FieldReply =
  | { kind: 'chunk'; job: number; z0: number; z1: number; slab: Float32Array }
  | { kind: 'error'; job: number; error: string };

export interface FieldWorkerHandle {
  post(message: FieldMessage, transfer?: ArrayBuffer[]): void;
  onReply(listener: (reply: FieldReply) => void): void;
  onFailure(listener: (error: Error) => void): void;
  terminate(): void;
  /**
   * 작업 중에는 true, 쉬는 동안에는 false로 부른다. node에서 쉬는 스레드가 프로세스를
   * 붙잡아 스크립트가 끝나지 않는 일을 막는다. 브라우저에서는 필요 없다.
   */
  keepAlive?(active: boolean): void;
}

export interface ParallelFieldOptions {
  /** 스레드 수. 1 이하이면 호출한 스레드에서 계산한다. */
  threads: number;
  createWorker: () => FieldWorkerHandle;
  /** 한 묶음에 넣을 z층 수를 정할 때 스레드당 몇 묶음을 목표로 할지. */
  chunksPerThread?: number;
  /** 이 시간 동안 어떤 묶음도 돌아오지 않으면 스레드를 버리고 직접 계산한다. */
  stallMs?: number;
  /**
   * 스레드마다 BVH 복사본을 보내므로, 복사본 합이 이 크기를 넘지 않게 쓰는 스레드 수를 줄인다.
   * 삼백만 삼각형이면 복사본 하나가 300MB에 가깝다.
   */
  copyBudgetBytes?: number;
}

export type ParallelFieldEvaluator = ((request: FieldRequestLike) => Promise<Float32Array>) & {
  /** 스레드를 모두 끝낸다. 다음 호출에서 필요하면 다시 띄운다. */
  close(): void;
};

const DEFAULT_STALL_MS = 30_000;
const DEFAULT_COPY_BUDGET_BYTES = 768 * 1024 * 1024;

function bvhBytes(data: BVHData): number {
  let total = 0;
  for (const value of Object.values(data)) {
    if (ArrayBuffer.isView(value)) total += value.byteLength;
  }
  return total;
}

export interface FieldRequestLike {
  bvh: TriangleBVH;
  grid: SolidGrid;
}

/** 워커 쪽. 받은 메시지를 처리해 답을 돌려준다. 현재 작업의 BVH를 기억한다. */
export function createFieldTaskHandler(): (message: FieldMessage) => { reply: FieldReply; transfer: ArrayBuffer[] } | null {
  let job = -1;
  let bvh: TriangleBVH | null = null;
  let grid: SolidGrid | null = null;
  return (message) => {
    if (message.kind === 'init') {
      job = message.job;
      bvh = TriangleBVH.fromData(message.bvh);
      grid = message.grid;
      return null;
    }
    if (message.job !== job || !bvh || !grid) {
      return { reply: { kind: 'error', job: message.job, error: '작업 정보를 받기 전에 계산을 요청했습니다.' }, transfer: [] };
    }
    const layer = grid.gx * grid.gy;
    const slab = new Float32Array((message.z1 - message.z0) * layer);
    computeWindingSlab(bvh, grid, message.z0, message.z1, slab, 0);
    return {
      reply: { kind: 'chunk', job: message.job, z0: message.z0, z1: message.z1, slab },
      transfer: [slab.buffer as ArrayBuffer],
    };
  };
}

/**
 * 호출할 때마다 같은 스레드 풀로 격자를 계산하는 함수를 만든다. 작업은 하나씩 차례로 한다.
 * 스레드가 죽으면 풀을 버리고 호출한 스레드에서 끝까지 계산한다.
 */
export function createParallelFieldEvaluator(options: ParallelFieldOptions): ParallelFieldEvaluator {
  const threads = Math.max(1, Math.floor(options.threads));
  const chunksPerThread = options.chunksPerThread ?? 6;
  const stallMs = options.stallMs ?? DEFAULT_STALL_MS;
  const copyBudget = options.copyBudgetBytes ?? DEFAULT_COPY_BUDGET_BYTES;
  let pool: FieldWorkerHandle[] | null = null;
  let jobCounter = 0;
  let queue: Promise<unknown> = Promise.resolve();
  // 워커마다 리스너는 한 번만 붙이고, 지금 작업의 처리기로 넘긴다.
  let onReply: (worker: FieldWorkerHandle, reply: FieldReply) => void = () => undefined;
  let onFailure: () => void = () => undefined;

  const local = (request: FieldRequestLike) => {
    const { grid } = request;
    const field = new Float32Array(grid.gx * grid.gy * grid.gz);
    computeWindingSlab(request.bvh, grid, 0, grid.gz, field, 0);
    return field;
  };

  const dropPool = () => {
    if (!pool) return;
    for (const worker of pool) {
      try {
        worker.terminate();
      } catch {
        /* 이미 죽은 워커 */
      }
    }
    pool = null;
  };

  const ensurePool = (): FieldWorkerHandle[] | null => {
    if (threads <= 1) return null;
    if (pool) return pool;
    try {
      pool = Array.from({ length: threads }, () => {
        const worker = options.createWorker();
        worker.onReply((reply) => onReply(worker, reply));
        worker.onFailure(() => onFailure());
        return worker;
      });
    } catch {
      dropPool();
    }
    return pool;
  };

  const run = (request: FieldRequestLike): Promise<Float32Array> => {
    const { grid } = request;
    const data = request.bvh.toData();
    const copies = Math.min(threads, Math.floor(copyBudget / Math.max(1, bvhBytes(data))));
    if (copies < 2 || grid.gz < copies * 2) return Promise.resolve(local(request));
    const pool = ensurePool();
    if (!pool) return Promise.resolve(local(request));
    const workers = pool.slice(0, copies);

    const job = ++jobCounter;
    const layer = grid.gx * grid.gy;
    const field = new Float32Array(layer * grid.gz);
    const step = Math.max(1, Math.ceil(grid.gz / (workers.length * chunksPerThread)));
    const chunks: [number, number][] = [];
    for (let z = 0; z < grid.gz; z += step) chunks.push([z, Math.min(grid.gz, z + step)]);

    return new Promise<Float32Array>((resolve) => {
      let next = 0;
      let done = 0;
      let failed = false;
      let lastProgress = Date.now();
      for (const worker of workers) worker.keepAlive?.(true);

      const settle = () => {
        clearInterval(watchdog);
        for (const worker of workers) worker.keepAlive?.(false);
      };

      const fail = () => {
        if (failed) return;
        failed = true;
        settle();
        dropPool();
        resolve(local(request));
      };

      // 스레드가 오류도 없이 조용히 멈추면 계산이 영영 끝나지 않는다. 진행이 없으면 직접 계산한다.
      const watchdog = setInterval(() => {
        if (Date.now() - lastProgress > stallMs) fail();
      }, Math.min(5_000, stallMs));

      const dispatch = (worker: FieldWorkerHandle) => {
        if (failed || next >= chunks.length) return;
        const [z0, z1] = chunks[next++];
        worker.post({ kind: 'chunk', job, z0, z1 });
      };

      onReply = (worker, reply) => {
        if (failed || reply.job !== job) return;
        if (reply.kind === 'error') {
          fail();
          return;
        }
        field.set(reply.slab, reply.z0 * layer);
        lastProgress = Date.now();
        done++;
        if (done === chunks.length) {
          settle();
          resolve(field);
          return;
        }
        dispatch(worker);
      };
      onFailure = fail;

      try {
        for (const worker of workers) {
          // BVH는 워커마다 복사본을 보낸다. 공유 메모리는 교차 출처 격리가 있어야만 쓸 수 있다.
          worker.post({ kind: 'init', job, bvh: data, grid });
          dispatch(worker);
        }
      } catch {
        fail();
      }
    });
  };

  const evaluate = (request: FieldRequestLike) => {
    const result = queue.then(() => run(request));
    queue = result.catch(() => undefined);
    return result;
  };
  return Object.assign(evaluate, { close: dropPool });
}
