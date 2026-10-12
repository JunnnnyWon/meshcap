import type { PipelineOptions } from '../core/pipeline.ts';
import { DEFAULT_WRAP_RESOLUTION } from '../core/cap/voxelWrap.ts';

/**
 * 서버가 실행할 옵션을 정한다.
 *
 * 클라이언트가 보낸 값을 그대로 쓴다. 서버가 값을 덮어쓰면 같은 파일이 어디서
 * 돌았느냐에 따라 결과가 갈린다. 값이 없을 때 채우는 기본값도 브라우저가 쓰는
 * 값과 같아야 한다. 벽시계 상한만 서버 사정(Cloudflare가 오리진 응답을 125초까지만
 * 기다린다)으로 잘라 둔다.
 */
export function serverRunOptions(options: PipelineOptions, capBudgetMs: number): PipelineOptions {
  return {
    ...options,
    wrapResolution: options.wrapResolution ?? DEFAULT_WRAP_RESOLUTION,
    capBudgetMs: Math.min(options.capBudgetMs ?? capBudgetMs, capBudgetMs),
  };
}
