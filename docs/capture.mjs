/**
 * 리포트에 넣을 화면을 자동으로 캡처한다.
 *
 *   node docs/capture.mjs [base-url]
 *
 * 개발 서버가 떠 있어야 한다. 캡처본은 docs/figures/에 저장된다.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const base = process.argv[2] ?? 'http://localhost:5180';
const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, 'figures');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 2,
});

const shot = async (name) => {
  const path = resolve(outDir, `${name}.png`);
  await page.screenshot({ path });
  console.log(`저장: ${path}`);
};

/** 3D 뷰어는 첫 프레임 이후에도 카메라가 움직이므로 잠시 기다린다. */
const settle = (ms = 1400) => page.waitForTimeout(ms);

await page.goto(`${base}/#/tool`, { waitUntil: 'networkidle' });
await settle(600);
await shot('01-landing');

await page.getByRole('button', { name: /결함 합성 회전체/ }).click();
await page.waitForSelector('canvas');
await settle(2200);
await shot('02-tool-before');

await page.getByRole('button', { name: '보정 후', exact: true }).click();
await settle(1200);
await shot('03-tool-after');

await page.getByRole('button', { name: '보정 전', exact: true }).click();
await settle(600);
await page.getByRole('button', { name: '와이어프레임' }).click();
await settle(900);
await shot('04-tool-wireframe');
await page.getByRole('button', { name: '와이어프레임' }).click();

await page.getByRole('button', { name: '다른 파일' }).click();
await settle(400);
await page.getByRole('button', { name: /물결 개구부 튜브/ }).click();
await page.waitForSelector('canvas');
await settle(2000);
await shot('05-wavy-before');

await page.getByRole('button', { name: '보정 후', exact: true }).click();
await settle(1200);
await shot('06-wavy-after');

await page.goto(`${base}/#/benchmark`, { waitUntil: 'networkidle' });
await settle(1400);
await shot('07-benchmark');

await page.goto(`${base}/#/method`, { waitUntil: 'networkidle' });
await settle(800);
await shot('08-method');

await browser.close();
console.log('\n캡처 완료');
