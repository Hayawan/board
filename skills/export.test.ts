import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildServer } from '../server.js';
import { createRegistry, registerAllSkills } from './registry.js';

// Story 17.1 — the export skill is registered and invokable via POST /skills/export.

test('17.1: export skill is registered in registerAllSkills', () => {
  const reg = createRegistry();
  registerAllSkills(reg);
  assert.ok(reg.get('export'), 'export skill must be registered');
});

async function seededApp() {
  const { initDb } = await import('../db/index.js');
  const { seed } = await import('../db/seed.js');
  const { writeItem } = await import('../db/queue.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'board-oss-exp-skill-'));
  const handle = initDb(path.join(dir, 'c.db'));
  seed(handle.db);
  await writeItem(handle, { id: 'e1', boardId: 'library', source: 'https://x.example', title: 'X', fields: { topics: ['ai'] } });
  const app = await buildServer({ db: handle });
  return { app, handle, dir };
}

test('17.1: POST /skills/export returns the JSON document', async () => {
  const { app, handle, dir } = await seededApp();
  try {
    const res = await app.inject({
      method: 'POST',
      url: '/skills/export',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ format: 'json' }),
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.format, 'json');
    assert.ok(Array.isArray(body.document.boards) && body.document.boards.length >= 3);
    assert.ok(body.document.items.library.some((r: any) => r.id === 'e1'));
  } finally {
    handle.sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('17.1: POST /skills/export returns a Netscape bookmark file', async () => {
  const { app, handle, dir } = await seededApp();
  try {
    const res = await app.inject({
      method: 'POST',
      url: '/skills/export',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ format: 'netscape' }),
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.format, 'netscape');
    assert.match(body.html, /^<!DOCTYPE NETSCAPE-Bookmark-file-1>/);
    assert.match(body.html, /<A HREF="https:\/\/x\.example"/);
  } finally {
    handle.sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
