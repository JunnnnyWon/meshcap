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
  const response = await fetch(`${BASE}/api/repair`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: payload,
  });
  if (!response.ok) throw new Error(`서버 ${response.status}: ${await response.text()}`);
  const remote = decodeRepairResponse(await response.arrayBuffer());
  const remoteMs = Date.now() - remoteStart;

  const same =
    local.repairedScore.total === remote.repairedScore.total &&
    local.repaired.watertight === remote.repaired.watertight &&
    local.repaired.triangleCount === remote.repaired.triangleCount &&
    local.holes.length === remote.holes.length &&
    local.mesh.positions.length === remote.mesh.positions.length &&
    local.mesh.indices.length === remote.mesh.indices.length;

  // 좌표까지 바이트 단위로 같은지 표본으로 확인한다.
  let identical = same;
  if (identical) {
    const step = Math.max(1, Math.floor(local.mesh.positions.length / 5000));
    for (let i = 0; i < local.mesh.positions.length; i += step) {
      if (local.mesh.positions[i] !== remote.mesh.positions[i]) {
        identical = false;
        break;
      }
    }
  }

  console.log(
    `${identical ? '일치' : '불일치'}  ${label.padEnd(22)} ` +
      `점수 ${remote.weldedScore.total}→${remote.repairedScore.total} · ` +
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
