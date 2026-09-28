---
name: testing-meshcap
description: How to drive the MeshCap web app (meshcap.junnnny.kr or local Vite) for end-to-end repair tests — engine selection, sample models, where timings live, and API rate limits.
---

# Testing MeshCap end-to-end

## Reaching the tool
- SPA with hash routing; `#/tool` is the default page (also benchmark/method/gallery/about). No login.
- Dropzone shows 4 sample cards. `3D AI 캐릭터 A/B` fetch `/examples/character-{a,b}.stl` (~8.5MB, 169k tris) — clicking a card loads + auto-runs repair with no file dialog. `구멍 난 흉상` / `물결 테두리 튜브` are tiny procedural builds (~1s).
- Upload is only possible from the dropzone; once a model is loaded use `다른 파일` (top of the right sidebar) to reset.

## Engine selection (`계산 위치` segmented control)
- Appears ONLY after a model is loaded, in the right sidebar. Options: `자동` / `브라우저` / `계산 서버`. Default `자동` → browser worker for ≤500k tris.
- Engine choice persists across `다른 파일` reset. To force a big upload straight to the server: load a tiny sample, click `계산 서버`, then `다른 파일`, then pick the real model — otherwise the auto→browser run starts on load and keeps burning CPU in the (single, serial) worker even after you switch.
- Badge next to `계산 위치` after a run: `서버에서 처리됨` / `브라우저에서 처리됨`. A server failure silently falls back to browser with an amber notice `…브라우저에서 대신 처리했습니다` — check for that notice to know a server call failed.

## Timing evidence
- Sidebar bottom `처리 시간` panel (inside `진단`/`DiagnosticsPanel`, scroll the aside to the end) shows the pipeline's own per-stage ms: 점 합치기 / 틈 맞추기 / 구멍 찾기 / 구멍 메우기 (=cap stage) / 면 방향 맞추기 / 점수 매기기 / 전체. This is the authoritative cap-stage duration for both engines.
- For the server request itself (upload+compute+download): `performance.getEntriesByType('resource').filter(r=>r.name.includes('/api/'))` gives XHR duration + transferSize — no need to keep DevTools open during the run.
- Status text during a server run: `서버로 보내는 중 %` → `계산 서버가 처리하는 중` → `결과를 받는 중`. During a browser run it shows stage labels (`구멍을 메우는 중` = cap).

## Production API gotchas
- `GET /api/health` → `{ok, cores, totalMemoryMB, load, maxUploadMB}` — quick liveness check, not rate-limited.
- nginx rate-limits other `/api/` routes: 6 req/min, burst 3, `limit_conn 2` → keep `/api/repair` calls ≤3 per session and spaced.
- Cloudflare edge cuts requests ~100s; uploads >95MB die at the edge. `proxy_read_timeout` on nginx is 600s, so only the edge matters.
- Deployed-frontend sanity: `curl https://meshcap.junnnny.kr/` → asset hash, then grep the JS bundle for new identifiers (e.g. `capBudgetMs`) to confirm the redeploy landed.

## Machine quirks (this box)
- Display is 1600×1200 but the computer tool uses a 1024×768 coordinate space (scale ×1.5625) and browser chrome adds ~87px at top in real px. For small buttons, get `el.getBoundingClientRect()` via `browser_console` and click at `(cssX/1.5625, (cssY+87)/1.5625)` — the sidebar's `다른 파일` ghost button is easy to miss otherwise.
- This VM's CPU is much slower than the prod server (Ryzen 5 5600): the same cap pass can take ~8× longer in the browser worker than on the server.

## Devin Secrets Needed
- None for site testing. `GPU_SERVER_SSH_PASSWORD` (sshpass ssh root@100.89.162.96) only if you need server-side docker logs.
