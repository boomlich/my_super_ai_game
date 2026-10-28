import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the build works under any sub-path (e.g. GitHub Pages project sites)
  base: './',
  server: {
    host: '0.0.0.0',
    port: 5173,
    open: false
  },
  preview: {
    host: '0.0.0.0',
    port: 4173
  }
});
