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
});
