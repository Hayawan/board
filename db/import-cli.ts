import { getDb } from './index.js';
import { seed } from './seed.js';
import { importFlatJson } from './importer.js';

// Story 1.5 — one-shot flat-JSON migration runner (`npm run import:flat`).
// Reads the prototype files from the current working directory (repo root) and
// imports them into the SQLite store, seeding the two boards first. Missing files
// are skipped gracefully. The `import-bookmarks` *skill* wrapper is Story 3.3.

const handle = getDb();
seed(handle.db);
await importFlatJson({
  handle,
  inspirationPath: process.env.BOOKMARKS_JSON ?? 'bookmarks.json',
  libraryPath: process.env.LIBRARY_JSON ?? 'library.json',
});
handle.sqlite.close();
