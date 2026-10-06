import { defineConfig } from 'vite';

// The service worker is built on its own, as one module at the root of the site, so its
// scope covers /api and it shares no chunk with the page.
export default defineConfig({
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
        // PGlite fetches its extensions as .tar.gz and gunzips them itself. Some servers send
        // a .gz file with Content-Encoding: gzip, the browser then inflates it first and PGlite
        // fails silently. As .tgz it travels untouched.
        assetFileNames: ({ names }) =>
          names.some((name) => name.endsWith('.tar.gz'))
            ? 'assets/[name]-[hash].tgz'
            : 'assets/[name]-[hash][extname]',
      },
    },
  },
});
