# AGENTS.md

## Cursor Cloud specific instructions

MeshCap is a browser-first 3D mesh hole-filling / print-scoring tool. Standard commands live in `README.md` and `package.json` `scripts` (`dev`, `test`, `typecheck`, `build`, `bench`, `api`, `api:check`). Notes below are only the non-obvious things.

### Node version (important)
- The compute server runs TypeScript directly (`npm run api` = `node server/index.ts`), which needs **Node >= 24** (matches the `node:24-alpine` Dockerfile). The `nvm` default is set to Node 24 and `~/.bashrc` prepends it to `PATH`, so a fresh **login** shell (`bash -l`) gets Node 24.
- Gotcha: `/exec-daemon/node` (v22.14) is early in `PATH` for non-login/raw shells and **cannot** run `.ts` files (`ERR_UNKNOWN_FILE_EXTENSION`). If `node -v` shows v22.14, run inside a login shell or prepend `"$HOME/.nvm/versions/node/$(nvm version default)/bin"` to `PATH`. The Vitest/Vite/typecheck/build tasks work on either Node version; only the `api` compute server needs Node 24.

### Services
- **Web dev server** — `npm run dev` (Vite), serves at `http://localhost:5173`. It binds to `localhost` only, so `curl http://127.0.0.1:5173` fails with connection refused; use `http://localhost:5173`. README mentions 5180 but the actual dev port is Vite's default 5173.
- **Compute API server** — `npm run api`, listens on `:3000`. The dev server proxies `/api` to it (`MESHCAP_API` overrides the target). Health: `GET /api/health`. The app is fully usable in the browser without this server; it is only used for very large meshes or when the "계산 서버" (compute server) engine is selected in the UI. To exercise the server path end-to-end, select "계산 서버" in the tool page, or run `MESHCAP_API=http://127.0.0.1:3000 npm run api:check` (verifies server output byte-matches the in-browser core).

### Misc
- `npm run bench` rewrites `src/bench/results.json` (timing values differ per machine); revert it if you did not intend to commit timing noise.
- The core (`src/core`) is pure TypeScript with no three.js, so the browser worker, the Node bench, and the compute server all run the identical pipeline.
