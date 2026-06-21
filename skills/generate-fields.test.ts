import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { eq } from 'drizzle-orm';

import { initDb } from '../db/index.js';
import { boards } from '../db/schema.js';
import { insertBoard, updateBoardDescriptor } from '../db/seed.js';
import { buildCtx, type LLMProvider } from './types.js';
import { enqueueWrite } from '../db/queue.js';
import { generateFieldsSkill } from './generate-fields.js';

const BOARD = {
  id: 'wines',
  name: 'Wines',
  descriptor: {
    ingest_mode: 'manual-upload' as const,
    view: 'grid' as const,
    enrichment_prompt: 'describe the wine',
    fields: [{ key: 'region', label: 'Region', type: 'text' as const, enrichable: true }],
  },
};

describe('generate-fields (Story 10.3)', () => {
  let dir: string;
  let handle: ReturnType<typeof initDb>;
  const mk = (llm: LLMProvider) => buildCtx({ db: handle, queue: { enqueueWrite }, logger: console, llm });
  const descriptorOf = (id: string) => handle.db.select().from(boards).where(eq(boards.id, id)).get()?.descriptor as typeof BOARD.descriptor;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'board-oss-genfields-'));
    handle = initDb(join(dir, 'g.db'));
    insertBoard(handle.db, BOARD);
  });
  after(() => { handle.sqlite.close(); rmSync(dir, { recursive: true, force: true }); });

  // AC1 — proposes valid additional fields; AC3 — descriptor unchanged until accept
  it('proposes valid new fields and does NOT mutate the descriptor', async () => {
    const llm: LLMProvider = { complete: async () => ({ fields: [{ key: 'grape', label: 'Grape', type: 'tags', enrichable: true }] }) as never };
    const out = await generateFieldsSkill.run({ boardId: 'wines', request: 'track the grape variety' }, mk(llm));
    assert.equal(out.status, 'ok');
    assert.deepEqual(out.fields.map((f: { key: string }) => f.key), ['grape']);
    assert.deepEqual(descriptorOf('wines').fields.map((f) => f.key), ['region'], 'board descriptor unchanged until accept');
  });

  // AC3 — accept appends via updateBoardDescriptor (the UPDATE primitive)
  it('accept appends the fields to the descriptor (existing items keep working)', () => {
    const d = descriptorOf('wines');
    updateBoardDescriptor(handle.db, 'wines', { ...d, fields: [...d.fields, { key: 'grape', label: 'Grape', type: 'tags', enrichable: true }] });
    assert.deepEqual(descriptorOf('wines').fields.map((f) => f.key), ['region', 'grape']);
  });

  // AC2 — off-list type is rejected by the 10.2 guardrails (→ draft after one repair)
  it('rejects an off-list field type (10.2 guardrails)', async () => {
    const llm: LLMProvider = { complete: async () => ({ fields: [{ key: 'when', label: 'When', type: 'datetime' }] }) as never };
    const out = await generateFieldsSkill.run({ boardId: 'wines', request: 'add a date' }, mk(llm));
    assert.equal(out.status, 'draft', 'off-list type cannot be accepted');
    assert.ok(out.errors && out.errors.length > 0);
  });

  // AC2 — a key duplicating an EXISTING board field is rejected (existingKeys seam)
  it('rejects a field key that already exists on the board (existingKeys seam)', async () => {
    const llm: LLMProvider = { complete: async () => ({ fields: [{ key: 'region', label: 'Region 2', type: 'text' }] }) as never };
    const out = await generateFieldsSkill.run({ boardId: 'wines', request: 'add region again' }, mk(llm));
    assert.equal(out.status, 'draft');
    assert.ok(out.errors!.some((e: { code: string }) => e.code === 'already-exists-on-board'), 'distinct already-exists error');
  });

  it('throws on an unknown board', async () => {
    const llm: LLMProvider = { complete: async () => ({ fields: [] }) as never };
    await assert.rejects(() => generateFieldsSkill.run({ boardId: 'nope', request: 'x' }, mk(llm)), /unknown board/i);
  });
});
