import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';

import { initDb } from './index.js';
import { seed } from './seed.js';
import { items, assets } from './schema.js';
import { archiveFootprint } from './archive-footprint.js';

// Story 16.3 — read-only archive footprint: total bytes of kind='snapshot' .html files.

describe('archiveFootprint (Story 16.3)', () => {
  function setup() {
    const dir = mkdtempSync(join(tmpdir(), 'board-oss-foot-'));
    const handle = initDb(join(dir, 'c.db'));
    seed(handle.db);
    const snapshotsDir = join(dir, 'snapshots');
    mkdirSync(snapshotsDir, { recursive: true });
    return { dir, handle, snapshotsDir };
  }

  // AC 1/3 — snapshot-only byte total (screenshots excluded), and reading mutates nothing.
  it('sums kind=snapshot files only and mutates nothing', () => {
    const { dir, handle, snapshotsDir } = setup();
    try {
      handle.db.insert(items).values({ id: 'i1', boardId: 'library', source: 'https://a' }).run();
      handle.db.insert(items).values({ id: 'i2', boardId: 'library', source: 'https://b' }).run();
      writeFileSync(join(snapshotsDir, 'i1.html'), 'x'.repeat(100));
      writeFileSync(join(snapshotsDir, 'i2.html'), 'y'.repeat(50));
      handle.db.insert(assets).values({ id: 'i1-snapshot', itemId: 'i1', kind: 'snapshot', path: 'snapshots/i1.html' }).run();
      handle.db.insert(assets).values({ id: 'i2-snapshot', itemId: 'i2', kind: 'snapshot', path: 'snapshots/i2.html' }).run();
      // a screenshot asset must NOT count toward the archive footprint. Write a real file
      // at the basename the footprint WOULD stat (snapshotsDir/i1.png) so the byte total —
      // not just count — would catch a kind-filter regression that wrongly summed it.
      writeFileSync(join(snapshotsDir, 'i1.png'), 'z'.repeat(999));
      handle.db.insert(assets).values({ id: 'i1-shot', itemId: 'i1', kind: 'screenshot', path: 'screenshots/i1.png' }).run();

      const rowsBefore = handle.db.select().from(assets).all().length;
      const filesBefore = readdirSync(snapshotsDir).sort();

      const foot = archiveFootprint(handle, snapshotsDir);
      assert.equal(foot.totalBytes, 150, 'sum of the two snapshot files only (screenshot excluded)');
      assert.equal(foot.count, 2, 'two snapshot assets');

      // read-only: row count + file set unchanged
      assert.equal(handle.db.select().from(assets).all().length, rowsBefore, 'no rows mutated');
      assert.deepEqual(readdirSync(snapshotsDir).sort(), filesBefore, 'no files written');
    } finally {
      handle.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // a missing snapshot file contributes 0 bytes (don't throw) but still counts as a row.
  it('a hand-deleted snapshot file contributes 0 bytes and does not throw', () => {
    const { dir, handle, snapshotsDir } = setup();
    try {
      handle.db.insert(items).values({ id: 'g1', boardId: 'library', source: 'https://a' }).run();
      handle.db.insert(assets).values({ id: 'g1-snapshot', itemId: 'g1', kind: 'snapshot', path: 'snapshots/g1.html' }).run();
      // no file on disk
      const foot = archiveFootprint(handle, snapshotsDir);
      assert.equal(foot.totalBytes, 0);
      assert.equal(foot.count, 1);
    } finally {
      handle.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
