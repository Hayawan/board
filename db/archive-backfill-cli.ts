import { getDb } from './index.js';
import { config } from './../config.js';
import { runSnapshotJob } from '../capture/url-snapshot.js';
import { backfillSnapshots } from './archive-backfill.js';

// Story 16.3 — operator-invokable backfill runner (`npm run archive:backfill`). NOT a
// skill (the v1 skill list is fixed, Story 8.3) — a maintenance CLI like import:flat.
//
// It enqueues a snapshot for every eligible (archive-on-promote board) item that lacks
// one, SERIALLY on the single concurrency-1 worker. Throughput is intentionally slow:
// one Chrome at a time (NFR-1). Idempotent by item id — safe to re-run / resume.
//
// ⚠ STOP THE SERVER FIRST. The concurrency-1 guarantee is PER-PROCESS — this CLI has its
// own worker + its own Chrome. Running it while the live server is also capturing would
// put two Chromiums on the box at once (the OOM NFR-1 exists to prevent). There is no
// cross-process lock; coordinate by stopping the server (or running during idle).

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
