import type { PipelineOptions, PipelineResult } from '../core/pipeline.ts';
import type { MeshData } from '../core/types.ts';
import { decodeRepairResponse, encodeRepairRequest } from './protocol.ts';

export interface ServerInfo {
  cores: number;
  totalMemoryMB: number;
  load: number;
  maxUploadMB: number;
}

/** 연산 서버가 붙어 있는지 확인한다. 없으면 브라우저 처리만 쓴다. */
export async function probeServer(timeoutMs = 2500): Promise<ServerInfo | null> {
  try {
    const response = await fetch('/api/health', {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { ok?: boolean } & ServerInfo;
    return body.ok ? body : null;
  } catch {
    return null;
  }
}

/**
 * Cloudflare 무료 플랜은 요청 본문을 100MB에서 자른다. 측정해 보니 95MB는
 * 통과하고 105MB는 413으로 막혔다. 테일넷 주소로 직접 붙을 때는 이 제한이 없다.
 */
const EDGE_UPLOAD_LIMIT_BYTES = 95 * 1024 * 1024;

/** 이 경로로는 얼마까지 올릴 수 있는지. 초과하면 애초에 보내지 않는다. */
export function uploadLimitBytes(server: ServerInfo | null): number {
  const serverLimit = (server?.maxUploadMB ?? 512) * 1024 * 1024;
  // 테일넷 주소로 열었으면 중간에 자르는 edge가 없다.
  const direct = location.hostname.endsWith('.ts.net') || location.hostname === 'localhost';
  return direct ? serverLimit : Math.min(serverLimit, EDGE_UPLOAD_LIMIT_BYTES);
}

/** 좌표와 인덱스를 바이너리로 실어 보낼 때의 대략적인 크기. */
export function estimatePayloadBytes(mesh: MeshData): number {
  return mesh.positions.byteLength + mesh.indices.byteLength + 512;
}

export interface RemoteProgress {
  /** 업로드 진행률 0~1. 스트림을 지원하지 않는 환경에서는 호출되지 않는다. */
  uploaded?: number;
  phase: 'upload' | 'compute' | 'download';
}

/**
 * 연산 서버에 기하를 보내 파이프라인을 실행한다.
 *
 * 브라우저에서 돌리는 것과 결과가 같아야 하므로 서버도 같은 코어를 쓴다.
 * 업로드 진행률을 보여 주려고 XMLHttpRequest를 쓴다. fetch로는 요청 본문의
 * 진행 상황을 알 수 없는데, 150메가바이트를 올리는 동안 아무 표시가 없으면
 * 멈춘 것처럼 보인다.
 */
export function repairOnServer(
  mesh: MeshData,
  options: PipelineOptions,
  onProgress?: (progress: RemoteProgress) => void,
): Promise<PipelineResult> {
  const payload = encodeRepairRequest(mesh, options);

  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', '/api/repair');
    request.responseType = 'arraybuffer';
    request.timeout = 10 * 60 * 1000;

    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const ratio = event.loaded / event.total;
      onProgress?.({ phase: ratio >= 1 ? 'compute' : 'upload', uploaded: ratio });
    };

    request.upload.onload = () => onProgress?.({ phase: 'compute' });
    request.onprogress = () => onProgress?.({ phase: 'download' });

    request.onload = () => {
      if (request.status === 413) {
        // 중간의 프록시가 자른 경우다. 크기를 미리 재서 걸렀어야 하지만,
        // 한계값이 바뀌어도 도구가 멈추지 않도록 여기서도 받아 준다.
        reject(new Error('중간 경로에서 요청 크기 제한에 걸렸습니다.'));
        return;
      }
      if (request.status !== 200) {
        reject(new Error(describeFailure(request)));
        return;
      }
      try {
        resolve(decodeRepairResponse(request.response as ArrayBuffer));
      } catch (error) {
        reject(new Error(error instanceof Error ? error.message : '서버 응답을 해석하지 못했습니다.'));
      }
    };

    request.onerror = () =>
      reject(new Error('연산 서버에 연결하지 못했습니다. 브라우저 처리로 전환해 주세요.'));
    request.ontimeout = () => reject(new Error('연산 서버 응답이 너무 오래 걸립니다.'));

    request.setRequestHeader('content-type', 'application/octet-stream');
    request.send(payload);
  });
}

function describeFailure(request: XMLHttpRequest): string {
  try {
    const text = new TextDecoder().decode(request.response as ArrayBuffer);
    const body = JSON.parse(text) as { error?: string };
    if (body.error) return body.error;
  } catch {
    /* 본문이 JSON이 아니면 상태 코드로 설명한다 */
  }
  return `연산 서버가 ${request.status} 오류를 반환했습니다.`;
}
