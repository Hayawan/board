import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';

import { initDb } from './index.js';
import { seed } from './seed.js';
import { items } from './schema.js';
import { writeItem } from './queue.js';
import { resolveView } from './view.js';

// Story 15.1 — read-only cross-board view resolution: filter (dynamic) + order overlay.

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'board-oss-rv-'));
  const handle = initDb(join(dir, 'c.db'));
  seed(handle.db);
  return { dir, handle };
}
// A "view row" shape resolveView consumes (we pass plain objects, not necessarily DB rows).
const view = (filter: any, order?: string[]) => ({ id: 'v', name: 'V', filter, order: order ?? null, captions: null });

describe('resolveView (Story 15.1)', () => {
  // AC2 — dynamic membership: a newly-matching item appears WITHOUT editing the view.
  it('resolves the filter DYNAMICALLY — a new match appears on the next resolve', async () => {
    const { dir, handle } = await setup();
    try {
      await writeItem(handle, { id: 'f1', boardId: 'library', source: 'https://1', title: 'A', favorite: 1 });
      await writeItem(handle, { id: 'f2', boardId: 'inspiration', source: 'https://2', title: 'B', favorite: 1 });
      const v = view({ favorite: true }); // no text query → must NOT route through FTS

      const first = resolveView(handle, v);
      assert.deepEqual(first.map((i) => i.id).sort(), ['f1', 'f2'], 'favorites across BOTH boards (cross-board)');

      // a newly-favorited item — view row untouched
      await writeItem(handle, { id: 'f3', boardId: 'library', source: 'https://3', title: 'C', favorite: 1 });
      const second = resolveView(handle, v);
      assert.equal(second.length, 3, 'the new match auto-appears (a frozen id-list would still be 2)');
      assert.ok(second.some((i) => i.id === 'f3'));
    } finally {
      handle.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // AC2 — FTS query path resolves across boards (board scope relaxed).
  it('resolves a text query across boards via FTS', async () => {
    const { dir, handle } = await setup();
    try {
      await writeItem(handle, { id: 'q1', boardId: 'library', source: 'https://1', title: 'Rust ownership model' });
      await writeItem(handle, { id: 'q2', boardId: 'inspiration', source: 'https://2', title: 'A rust crate registry' });
      await writeItem(handle, { id: 'q3', boardId: 'library', source: 'https://3', title: 'Python asyncio' });
      const out = resolveView(handle, view({ query: 'rust' }));
      assert.deepEqual(out.map((i) => i.id).sort(), ['q1', 'q2'], 'matches across boards, excludes non-matches');
    } finally {
      handle.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // AC3 — the order overlay pins listed ids FIRST (a non-first natural item), rest follow;
  // a pinned id that no longer matches/exists is skipped without error.
  it('applies the order overlay: pinned ids first, missing pins skipped', async () => {
    const { dir, handle } = await setup();
    try {
      // insert in an order where 'z3' is NOT naturally first
      await writeItem(handle, { id: 'z1', boardId: 'library', source: 'https://1', title: 'one', favorite: 1 });
      await writeItem(handle, { id: 'z2', boardId: 'library', source: 'https://2', title: 'two', favorite: 1 });
      await writeItem(handle, { id: 'z3', boardId: 'library', source: 'https://3', title: 'three', favorite: 1 });

      const out = resolveView(handle, view({ favorite: true }, ['z3', 'ghost'])); // pin z3; 'ghost' doesn't exist
      assert.equal(out[0].id, 'z3', 'pinned id sorts first even though it is not naturally first');
      assert.deepEqual(out.map((i) => i.id).sort(), ['z1', 'z2', 'z3'], 'all matches present; missing pin skipped (no error)');
      assert.equal(out.length, 3);
    } finally {
      handle.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // AC4/AC6 — resolution mutates NOTHING; editing a source item reflects in the view.
  it('is read-only and reflects the canonical item (single source of truth)', async () => {
    const { dir, handle } = await setup();
    try {
      await writeItem(handle, { id: 'c1', boardId: 'library', source: 'https://1', title: 'Original', favorite: 1, fields: { summary: 'first' } });
      const before = handle.db.select().from(items).where(eq(items.id, 'c1')).get()!;

      const v = view({ favorite: true });
      const r1 = resolveView(handle, v);
      assert.equal(r1[0].fields && (r1[0].fields as any).summary, 'first');
      // resolve mutated nothing
      const afterResolve = handle.db.select().from(items).where(eq(items.id, 'c1')).get()!;
      assert.deepEqual(afterResolve, before, 'resolveView wrote nothing to the source item');

      // edit the canonical item at its home → the view reflects it (holds no copy)
      await writeItem(handle, { ...before, fields: { summary: 'edited' } });
      const r2 = resolveView(handle, v);
      assert.equal((r2[0].fields as any).summary, 'edited', 'view reflects the edited canonical field');
    } finally {
      handle.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // AC2 — structured predicates: status + boardIds restrict membership.
  it('honors status and boardIds predicates', async () => {
    const { dir, handle } = await setup();
    try {
      await writeItem(handle, { id: 's1', boardId: 'library', source: 'https://1', title: 'a', status: 'done' });
      await writeItem(handle, { id: 's2', boardId: 'library', source: 'https://2', title: 'b', status: 'pending' });
      await writeItem(handle, { id: 's3', boardId: 'inspiration', source: 'https://3', title: 'c', status: 'done' });

      assert.deepEqual(resolveView(handle, view({ status: 'done' })).map((i) => i.id).sort(), ['s1', 's3']);
      assert.deepEqual(resolveView(handle, view({ status: 'done', boardIds: ['library'] })).map((i) => i.id), ['s1']);
    } finally {
      handle.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // AC5 — a view SPANNING two boards with DIFFERENT descriptors: each item renders
  // against its OWN home board's descriptor (the seeded Library vs Inspiration ones), and
  // a per-board column the item lacks is omitted (graceful degrade).
  it('renders a view spanning two descriptors, each item against its home board (degrades gracefully)', async () => {
    const { dir, handle } = await setup();
    const { renderFields } = await import('../descriptor/render-map.js');
    const { boards } = await import('./schema.js');
    try {
      // Library uses `summary`/`author`; Inspiration uses `meta.*`/`design.*` (disjoint).
      await writeItem(handle, { id: 'lib1', boardId: 'library', source: 'https://1', title: 'L', favorite: 1, fields: { summary: 'lib summary' } });
      await writeItem(handle, { id: 'insp1', boardId: 'inspiration', source: 'https://2', title: 'I', favorite: 1, fields: { 'meta.form': 'saas' } });

      const out = resolveView(handle, view({ favorite: true }));
      assert.deepEqual(out.map((i) => i.id).sort(), ['insp1', 'lib1'], 'view spans both boards');

      const descOf = (id: string) => handle.db.select().from(boards).where(eq(boards.id, id)).get()!.descriptor as any;
      const libItem = out.find((i) => i.id === 'lib1')!;
      const inspItem = out.find((i) => i.id === 'insp1')!;

      // each rendered against its HOME descriptor shows its own universal field
      assert.ok(renderFields(descOf('library'), libItem).some((f: any) => f.key === 'summary'), 'library item shows summary under the library descriptor');
      assert.ok(renderFields(descOf('inspiration'), inspItem).some((f: any) => f.key === 'meta.form'), 'inspiration item shows meta.form under the inspiration descriptor');

      // graceful degrade: the library item under the FOREIGN inspiration descriptor omits
      // its summary (the column doesn't exist there) rather than erroring.
      assert.equal(renderFields(descOf('inspiration'), libItem).length, 0, 'cross-descriptor render omits absent per-board columns, no error');
    } finally {
      handle.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Two-path router (the most fragile invariant): a whitespace-only query must take the
  // STRUCTURED path (not FTS MATCH '""', which would match nothing).
  it('routes a whitespace-only query through the structured path (not empty FTS)', async () => {
    const { dir, handle } = await setup();
    try {
      await writeItem(handle, { id: 'w1', boardId: 'library', source: 'https://1', title: 'A', favorite: 1 });
      const out = resolveView(handle, view({ query: '   ', favorite: true }));
      assert.deepEqual(out.map((i) => i.id), ['w1'], 'blank query falls back to structured predicates, not a dead FTS match');
    } finally {
      handle.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
