/**
 * MeshCap 연산 서버.
 *
 *   node server/index.ts
 *
 * 브라우저에서 하던 것과 완전히 같은 파이프라인을 그대로 실행한다. 코어를
 * three.js에서 떼어 순수 TypeScript로 짜 둔 덕분에 코드를 한 줄도 옮겨 적지
 * 않고 재사용한다. 화면에 보이는 수치와 서버가 내놓는 수치가 어긋날 여지가 없다.
 *
 * 파일 파싱은 브라우저가 맡는다. Draco로 압축된 GLB까지 열려면 three의 로더가
 * 필요한데 그쪽은 브라우저 API에 기대는 부분이 있어, 이미 잘 도는 곳에 남겨 두고
 * 서버는 좌표와 인덱스만 받는다.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { availableParallelism, loadavg, totalmem } from 'node:os';
import { runPipeline } from '../src/core/pipeline.ts';
import { decodeRepairRequest, encodeRepairResponse } from '../src/net/protocol.ts';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';
// 삼각형 삼백만 개면 좌표와 인덱스만 150메가바이트다. 넉넉하게 잡되 무한은 아니다.
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES ?? 512 * 1024 * 1024);

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;

    req.on('data', (chunk: Buffer) => {
      received += chunk.byteLength;
      if (received > MAX_BODY_BYTES) {
        reject(new Error(`요청이 너무 큽니다. 최대 ${Math.round(MAX_BODY_BYTES / 1024 / 1024)}MB까지 받습니다.`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (url.pathname === '/api/health') {
    sendJson(res, 200, {
      ok: true,
      cores: availableParallelism(),
      totalMemoryMB: Math.round(totalmem() / 1024 / 1024),
      load: loadavg()[0],
      maxUploadMB: Math.round(MAX_BODY_BYTES / 1024 / 1024),
    });
    return;
  }

  if (url.pathname !== '/api/repair') {
    sendJson(res, 404, { error: '없는 경로입니다.' });
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'POST만 받습니다.' });
    return;
  }

  const startedAt = Date.now();

  try {
    const body = await readBody(req);
    // Buffer는 큰 풀 위의 뷰일 수 있어 byteOffset을 반영해 잘라내야 한다.
    const buffer = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;

    const { mesh, options } = decodeRepairRequest(buffer);
    const triangles = mesh.indices.length / 3;

    // 브라우저는 96³, 서버는 같은 코어에 랩 해상도만 높인다.
    const result = runPipeline(mesh, {
      ...options,
      wrapResolution: options.wrapResolution ?? 160,
    });
    const payload = encodeRepairResponse(result);

    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': payload.byteLength,
      'cache-control': 'no-store',
    });
    res.end(Buffer.from(payload));

    console.log(
      `repair 삼각형 ${triangles.toLocaleString('ko-KR')} · ` +
        `${result.weldedScore.total}→${result.repairedScore.total}점 · ` +
        `${Date.now() - startedAt}ms · 응답 ${(payload.byteLength / 1024 / 1024).toFixed(1)}MB`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`repair 실패 ${Date.now() - startedAt}ms: ${message}`);
    if (!res.headersSent) sendJson(res, 500, { error: message });
    else res.end();
  }
});

// 큰 업로드가 도중에 끊기지 않도록 기본 타임아웃을 늘린다.
server.requestTimeout = 10 * 60 * 1000;
server.headersTimeout = 60 * 1000;

server.listen(PORT, HOST, () => {
  console.log(`MeshCap 연산 서버 http://${HOST}:${PORT} · 코어 ${availableParallelism()}개`);
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
