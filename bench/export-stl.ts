/**
 * 출력 테스트용 STL을 보정 전후로 한 쌍씩 뽑는다.
 *
 *   npm run export:stl
 *
 * 같은 모델의 보정 전 파일과 보정 후 파일을 슬라이서에 각각 넣어 보면, 점수판의
 * 수치가 실제 슬라이싱 결과에서 어떻게 나타나는지 눈으로 대조할 수 있다.
 * 보정 전 파일은 대부분의 슬라이서에서 경고를 띄우거나 내부를 채우지 못한다.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { runPipeline } from '../src/core/pipeline.ts';
import { toBinarySTL } from '../src/io/exportMesh.ts';
import { SYNTHETIC_BENCH_MODELS } from '../src/bench/syntheticModels.ts';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, 'exports');
mkdirSync(outDir, { recursive: true });

const rows: Record<string, string | number>[] = [];

for (const entry of SYNTHETIC_BENCH_MODELS) {
  const mesh = entry.build();
  const result = runPipeline(mesh, { upAxis: entry.upAxis });

  const beforePath = resolve(outDir, `${entry.id}_before.stl`);
  const afterPath = resolve(outDir, `${entry.id}_after.stl`);

  writeFileSync(beforePath, Buffer.from(toBinarySTL(result.weldedMesh, `${entry.id} before`)));
  writeFileSync(afterPath, Buffer.from(toBinarySTL(result.mesh, `${entry.id} after`)));

  rows.push({
    모델: entry.label,
    '보정 전 점수': result.weldedScore.total,
    '보정 후 점수': result.repairedScore.total,
    '보정 전 구멍': result.welded.boundaryLoopCount,
    '보정 후 구멍': result.repaired.boundaryLoopCount,
    '추가 삼각형': result.repaired.triangleCount - result.welded.triangleCount,
  });
}

console.log(`${SYNTHETIC_BENCH_MODELS.length * 2}개 STL을 ${outDir}에 저장했습니다.\n`);
console.table(rows);
