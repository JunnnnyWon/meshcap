/**
 * 합성 대조군 벤치마크를 돌려 src/bench/results.json을 갱신한다.
 *
 *   npm run bench
 *
 * 여기서는 절차적으로 만든 모델만 다룬다. Meshy·Tripo 실제 출력물은 Draco 압축과
 * 텍스처 때문에 node에서 로더를 그대로 쓰기 어렵고, 무엇보다 사용자가 화면에서
 * 보는 것과 같은 경로로 측정해야 숫자가 어긋나지 않는다. 그래서 실제 파일은
 * 웹 벤치마크 페이지의 측정 패널에서 처리하고, 이 스크립트는 언제든 재현 가능한
 * 대조군을 담당한다.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { measureModel } from '../src/bench/measure.ts';
import { SYNTHETIC_BENCH_MODELS } from '../src/bench/syntheticModels.ts';
import type { BenchmarkFile } from '../src/bench/schema.ts';

const here = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(here, '../src/bench/results.json');

const models = SYNTHETIC_BENCH_MODELS.map((entry) => {
  const mesh = entry.build();
  const bytes = mesh.positions.byteLength + mesh.indices.byteLength;

  process.stdout.write(`측정 중: ${entry.label} ... `);
  const result = measureModel(mesh, {
    id: entry.id,
    label: entry.label,
    source: 'synthetic',
    concept: entry.concept,
    fileName: `${entry.id}.generated`,
    fileBytes: bytes,
    upAxis: entry.upAxis,
  });
  process.stdout.write(`${result.variants.meshcap.score}점\n`);
  return result;
});

const output: BenchmarkFile = {
  generatedAt: new Date().toISOString(),
  note: '합성 대조군. 실제 서비스 출력물은 웹 벤치마크 페이지에서 측정해 병합한다.',
  models,
};

writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

console.log(`\n${models.length}개 모델을 측정해 ${outputPath}에 저장했습니다.`);
console.table(
  models.map((m) => ({
    모델: m.label,
    '무처리 점수': m.variants.raw.score,
    '용접만': m.variants.weldOnly.score,
    '순진한 부채꼴': m.variants.naiveFan.score,
    MeshCap: m.variants.meshcap.score,
    // 정렬 전에는 뒤집힌 면의 둘레까지 구멍으로 잡힌다.
    '정렬 전 테두리': m.variants.weldOnly.holes,
    '실제 구멍': Object.values(m.strategyCounts).reduce((sum, n) => sum + n, 0),
  })),
);
