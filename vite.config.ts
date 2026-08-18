import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// GitHub Pages는 https://<user>.github.io/meshcap/ 하위에서 서빙되므로 base가 필요하다.
// 로컬 dev/preview에서는 루트로 두어야 자산 경로가 어긋나지 않는다.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/meshcap/' : '/',
  plugins: [react(), tailwindcss()],
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
  },
}));
