import type { PipelineOptions, PipelineResult } from '../core/pipeline.ts';
import type { MeshData } from '../core/types.ts';

/**
 * 브라우저와 연산 서버가 주고받는 바이너리 형식.
 *
 * 삼백만 삼각형짜리 메시는 좌표와 인덱스만 150메가바이트에 이른다. JSON으로
 * 감싸면 문자열로 부풀고 파싱에만 몇 초가 걸리므로, 수치 배열은 그대로 바이트로
 * 붙이고 나머지 메타데이터만 JSON으로 앞에 둔다.
 *
 * 배치는 [매직 4바이트][JSON 길이 4바이트][JSON][배열들]이다. JSON은 4의 배수로
 * 패딩해 뒤따르는 배열이 4바이트 경계에 놓이게 한다. 그래야 복사 없이 뷰로 읽을 수 있다.
 */
const MAGIC = 0x3150434d; // 'MCP1'
const HEADER_BYTES = 8;

interface BufferSpec {
  name: string;
  type: 'f32' | 'u32';
  length: number;
}

interface Envelope {
  buffers: BufferSpec[];
  [key: string]: unknown;
}

function encode(payload: Record<string, unknown>, arrays: (Float32Array | Uint32Array)[], names: string[]): ArrayBuffer {
  const specs: BufferSpec[] = arrays.map((array, i) => ({
    name: names[i],
    type: array instanceof Float32Array ? 'f32' : 'u32',
    length: array.length,
  }));

  const json = new TextEncoder().encode(JSON.stringify({ ...payload, buffers: specs }));
  const padded = Math.ceil(json.byteLength / 4) * 4;
  const total = HEADER_BYTES + padded + arrays.reduce((sum, a) => sum + a.byteLength, 0);

  const out = new ArrayBuffer(total);
  const view = new DataView(out);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, json.byteLength, true);
  new Uint8Array(out, HEADER_BYTES, json.byteLength).set(json);

  let offset = HEADER_BYTES + padded;
  for (const array of arrays) {
    new Uint8Array(out, offset, array.byteLength).set(
      new Uint8Array(array.buffer, array.byteOffset, array.byteLength),
    );
    offset += array.byteLength;
  }

  return out;
}

function decode(buffer: ArrayBuffer): { envelope: Envelope; arrays: Record<string, Float32Array | Uint32Array> } {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== MAGIC) {
    throw new Error('알 수 없는 응답 형식입니다.');
  }

  const jsonLength = view.getUint32(4, true);
  const json = new TextDecoder().decode(new Uint8Array(buffer, HEADER_BYTES, jsonLength));
  const envelope = JSON.parse(json) as Envelope;

  const padded = Math.ceil(jsonLength / 4) * 4;
  let offset = HEADER_BYTES + padded;
  const arrays: Record<string, Float32Array | Uint32Array> = {};

  for (const spec of envelope.buffers) {
    arrays[spec.name] =
      spec.type === 'f32'
        ? new Float32Array(buffer, offset, spec.length)
        : new Uint32Array(buffer, offset, spec.length);
    offset += spec.length * 4;
  }

  return { envelope, arrays };
}

export function encodeRepairRequest(mesh: MeshData, options: PipelineOptions): ArrayBuffer {
  return encode({ options }, [mesh.positions, mesh.indices], ['positions', 'indices']);
}

export function decodeRepairRequest(buffer: ArrayBuffer): { mesh: MeshData; options: PipelineOptions } {
  const { envelope, arrays } = decode(buffer);
  return {
    mesh: {
      positions: arrays.positions as Float32Array,
      indices: arrays.indices as Uint32Array,
    },
    options: (envelope.options ?? {}) as PipelineOptions,
  };
}

/** 응답에서 수치 배열을 떼어내고 남는 부분. */
type ReportOnly = Omit<PipelineResult, 'mesh' | 'weldedMesh'>;

export function encodeRepairResponse(result: PipelineResult): ArrayBuffer {
  const { mesh, weldedMesh, ...report } = result;
  return encode(
    { report },
    [mesh.positions, mesh.indices, weldedMesh.positions, weldedMesh.indices],
    ['repairedPositions', 'repairedIndices', 'weldedPositions', 'weldedIndices'],
  );
}

export function decodeRepairResponse(buffer: ArrayBuffer): PipelineResult {
  const { envelope, arrays } = decode(buffer);
  const report = envelope.report as ReportOnly;

  return {
    ...report,
    mesh: {
      positions: arrays.repairedPositions as Float32Array,
      indices: arrays.repairedIndices as Uint32Array,
    },
    weldedMesh: {
      positions: arrays.weldedPositions as Float32Array,
      indices: arrays.weldedIndices as Uint32Array,
    },
  };
}
