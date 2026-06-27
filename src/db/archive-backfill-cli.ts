import { getDb } from './index.js';
import { config } from './../config.js';
import { runSnapshotJob } from '../capture/url-snapshot.js';
import { backfillSnapshots } from './archive-backfill.js';
import { isServerListening } from '../server-lock.js';

// Story 16.3 — operator-invokable backfill runner (`npm run archive:backfill`). NOT a
// skill (the v1 skill list is fixed, Story 8.3) — a maintenance CLI like import:flat.
//
// It enqueues a snapshot for every eligible (archive-on-promote board) item that lacks
// one, SERIALLY on the single concurrency-1 worker. Throughput is intentionally slow:
// one Chrome at a time (NFR-1). Idempotent by item id — safe to re-run / resume.
//
// ⚠ STOP THE SERVER FIRST. The concurrency-1 guarantee is PER-PROCESS — this CLI has its
// own worker + its own Chrome. Running it while the live server is also capturing would
// put two Chromiums on the box at once (the OOM NFR-1 exists to prevent). This is now
// GUARDED: if the server's port is up the CLI refuses to start (override with
// BOARD_ALLOW_CONCURRENT_CHROME=1 if you understand the risk).

if (process.env.BOARD_ALLOW_CONCURRENT_CHROME !== '1' && (await isServerListening(config.host, config.port))) {
  console.error(
    `[archive:backfill] refusing to run: a server appears to be listening on ` +
      `${config.host}:${config.port}. Concurrency-1 is per-process — a second Chrome ` +
      `risks the OOM NFR-1 guards against.\n` +
      `Stop the board server first, or set BOARD_ALLOW_CONCURRENT_CHROME=1 to override.`,
  );
  process.exit(1);
}

const handle = getDb();

// Collect the in-process snapshot-job promises so the standalone CLI can AWAIT the queue
// draining before it exits (the jobs serialize on the one worker; closing the DB early
// would abort pending captures).
const pending: Array<Promise<unknown>> = [];
const result = backfillSnapshots(handle, {
  snapshotsDir: config.snapshotsDir,
  enqueueSnapshot: (a) => {
    if (a.url) pending.push(runSnapshotJob(handle, { itemId: a.itemId, url: a.url, snapshotsDir: config.snapshotsDir }));
  },
});

console.log(
  `[archive:backfill] enqueued ${result.enqueued.length} snapshot job(s) ` +
    `(skipped ${result.skippedSnapshotted.length} already-archived, ` +
    `${result.skippedNoSource.length} without a source URL, ` +
    `${result.skippedIneligible} on non-archival boards). ` +
    `Draining serially through the single Chrome — this can take a while…\n` +
    `(Run this only while the server is stopped — see the header note on NFR-1.)`,
);

await Promise.allSettled(pending); // runSnapshotJob resolves (never rejects); graceful per-item
console.log('[archive:backfill] done.');
handle.sqlite.close();
