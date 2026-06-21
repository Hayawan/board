import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { eq } from 'drizzle-orm';

import { initDb } from '../db/index.js';
import { boards } from '../db/schema.js';
import { BoardDescriptorSchema } from '../descriptor/types.js';
import { buildCtx, type LLMProvider } from './types.js';
import { enqueueWrite } from '../db/queue.js';
import { composeBoardSkill } from './compose-board.js';
import { createBoardSkill } from './create-board.js';

// A canned, meta-schema-valid proposal (name + descriptor). The mock returns this;
// the unit test asserts validity + persist-only-on-accept, NOT stance (AC4 is manual).
const CANNED = {
  name: 'Wines',
  ingest_mode: 'manual-upload',
  view: 'grid',
  enrichment_prompt: 'Describe the wine: region, grape, tasting notes.',
  fields: [
    { key: 'region', label: 'Region', type: 'text', enrichable: true },
    { key: 'grape', label: 'Grape', type: 'tags', enrichable: true },
    // NOT 'notes' — that's a reserved system column (Story 10.2). User field is distinct.
    { key: 'tasting_notes', label: 'Tasting notes', type: 'text', enrichable: false },
  ],
};

describe('compose-board (Story 10.1)', () => {
  let dir: string;
  let handle: ReturnType<typeof initDb>;
  const llm: LLMProvider = { complete: async () => CANNED as never };
  const ctx = () => buildCtx({ db: handle, queue: { enqueueWrite }, logger: console, llm });

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'board-oss-compose-'));
    handle = initDb(join(dir, 'c.db'));
  });
  after(() => { handle.sqlite.close(); rmSync(dir, { recursive: true, force: true }); });

  // AC1/AC5 — emits a meta-schema-valid descriptor; AC2 — persists NOTHING
  it('proposes a valid descriptor and writes nothing', async () => {
    const before = handle.db.select().from(boards).all().length;
    const out = await composeBoardSkill.run({ description: 'wines I have tasted' }, ctx());
    assert.equal(out.name, 'Wines');
    assert.ok(BoardDescriptorSchema.safeParse(out.descriptor).success, 'descriptor is meta-schema valid');
    assert.equal(handle.db.select().from(boards).all().length, before, 'NOTHING persisted before accept');
  });

  // AC3 — accept → create-board (reused) persists; the board enriches against it
  it('accept creates the board via create-board (reuse, not fork)', async () => {
    const out = await composeBoardSkill.run({ description: 'wines I have tasted' }, ctx());
    const { boardId } = await createBoardSkill.run({ id: 'wines', name: out.name, descriptor: out.descriptor }, ctx());
    assert.equal(boardId, 'wines');
    const row = handle.db.select().from(boards).where(eq(boards.id, 'wines')).get();
    assert.ok(row, 'board row created on accept');
    assert.equal((row?.descriptor as { ingest_mode: string }).ingest_mode, 'manual-upload');
  });

  // Story 10.2 review NIT — a provider throw (no-AI mode) surfaces an editable draft, not a 500
  it('returns an editable draft (no throw) when the provider errors', async () => {
    const throwingLlm: LLMProvider = { complete: async () => { throw new Error('no provider configured'); } };
    const dctx = buildCtx({ db: handle, queue: { enqueueWrite }, logger: console, llm: throwingLlm });
    const out = await composeBoardSkill.run({ description: 'wines' }, dctx);
    assert.equal(out.status, 'draft');
    assert.ok(Array.isArray((out.descriptor as { fields: unknown[] }).fields), 'a blank editable descriptor');
    assert.ok(out.errors && out.errors.length > 0);
  });
});
