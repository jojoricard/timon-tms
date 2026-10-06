import type { Extension } from '@electric-sql/pglite';
// Not in the package's exports, hence the path. `?inline` turns the 22 kB bundle into a data URL.
import bundle from '../node_modules/@electric-sql/pglite/dist/btree_gist.tar.gz?inline';

/**
 * btree_gist, embedded in the service worker. PGlite's own contrib module fetches the bundle
 * from the server and skips decompression when the response carries Content-Encoding: gzip,
 * which some servers add on the fly. A data URL never goes through a server.
 */
export const btree_gist: Extension = {
  name: 'btree_gist',
  setup: async () => ({ bundlePath: new URL(bundle) }),
};
