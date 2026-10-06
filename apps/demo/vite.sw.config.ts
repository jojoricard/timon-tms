import { defineConfig } from 'vite';

// The service worker is built on its own, as one module at the root of the site, so its
// scope covers /api and it shares no chunk with the page.
export default defineConfig({
  // Lets src/btree-gist.ts import PGlite's extension bundle as a data URL.
  assetsInclude: ['**/*.tar.gz'],
  build: {
    target: 'es2024',
    emptyOutDir: false,
    copyPublicDir: false,
    rolldownOptions: {
      input: 'src/sw.ts',
      output: {
        format: 'es',
        entryFileNames: 'sw.js',
        codeSplitting: false,
      },
    },
  },
});
