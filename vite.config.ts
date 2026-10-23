import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 7668, strictPort: true },
  preview: { port: 7668, strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
