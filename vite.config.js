import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  // Relative asset paths so the build works on GitHub Pages under any repo name.
  base: './',
  server: { port: 5173 },
  build: {
    chunkSizeWarningLimit: 1500,
    // One HTML page per infographic tool; add new tools here.
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        bars: resolve(import.meta.dirname, 'bars.html'),
        votes: resolve(import.meta.dirname, 'votes.html'),
      },
    },
  },
});
