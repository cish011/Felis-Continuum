import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src',
  base: './',
  publicDir: '../public',
  build: {
    outDir: '../dist-web',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    assetsInlineLimit: 4096,
  },
  server: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
  },
});
