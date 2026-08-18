/**
 * 실제 대용량 모델을 브라우저에서 끝까지 돌려 본다.
 *
 *   node docs/test-large.mjs <파일...>
 *
 * 워커가 메모리로 죽는지, 화면에 결과가 제대로 뜨는지는 node에서 재현되지 않는다.
 * 콘솔 오류와 크래시를 잡아 보고하고 결과 화면을 캡처한다.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = process.env.BASE_URL ?? 'http://localhost:5180';
const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('테스트할 파일을 인자로 넘겨주세요.');
  process.exit(1);
}

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), 'figures');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

const consoleErrors = [];
const pageErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error' || msg.type() === 'warning') {
    consoleErrors.push(`[${msg.type()}] ${msg.text()}`);
  }
});
page.on('pageerror', (err) => pageErrors.push(String(err)));
page.on('crash', () => pageErrors.push('페이지가 크래시했습니다'));

const text = async (selector) => (await page.locator(selector).first().textContent())?.trim() ?? '';

for (const file of files) {
  const name = basename(file);
  console.log(`\n=== ${name} ===`);

  await page.goto(`${base}/#/tool`, { waitUntil: 'networkidle' });
  await page.evaluate(() => window.location.reload());
  await page.waitForLoadState('networkidle');

  const started = Date.now();
  await page.setInputFiles('input[type=file]', file);

  // 로딩 중 표시되는 단계 문구를 모은다.
  const stages = new Set();
  const collector = setInterval(async () => {
    try {
      const overlay = page.locator('text=/중$/').first();
      if (await overlay.isVisible({ timeout: 100 })) stages.add((await overlay.textContent())?.trim());
    } catch {
      /* 오버레이가 사라진 뒤의 경합은 무시한다 */
    }
  }, 120);

  // 점수 카드가 뜨거나 오류 배너가 뜨는 쪽 중 먼저 오는 것을 기다린다.
  let outcome = 'ok';
  try {
    await Promise.race([
      page.locator('section:has-text("출력 적합성")').first().waitFor({ timeout: 180_000 }),
      page.locator('[role=alert]').first().waitFor({ timeout: 180_000 }),
    ]);
  } catch {
    outcome = 'timeout';
  }
  clearInterval(collector);

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`  소요 ${elapsed}초 · 결과 ${outcome}`);
  console.log(`  관찰된 단계: ${[...stages].filter(Boolean).join(' → ') || '없음'}`);

  const errorBanner = page.locator('[role=alert]').first();
  if (await errorBanner.isVisible().catch(() => false)) {
    console.log(`  오류 배너: ${(await errorBanner.textContent())?.trim()}`);
    outcome = 'error';
  }

  const scoreCard = page.locator('section:has-text("출력 적합성")').first();
  if (await scoreCard.isVisible().catch(() => false)) {
    const body = (await scoreCard.textContent()) ?? '';
    console.log(`  점수 영역: ${body.replace(/\s+/g, ' ').slice(0, 220)}`);
  }

  const holes = page.locator('section:has-text("구멍 목록")').first();
  if (await holes.isVisible().catch(() => false)) {
    const body = (await holes.textContent()) ?? '';
    console.log(`  구멍 목록: ${body.replace(/\s+/g, ' ').slice(0, 260)}`);
  }

  const diagnostics = page.locator('section:has-text("위상 진단")').first();
  if (await diagnostics.isVisible().catch(() => false)) {
    const body = (await diagnostics.textContent()) ?? '';
    console.log(`  위상 진단: ${body.replace(/\s+/g, ' ').slice(0, 320)}`);
  }

  await page.waitForTimeout(2500);
  const stem = name.replace(/\.[^.]+$/, '');
  await page.screenshot({ path: resolve(outDir, `real-${stem}-before.png`) });

  const afterButton = page.getByRole('button', { name: '보정 후', exact: true });
  if (await afterButton.isVisible().catch(() => false)) {
    await afterButton.click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: resolve(outDir, `real-${stem}-after.png`) });
  }

  console.log(`  캡처 저장: real-${stem}-{before,after}.png`);
}

console.log('\n=== 콘솔 ===');
console.log(consoleErrors.length ? consoleErrors.join('\n') : '오류·경고 없음');
console.log('=== 페이지 예외 ===');
console.log(pageErrors.length ? pageErrors.join('\n') : '없음');

await browser.close();
