import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initDb } from './index.js';
import { items } from './schema.js';
import { seed, INSPIRATION_BOARD_ID, LIBRARY_BOARD_ID, INBOX_BOARD_ID } from './seed.js';
import { recordAssignmentChoice, listOverrides } from './suggestion-override.js';

// Story 14.3 — override capture is an ADDITIVE signal store: a row is written only on
// a TRUE override (a suggestion existed and the user chose a different board), never by
// mutating item/board rows.

function db() {
  const dir = mkdtempSync(join(tmpdir(), 'board-oss-override-'));
  const handle = initDb(join(dir, 'o.db'));
  seed(handle.db);
  handle.db.insert(items).values({ id: 'it', boardId: INBOX_BOARD_ID, source: 'https://x' }).run();
  return { dir, handle };
}

describe('Story 14.3 — suggestion override capture (AC4)', () => {
  it('records a row when the chosen board differs from the suggestion', () => {
    const { dir, handle } = db();
    try {
      const r = recordAssignmentChoice(handle, {
        itemId: 'it', suggestedBoardId: INSPIRATION_BOARD_ID, chosenBoardId: LIBRARY_BOARD_ID,
      });
      assert.equal(r.recorded, true);
      const rows = listOverrides(handle);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].itemId, 'it');
      assert.equal(rows[0].suggestedBoardId, INSPIRATION_BOARD_ID);
      assert.equal(rows[0].chosenBoardId, LIBRARY_BOARD_ID);
    } finally {
      handle.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('records nothing when the chosen board equals the suggestion (a confirm, not an override)', () => {
    const { dir, handle } = db();
    try {
      const r = recordAssignmentChoice(handle, {
        itemId: 'it', suggestedBoardId: INSPIRATION_BOARD_ID, chosenBoardId: INSPIRATION_BOARD_ID,
      });
      assert.equal(r.recorded, false);
      assert.equal(listOverrides(handle).length, 0);
    } finally {
      handle.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('records nothing when there was no suggestion (manual pick, not an override)', () => {
    const { dir, handle } = db();
    try {
      const r = recordAssignmentChoice(handle, {
        itemId: 'it', suggestedBoardId: null, chosenBoardId: LIBRARY_BOARD_ID,
      });
      assert.equal(r.recorded, false);
      assert.equal(listOverrides(handle).length, 0);
    } finally {
      handle.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not mutate the item row when recording an override (additive only)', () => {
    const { dir, handle } = db();
    try {
      const before = handle.db.select().from(items).all();
      recordAssignmentChoice(handle, { itemId: 'it', suggestedBoardId: INSPIRATION_BOARD_ID, chosenBoardId: LIBRARY_BOARD_ID });
      assert.deepEqual(handle.db.select().from(items).all(), before, 'item rows untouched by override capture');
    } finally {
      handle.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
