import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { eq } from 'drizzle-orm';
import type { ZodType } from 'zod';

import { initDb } from '../db/index.js';
import { items } from '../db/schema.js';
import { seed, INSPIRATION_BOARD_ID } from '../db/seed.js';
import { createCaptureRegistry } from '../capture/adapter.js';
import { disabledLlm, type LLMProvider } from '../skills/types.js';
import type { TimeoutFn } from '../db/queue.js';
import { runCaptureEnrichJob } from './pipeline.js';

// Story 14.1 — the cheap-vs-earned enrichment tier. The pipeline seam itself
// (`runCaptureEnrichJob`'s `tier` param, default 'earned') was delivered in 13.1;
// this file is the formal tier CONTRACT that 14.2 (assign → earned) depends on:
// cheap never calls the LLM, earned enriches against the item's CURRENT board
// descriptor, existing rows are never re-enriched, and no-LLM degrades to `done`.

const neverFires: TimeoutFn = () => () => {};

/** A fake provider that records prompts + counts complete() calls. */
function spyProvider() {
  const prompts: string[] = [];
  const llm: LLMProvider = {
    complete: async <T>(prompt: string, _schema: ZodType<T>) => {
      prompts.push(prompt);
      return {} as T;
    },
  };
  return { llm, prompts, calls: () => prompts.length };
}

function fakeAdapterRegistry(title = 'Cheap Title') {
  const reg = createCaptureRegistry();
  reg.register({ ingestMode: 'url-screenshot', fetch: async () => ({ fields: { title }, assets: [] }) });
  return reg;
}

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), 'board-oss-tier-'));
  const handle = initDb(join(dir, 't.db'));
  seed(handle.db);
  return { dir, handle };
}

describe('Story 14.1 — cheap tier makes zero LLM calls (AC1/AC2)', () => {
  // Load-bearing: run cheap on a board that HAS enrichable fields (Inspiration), so the
  // 0-call assertion is driven by the tier flag, not by the fields:[] early-return that
  // confounds an Inbox-board test. Fails iff the pipeline's cheap-skip is removed.
  it('runs capture, skips the AI takeaway even on a board WITH fields, reaches done', async () => {
    const { dir, handle } = freshDb();
    try {
      handle.db.insert(items).values({ id: 'cheap-it', boardId: INSPIRATION_BOARD_ID, source: 'https://x' }).run();
      const spy = spyProvider();
      await runCaptureEnrichJob(handle, {
        itemId: 'cheap-it', boardId: INSPIRATION_BOARD_ID, source: 'https://x',
        ingestMode: 'url-screenshot', registry: fakeAdapterRegistry(), llm: spy.llm, tier: 'cheap', timeoutFn: neverFires,
      });
      assert.equal(spy.calls(), 0, 'cheap tier must never call the LLM (even when the board has fields)');
      assert.equal(handle.db.select().from(items).where(eq(items.id, 'cheap-it')).get()?.status, 'done');
    } finally {
      handle.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Story 14.1 — earned tier enriches against the target board descriptor (AC3)', () => {
  it('calls the LLM once with a prompt derived from the item\'s current board', async () => {
    const { dir, handle } = freshDb();
    try {
      handle.db.insert(items).values({ id: 'earned-it', boardId: INSPIRATION_BOARD_ID, source: 'https://x' }).run();
      const spy = spyProvider();
      await runCaptureEnrichJob(handle, {
        itemId: 'earned-it', boardId: INSPIRATION_BOARD_ID, source: 'https://x',
        ingestMode: 'url-screenshot', registry: fakeAdapterRegistry(), llm: spy.llm, tier: 'earned', timeoutFn: neverFires,
      });
      assert.equal(spy.calls(), 1, 'earned tier calls the LLM exactly once');
      // the prompt is built from the item's board descriptor (Inspiration's prompt
      // signature) — this is the contract 14.2 relies on: enrich against the TARGET board.
      assert.match(spy.prompts[0], /design inspiration/i, 'earned prompt reflects the target board descriptor');
    } finally {
      handle.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('earned is the DEFAULT tier (omitting tier preserves existing behavior)', async () => {
    const { dir, handle } = freshDb();
    try {
      handle.db.insert(items).values({ id: 'default-it', boardId: INSPIRATION_BOARD_ID, source: 'https://x' }).run();
      const spy = spyProvider();
      await runCaptureEnrichJob(handle, {
        itemId: 'default-it', boardId: INSPIRATION_BOARD_ID, source: 'https://x',
        ingestMode: 'url-screenshot', registry: fakeAdapterRegistry(), llm: spy.llm, timeoutFn: neverFires, // no tier
      });
      assert.equal(spy.calls(), 1, 'omitted tier defaults to earned (NFR-BC for existing callers)');
    } finally {
      handle.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Story 14.1 — existing enriched items are never re-enriched (AC4, NFR-BC)', () => {
  // Load-bearing: enrichment is SINGLE-ITEM scoped. Running the earned tier for one
  // Inspiration item must NOT re-touch a SIBLING already-enriched item on the same
  // board. A naive "re-enrich the whole board" regression would mutate the sibling and
  // fail this; an additive single-item impl leaves it byte-for-byte.
  it('an earned enrichment of one item does not re-enrich a sibling enriched item on the same board', async () => {
    const { dir, handle } = freshDb();
    try {
      // a pre-wave enriched sibling: status done, populated fields, known timestamps
      handle.db.insert(items).values({
        id: 'enriched-sibling', boardId: INSPIRATION_BOARD_ID, source: 'https://old', title: 'Old Title',
        status: 'done', fields: { 'meta.form': 'saas', 'design.steal_this': 'the hero' },
        createdAt: 1000, updatedAt: 1000,
      }).run();
      const before = handle.db.select().from(items).where(eq(items.id, 'enriched-sibling')).get();

      // run the EARNED tier on a DIFFERENT item on the SAME board (a provider that would
      // overwrite fields if it were ever called on the sibling)
      handle.db.insert(items).values({ id: 'target', boardId: INSPIRATION_BOARD_ID, source: 'https://new' }).run();
      const overwriting: LLMProvider = {
        complete: async <T>() => ({ 'meta.form': 'OVERWRITTEN', 'design.steal_this': 'OVERWRITTEN' }) as T,
      };
      await runCaptureEnrichJob(handle, {
        itemId: 'target', boardId: INSPIRATION_BOARD_ID, source: 'https://new',
        ingestMode: 'url-screenshot', registry: fakeAdapterRegistry(), llm: overwriting, tier: 'earned', timeoutFn: neverFires,
      });

      const after = handle.db.select().from(items).where(eq(items.id, 'enriched-sibling')).get();
      assert.deepEqual(after, before, 'the sibling enriched item must be byte-for-byte unchanged (single-item scope)');
    } finally {
      handle.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Story 14.1 — earned tier degrades gracefully with no LLM (AC5)', () => {
  it('disabledLlm in the earned tier resolves the item to done, not error', async () => {
    const { dir, handle } = freshDb();
    try {
      handle.db.insert(items).values({ id: 'nollm-it', boardId: INSPIRATION_BOARD_ID, source: 'https://x' }).run();
      await runCaptureEnrichJob(handle, {
        itemId: 'nollm-it', boardId: INSPIRATION_BOARD_ID, source: 'https://x',
        ingestMode: 'url-screenshot', registry: fakeAdapterRegistry(), llm: disabledLlm, tier: 'earned', timeoutFn: neverFires,
      });
      assert.equal(
        handle.db.select().from(items).where(eq(items.id, 'nollm-it')).get()?.status,
        'done',
        'no-LLM earned tier is a dignified done, never an error wall',
      );
    } finally {
      handle.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
