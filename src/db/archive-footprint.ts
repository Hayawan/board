import { statSync } from 'node:fs';
import { basename, join } from 'node:path';

import { eq } from 'drizzle-orm';

import type { DbHandle } from './index.js';
import { assets } from './schema.js';

// Story 16.3 — READ-ONLY archive footprint. Total disk used by kind='snapshot' assets
// only (their self-contained .html files), so screenshots/other assets are excluded.
//
// Footprint is computed by STAT-on-disk rather than a size column: additive (no
// migration — the asset table has no byte-size column), and it always reflects truth
// even if a snapshot file is hand-deleted. A missing file contributes 0 (never throws).
// This function mutates nothing.

export interface ArchiveFootprint {
  /** Total bytes of all kind='snapshot' files present on disk. */
  totalBytes: number;
  /** Number of snapshot asset rows (regardless of whether the file is still present). */
  count: number;
}

export function archiveFootprint(handle: DbHandle, snapshotsDir: string): ArchiveFootprint {
  const rows = handle.db.select().from(assets).where(eq(assets.kind, 'snapshot')).all();
  let totalBytes = 0;
  for (const a of rows) {
    if (!a.path) continue;
    // Resolve by basename under snapshotsDir (Story 2.2 relative-path contract), as
    // deleteItemWithAssets resolves screenshot files.
    const abs = join(snapshotsDir, basename(a.path));
    try {
      totalBytes += statSync(abs).size;
    } catch {
      /* file hand-deleted / never written → contributes 0 */
    }
  }
  return { totalBytes, count: rows.length };
}
