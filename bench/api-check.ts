/**
 * 연산 서버가 브라우저와 똑같은 결과를 내는지 확인한다.
 *
 *   npx tsx bench/api-check.ts <파일...>
 *
 * 같은 코어를 쓰므로 수치가 한 자리도 달라서는 안 된다. 프로토콜 인코딩이나
 * 전송 과정에서 배열이 어긋나면 여기서 걸린다.
 */
import { runPipeline } from '../src/core/pipeline.ts';
import { encodeRepairRequest, decodeRepairResponse } from '../src/net/protocol.ts';
import { readBinarySTL } from './readStl.ts';
import { SYNTHETIC_BENCH_MODELS } from '../src/bench/syntheticModels.ts';
import type { MeshData } from '../src/core/types.ts';

const BASE = process.env.MESHCAP_API ?? 'http://127.0.0.1:3111';

async function check(label: string, mesh: MeshData, upAxis: 'y' | 'z') {
  const options = { upAxis };

  const localStart = Date.now();
  const local = runPipeline(mesh, options);
  const localMs = Date.now() - localStart;

  const payload = encodeRepairRequest(mesh, options);
  const remoteStart = Date.now();
  // 로컬 계산이 서버의 keep-alive 시간(5초)보다 길면 재사용한 연결이 끊겨 있을 수 있다. 한 번 더 보낸다.
  const send = () =>
    fetch(`${BASE}/api/repair`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: payload,
    });
  const response = await send().catch(send);
  if (!response.ok) throw new Error(`서버 ${response.status}: ${await response.text()}`);
  const remote = decodeRepairResponse(await response.arrayBuffer());
  const remoteMs = Date.now() - remoteStart;

  const same =
    local.engine === remote.engine &&
    local.inputScore.total === remote.inputScore.total &&
    local.repairedScore.total === remote.repairedScore.total &&
    local.repaired.watertight === remote.repaired.watertight &&
    local.repaired.triangleCount === remote.repaired.triangleCount &&
    local.holes.length === remote.holes.length &&
    local.mesh.positions.length === remote.mesh.positions.length &&
    local.mesh.indices.length === remote.mesh.indices.length;

  // 좌표와 인덱스가 바이트 단위로 모두 같은지 본다.
  let identical = same;
  if (identical) {
    const a = new Uint8Array(local.mesh.positions.buffer, local.mesh.positions.byteOffset, local.mesh.positions.byteLength);
    const b = new Uint8Array(remote.mesh.positions.buffer, remote.mesh.positions.byteOffset, remote.mesh.positions.byteLength);
    const c = new Uint8Array(local.mesh.indices.buffer, local.mesh.indices.byteOffset, local.mesh.indices.byteLength);
    const d = new Uint8Array(remote.mesh.indices.buffer, remote.mesh.indices.byteOffset, remote.mesh.indices.byteLength);
    identical = Buffer.compare(a, b) === 0 && Buffer.compare(c, d) === 0;
  }

  console.log(
    `${identical ? '일치' : '불일치'}  ${label.padEnd(22)} ` +
      `${remote.engine} · 점수 ${remote.inputScore.total}→${remote.repairedScore.total} · ` +
      `구멍 ${remote.holes.length} · 밀폐 ${remote.repaired.watertight ? 'O' : 'X'} · ` +
      `로컬 ${localMs}ms / 서버왕복 ${remoteMs}ms · 전송 ${(payload.byteLength / 1024 / 1024).toFixed(1)}MB`,
  );

  if (!identical) process.exitCode = 1;
}

const health = await fetch(`${BASE}/api/health`).then((r) => r.json());
console.log(`서버 ${BASE} · 코어 ${health.cores} · 메모리 ${Math.round(health.totalMemoryMB / 1024)}GB\n`);

// 공개 도메인에는 연산 요청 레이트리밋이 걸려 있다. 연속 호출하면 429가 나므로
// 요청 사이에 간격을 둔다. 테일넷 주소로 붙을 때는 기다릴 이유가 없다.
const gapMs = Number(process.env.MESHCAP_GAP_MS ?? (BASE.includes('junnnny.kr') ? 11_000 : 0));
const pause = () => new Promise((resolve) => setTimeout(resolve, gapMs));

if (process.env.SKIP_SYNTHETIC !== '1') {
  for (const entry of SYNTHETIC_BENCH_MODELS) {
    await check(entry.label, entry.build(), entry.upAxis as 'y');
    await pause();
  }
}

for (const path of process.argv.slice(2)) {
  await check(path.split('/').pop() ?? path, readBinarySTL(path), 'z');
  await pause();
}
