import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { eq } from 'drizzle-orm';

import { initDb } from './index.js';
import { boards, items, assets } from './schema.js';
import { seed, INSPIRATION_BOARD_ID, LIBRARY_BOARD_ID } from './seed.js';
import { writeItem } from './queue.js';
import { importRecords } from './importer.js';
import { exportJson, exportNetscape } from './export.js';

// Story 17.1 — export is READ-ONLY and complete; JSON round-trips through importRecords
// where possible; Netscape HTML is browser/linkding-compatible.

async function seededExportDb() {
  const dir = mkdtempSync(join(tmpdir(), 'board-oss-export-'));
  const handle = initDb(join(dir, 'e.db'));
  seed(handle.db);
  // inspiration item with nested-group fields + a screenshot asset
  await writeItem(
    handle,
    {
      id: 'insp-1', boardId: INSPIRATION_BOARD_ID, source: 'https://a.example', title: 'Site A',
      favorite: 1, notes: 'nice', status: 'done',
      fields: { 'meta.audience': 'b2b', 'meta.tags': ['minimal', 'bold'], 'design.steal_this': 'the hero' },
      createdAt: 1700000000,
    },
    [{ id: 'as-1', itemId: 'insp-1', kind: 'screenshot', path: 'screenshots/insp-1.png', hash: 'abc123', width: 1280, height: 800 }],
  );
  // library item (flat fields)
  await writeItem(handle, {
    id: 'lib-1', boardId: LIBRARY_BOARD_ID, source: 'https://b.example', title: 'Doc B',
    fields: { summary: 'a summary', topics: ['ai', 'rag'], type: 'article' },
    analysisProvider: 'claude', createdAt: 1700000001,
  });
  // a URL-less item (must appear in JSON, be omitted from Netscape)
  await writeItem(handle, { id: 'nourl', boardId: INSPIRATION_BOARD_ID, source: null, title: 'No URL', createdAt: 1700000002 });
  return { dir, handle };
}

describe('Story 17.1 — exportJson (AC1)', () => {
  it('covers every board (with descriptor), item, and asset reference', async () => {
    const { dir, handle } = await seededExportDb();
    try {
      const doc = exportJson(handle);
      // boards incl. descriptor
      const insp = doc.boards.find((b) => b.id === INSPIRATION_BOARD_ID);
      assert.ok(insp && insp.descriptor && insp.view === 'grid');
      assert.ok(doc.boards.some((b) => b.id === LIBRARY_BOARD_ID));
      // per-board record arrays
      const inspRecs = doc.items[INSPIRATION_BOARD_ID];
      const a = inspRecs.find((r) => r.id === 'insp-1') as any;
      assert.equal(a.url, 'https://a.example');
      assert.equal(a.title, 'Site A');
      assert.equal(a.favorite, true);
      assert.equal(a.notes, 'nice');
      assert.deepEqual(a.meta, { audience: 'b2b', tags: ['minimal', 'bold'] }, 'dotted fields un-flattened to nested groups');
      assert.equal(a.design.steal_this, 'the hero');
      assert.equal(a.screenshot, 'screenshots/insp-1.png');
      assert.equal(a.status, 'done', 'AC1: status is exported');
      assert.match(a.added, /^2023-/, 'AC1: createdAt exported as an ISO added date');
      // library item carries the analysis provider (AC1: analysisProvider/Model)
      const lib = (doc.items[LIBRARY_BOARD_ID].find((r) => r.id === 'lib-1')) as any;
      assert.equal(lib.analysis_agent, 'claude', 'AC1: analysisProvider exported');
      assert.equal(lib.summary, 'a summary');
      // the URL-less item is present in JSON
      assert.ok(inspRecs.some((r) => r.id === 'nourl'));
      // asset references (incl. hash + dimensions)
      const asset = doc.assets.find((x) => x.id === 'as-1');
      assert.ok(asset && asset.path === 'screenshots/insp-1.png' && asset.hash === 'abc123' && asset.kind === 'screenshot');
      assert.equal(asset!.width, 1280);
      assert.equal(asset!.height, 800);
    } finally {
      handle.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Story 17.1 — exportNetscape (AC2)', () => {
  it('emits a standards-conformant bookmark file with ADD_DATE + TAGS, skipping URL-less items', async () => {
    const { dir, handle } = await seededExportDb();
    try {
      const html = exportNetscape(handle);
      assert.match(html, /^<!DOCTYPE NETSCAPE-Bookmark-file-1>/);
      assert.match(html, /<DL>/);
      assert.match(html, /<A HREF="https:\/\/a\.example" ADD_DATE="1700000000"[^>]*TAGS="[^"]*minimal[^"]*">Site A<\/A>/);
      assert.match(html, /<A HREF="https:\/\/b\.example"[^>]*>Doc B<\/A>/);
      // URL-less item is omitted from Netscape
      assert.doesNotMatch(html, /No URL/);
    } finally {
      handle.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('HTML-escapes untrusted url/title/tags', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'board-oss-export-'));
    const handle = initDb(join(dir, 'e.db'));
    seed(handle.db);
    try {
      await writeItem(handle, { id: 'x', boardId: INSPIRATION_BOARD_ID, source: 'https://x?a=1&b=2', title: '<script>alert(1)</script>', createdAt: 1 });
      const html = exportNetscape(handle);
      assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/, 'title must be escaped');
      assert.match(html, /a=1&amp;b=2/, 'url ampersand escaped');
    } finally {
      handle.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Story 17.1 — empty DB (no items) exports a valid empty document', () => {
  it('exports seeded boards with empty item arrays + a minimal Netscape file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'board-oss-export-empty-'));
    const handle = initDb(join(dir, 'e.db'));
    seed(handle.db); // boards only, no items
    try {
      const doc = exportJson(handle);
      assert.ok(doc.boards.length >= 3, 'seeded boards present');
      assert.deepEqual(doc.assets, []);
      // no items on any board → empty (or absent) per-board arrays; never a crash
      for (const recs of Object.values(doc.items)) assert.ok(Array.isArray(recs));
      const html = exportNetscape(handle);
      assert.match(html, /^<!DOCTYPE NETSCAPE-Bookmark-file-1>/);
      assert.match(html, /<DL><p>\n<\/DL><p>/, 'no <A> entries, but valid empty list');
    } finally {
      handle.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Story 17.1 — round-trip where possible (AC5c)', () => {
  it('feeds the JSON record arrays back through importRecords to re-create items', async () => {
    const { dir, handle } = await seededExportDb();
    const dir2 = mkdtempSync(join(tmpdir(), 'board-oss-roundtrip-'));
    const handle2 = initDb(join(dir2, 'r.db'));
    seed(handle2.db);
    try {
      const doc = exportJson(handle);
      const insp = await importRecords({ handle: handle2, boardId: INSPIRATION_BOARD_ID, records: doc.items[INSPIRATION_BOARD_ID] });
      const lib = await importRecords({ handle: handle2, boardId: LIBRARY_BOARD_ID, records: doc.items[LIBRARY_BOARD_ID] });
      assert.ok(insp.created >= 2, 'inspiration items re-created (incl. the url-less one)');
      assert.equal(lib.created, 1);
      // the re-imported inspiration item has the same flattened fields
      const re = handle2.db.select().from(items).where(eq(items.id, 'insp-1')).get();
      const fields = re?.fields as Record<string, unknown>;
      assert.equal(fields['meta.audience'], 'b2b', 'nested groups re-flattened to dotted keys on re-import');
      assert.deepEqual(fields['meta.tags'], ['minimal', 'bold']);
      // the library item's flat fields also re-create
      const reLib = handle2.db.select().from(items).where(eq(items.id, 'lib-1')).get();
      const libFields = reLib?.fields as Record<string, unknown>;
      assert.equal(libFields['summary'], 'a summary');
      assert.deepEqual(libFields['topics'], ['ai', 'rag']);
      assert.equal(reLib?.source, 'https://b.example', 'library url round-trips');
    } finally {
      handle.sqlite.close();
      handle2.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
      rmSync(dir2, { recursive: true, force: true });
    }
  });
});

describe('Story 17.1 — export mutates nothing (AC3/AC4, NFR-BC)', () => {
  it('leaves the DB byte-for-byte unchanged after both export formats', async () => {
    const { dir, handle } = await seededExportDb();
    try {
      const itemsBefore = handle.db.select().from(items).all();
      const boardsBefore = handle.db.select().from(boards).all();
      const assetsBefore = handle.db.select().from(assets).all();
      const ftsBefore = handle.sqlite.prepare(`SELECT count(*) c FROM item_fts WHERE item_fts MATCH 'summary'`).get() as { c: number };

      exportJson(handle);
      exportNetscape(handle);

      assert.deepEqual(handle.db.select().from(items).all(), itemsBefore, 'items unchanged');
      assert.deepEqual(handle.db.select().from(boards).all(), boardsBefore, 'boards unchanged');
      assert.deepEqual(handle.db.select().from(assets).all(), assetsBefore, 'assets unchanged');
      const ftsAfter = handle.sqlite.prepare(`SELECT count(*) c FROM item_fts WHERE item_fts MATCH 'summary'`).get() as { c: number };
      assert.equal(ftsAfter.c, ftsBefore.c, 'FTS unchanged');
    } finally {
      handle.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
