import { describe, expect, it } from 'vitest';
import {
  decodeRepairRequest,
  decodeRepairResponse,
  encodeRepairRequest,
  encodeRepairResponse,
} from '../protocol.ts';
import { runPipeline } from '../../core/pipeline.ts';
import { SAMPLES } from '../../samples/index.ts';

const sample = SAMPLES[0];

describe('연산 서버 프로토콜', () => {
  it('요청을 왕복해도 기하가 그대로다', () => {
    const mesh = sample.build();
    const decoded = decodeRepairRequest(encodeRepairRequest(mesh, { upAxis: 'z', disableFlatBase: true }));

    expect(decoded.options.upAxis).toBe('z');
    expect(decoded.options.disableFlatBase).toBe(true);
    expect(decoded.mesh.positions).toEqual(mesh.positions);
    expect(decoded.mesh.indices).toEqual(mesh.indices);
  });

  it('응답을 왕복해도 수치와 메시가 그대로다', () => {
    const result = runPipeline(sample.build(), { upAxis: sample.upAxis });
    const decoded = decodeRepairResponse(encodeRepairResponse(result));

    expect(decoded.repairedScore.total).toBe(result.repairedScore.total);
    expect(decoded.weldedScore.total).toBe(result.weldedScore.total);
    expect(decoded.repaired.watertight).toBe(result.repaired.watertight);
    expect(decoded.holes.length).toBe(result.holes.length);
    expect(decoded.holes[0].appliedStrategy).toBe(result.holes[0].appliedStrategy);
    expect(decoded.mesh.positions).toEqual(result.mesh.positions);
    expect(decoded.mesh.indices).toEqual(result.mesh.indices);
    expect(decoded.weldedMesh.indices).toEqual(result.weldedMesh.indices);
  });

  it('JSON 길이와 무관하게 배열이 4바이트 경계에 놓인다', () => {
    // 뷰로 읽으려면 정렬이 맞아야 한다. 옵션 길이를 바꿔 가며 확인한다.
    for (const suffix of ['', 'a', 'ab', 'abc']) {
      const mesh = sample.build();
      const encoded = encodeRepairRequest(mesh, { upAxis: 'y', forceStrategy: `fan${suffix}` as never });
      const decoded = decodeRepairRequest(encoded);
      expect(decoded.mesh.positions[0]).toBe(mesh.positions[0]);
      expect(decoded.mesh.indices[1]).toBe(mesh.indices[1]);
    }
  });

  it('알 수 없는 형식은 거부한다', () => {
    expect(() => decodeRepairResponse(new ArrayBuffer(64))).toThrow();
  });
});
