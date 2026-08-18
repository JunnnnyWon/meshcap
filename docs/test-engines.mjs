/**
 * 브라우저 연산과 서버 연산이 화면에서 같은 결과를 내는지 확인한다.
 *
 *   node docs/test-engines.mjs <파일>
 */
import { chromium } from 'playwright';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const base = process.env.BASE_URL ?? 'https://junnnnyserver.tail9d6315.ts.net:8443';
const file = process.argv[2];
if (!file) {
  console.error('테스트할 파일을 인자로 넘겨주세요.');
  process.exit(1);
}

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), 'figures');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

const results = {};

await page.goto(`${base}/#/tool`, { waitUntil: 'networkidle' });
await page.setInputFiles('input[type=file]', file);
await page.locator('section:has-text("출력 적합성")').first().waitFor({ timeout: 300_000 });

/** 재분석이 끝나 기대한 연산 위치 배지가 뜰 때까지 기다린다. */
async function waitForEngine(expected, timeout = 300_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const settled = await page.evaluate((label) => {
      const text = document.body.innerText;
      const busy = text.includes('중 ') || /중$/m.test(text.split('\n').find((l) => l.includes('중')) ?? '');
      return text.includes(label) && !document.querySelector('.animate-spin');
    }, expected);
    if (settled) return true;
    await page.waitForTimeout(300);
  }
  return false;
}

for (const [engine, badgeText] of [
  ['브라우저', '브라우저에서 처리됨'],
  ['연산 서버', '서버에서 처리됨'],
]) {
  const started = Date.now();
  await page.getByRole('button', { name: engine, exact: true }).click();
  const ok = await waitForEngine(badgeText);

  const score = (await page.locator('section:has-text("출력 적합성")').first().textContent()) ?? '';
  const holes = (await page.locator('section:has-text("구멍 목록")').first().textContent()) ?? '';

  results[engine] = {
    badge: ok ? badgeText : '(배지 확인 실패)',
    score: score.replace(/\s+/g, ' ').slice(0, 90),
    holes: holes.replace(/\s+/g, ' ').slice(0, 60),
    seconds: ((Date.now() - started) / 1000).toFixed(1),
  };

  await page.waitForTimeout(1200);
  await page.screenshot({
    path: resolve(outDir, `engine-${engine === '브라우저' ? 'browser' : 'server'}.png`),
  });
}

console.log(`\n=== ${basename(file)} ===`);
for (const [engine, value] of Object.entries(results)) {
  console.log(`\n[${engine}] ${value.badge} · ${value.seconds}초`);
  console.log(`  ${value.score}`);
  console.log(`  ${value.holes}`);
}

console.log('\n=== 콘솔 오류 ===');
console.log(errors.length ? errors.join('\n') : '없음');

await browser.close();
