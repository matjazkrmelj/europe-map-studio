import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the build works on GitHub Pages under any repo name.
  base: './',
  server: { port: 5173 },
  build: { chunkSizeWarningLimit: 1500 },
});
