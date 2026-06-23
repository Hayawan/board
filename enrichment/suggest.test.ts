import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { eq } from 'drizzle-orm';
import type { ZodType } from 'zod';

import { initDb } from '../db/index.js';
import { items } from '../db/schema.js';
import { seed, INSPIRATION_BOARD_ID, LIBRARY_BOARD_ID, INBOX_BOARD_ID } from '../db/seed.js';
import { disabledLlm, type LLMProvider } from '../skills/types.js';
import { suggestBoardForItem } from './suggest.js';

// Story 14.3 — suggestBoardForItem is READ-ONLY: it computes a suggested target board
// (descriptor-driven AI) for an Inbox item, or null (→ manual picker). It NEVER writes.

function db() {
  const dir = mkdtempSync(join(tmpdir(), 'board-oss-suggest-'));
  const handle = initDb(join(dir, 's.db'));
  seed(handle.db);
  handle.db.insert(items).values({ id: 'it', boardId: INBOX_BOARD_ID, source: 'https://x', title: 'A research paper on RAG' }).run();
  return { dir, handle };
}

describe('Story 14.3 — suggestBoardForItem (AC2/AC3, read-only)', () => {
  it('returns the AI-picked board when a provider is configured', async () => {
    const { dir, handle } = db();
    try {
      const llm: LLMProvider = { complete: async <T>(_p: string, _s: ZodType<T>) => ({ boardId: LIBRARY_BOARD_ID }) as T };
      const res = await suggestBoardForItem(handle, { itemId: 'it', llm, providerConfigured: true });
      assert.equal(res.suggestedBoardId, LIBRARY_BOARD_ID);
    } finally {
      handle.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null when no provider is configured (→ manual picker)', async () => {
    const { dir, handle } = db();
    try {
      const res = await suggestBoardForItem(handle, { itemId: 'it', llm: disabledLlm, providerConfigured: false });
      assert.equal(res.suggestedBoardId, null);
    } finally {
      handle.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null (not an error) when the AI throws or returns an unknown board', async () => {
    const { dir, handle } = db();
    try {
      const throwing: LLMProvider = { complete: async () => { throw new Error('boom'); } };
      assert.equal((await suggestBoardForItem(handle, { itemId: 'it', llm: throwing, providerConfigured: true })).suggestedBoardId, null);
      const bogus: LLMProvider = { complete: async <T>() => ({ boardId: 'no-such-board' }) as T };
      assert.equal((await suggestBoardForItem(handle, { itemId: 'it', llm: bogus, providerConfigured: true })).suggestedBoardId, null);
    } finally {
      handle.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('never suggests the Inbox itself (only typed target boards)', async () => {
    const { dir, handle } = db();
    try {
      const picksInbox: LLMProvider = { complete: async <T>() => ({ boardId: INBOX_BOARD_ID }) as T };
      const res = await suggestBoardForItem(handle, { itemId: 'it', llm: picksInbox, providerConfigured: true });
      assert.equal(res.suggestedBoardId, null, 'Inbox is not a valid suggestion target');
    } finally {
      handle.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is READ-ONLY — computing a suggestion does not mutate the item', async () => {
    const { dir, handle } = db();
    try {
      const before = handle.db.select().from(items).where(eq(items.id, 'it')).get();
      const llm: LLMProvider = { complete: async <T>() => ({ boardId: INSPIRATION_BOARD_ID }) as T };
      await suggestBoardForItem(handle, { itemId: 'it', llm, providerConfigured: true });
      assert.deepEqual(handle.db.select().from(items).where(eq(items.id, 'it')).get(), before, 'item unchanged by suggestion compute');
    } finally {
      handle.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
