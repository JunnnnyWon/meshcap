import { describe, expect, it } from 'vitest';
import { serverRunOptions } from '../serverOptions.ts';
import { DEFAULT_WRAP_RESOLUTION } from '../../core/cap/voxelWrap.ts';

const SERVER_BUDGET_MS = 40_000;

describe('연산 서버 옵션', () => {
  it('클라이언트가 보낸 랩 해상도를 덮어쓰지 않는다', () => {
    expect(serverRunOptions({ wrapResolution: 200 }, SERVER_BUDGET_MS).wrapResolution).toBe(200);
  });

  it('안 보냈을 때 채우는 기본값이 브라우저 기본값과 같다', () => {
    // 서버가 값을 임의로 채우면 같은 파일이 어디서 돌았느냐에 따라 결과가 갈린다.
    expect(serverRunOptions({}, SERVER_BUDGET_MS).wrapResolution).toBe(DEFAULT_WRAP_RESOLUTION);
  });

  it('나머지 옵션은 손대지 않고 넘긴다', () => {
    const options = serverRunOptions(
      { upAxis: 'z', engine: 'patch', disableFlatBase: true },
      SERVER_BUDGET_MS,
    );

    expect(options.upAxis).toBe('z');
    expect(options.engine).toBe('patch');
    expect(options.disableFlatBase).toBe(true);
  });

  it('벽시계 상한은 서버 값을 넘지 않는다', () => {
    expect(serverRunOptions({}, SERVER_BUDGET_MS).capBudgetMs).toBe(SERVER_BUDGET_MS);
    expect(serverRunOptions({ capBudgetMs: 5_000 }, SERVER_BUDGET_MS).capBudgetMs).toBe(5_000);
    expect(serverRunOptions({ capBudgetMs: 120_000 }, SERVER_BUDGET_MS).capBudgetMs).toBe(SERVER_BUDGET_MS);
  });
});
