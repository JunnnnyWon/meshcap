import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Tailscale Serve가 호스트 루트에 붙이므로 하위 경로 접두어가 필요 없다.
export default defineConfig({
  base: '/',
  plugins: [react(), tailwindcss()],
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
  },
  // 개발 중에는 로컬에서 띄운 연산 서버로 넘긴다.
  //   node server/index.ts
  server: {
    proxy: {
      '/api': {
        target: process.env.MESHCAP_API ?? 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
});
