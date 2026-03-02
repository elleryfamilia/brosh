import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  base: './',
  root: 'src/renderer',
  resolve: {
    preserveSymlinks: true,
  },
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'src/renderer/index.html'),
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react/jsx-runtime'],
          'vendor-xterm': [
            '@xterm/xterm', '@xterm/addon-fit', '@xterm/addon-webgl',
            '@xterm/addon-canvas', '@xterm/addon-web-links', '@xterm/addon-image',
            '@xterm/addon-clipboard', '@xterm/addon-search',
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
  },
});
