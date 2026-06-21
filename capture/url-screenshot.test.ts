import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createUrlScreenshotAdapter, type CaptureBrowser } from './url-screenshot.js';

// A fake puppeteer-ish browser. `throwOn` makes a page op throw mid-capture.
function fakeBrowser(opts: { title?: string; text?: string; throwOn?: 'goto' | 'screenshot' }) {
  let closed = false;
  const page = {
    setViewport: async () => {},
    goto: async () => { if (opts.throwOn === 'goto') throw new Error('goto failed'); },
    screenshot: async () => { if (opts.throwOn === 'screenshot') throw new Error('shot failed'); return Buffer.from('PNGDATA'); },
    evaluate: async (fn: (...a: unknown[]) => unknown) =>
      fn.toString().includes('document.title')
        ? { title: opts.title ?? 'My Title', text: opts.text ?? 'body text here' }
        : undefined, // dismissOverlays
    addStyleTag: async () => {},
  };
  const browser: CaptureBrowser = { newPage: async () => page as never, close: async () => { closed = true; } };
  return { browser, isClosed: () => closed };
}

describe('url-screenshot adapter (Story 6.2)', () => {
  let dir: string;
  before(() => { dir = mkdtempSync(join(tmpdir(), 'board-oss-shot-')); });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  // AC 1/3 — screenshots a URL, stores an asset, returns capture fields (no analysis)
  it('captures a screenshot, stores the asset file, returns fields + asset', async () => {
    const fb = fakeBrowser({ title: 'Acme', text: 'hello world' });
    const adapter = createUrlScreenshotAdapter({ launch: async () => fb.browser, sleep: async () => {} });
    const out = await adapter.fetch('https://acme.example', { itemId: 'shot1', boardId: 'b', screenshotsDir: dir });

    assert.equal(out.fields.title, 'Acme');
    assert.equal(out.fields.text, 'hello world');
    assert.equal(out.fields.url, 'https://acme.example');
    assert.equal(out.assets.length, 1);
    const asset = out.assets[0];
    assert.equal(asset.kind, 'screenshot');
    assert.equal(asset.path, 'screenshots/shot1.png'); // relative form (Story 2.2)
    assert.equal(asset.width, 1440);
    assert.equal(asset.height, 900);
    assert.ok(asset.hash && asset.hash.length > 0, 'asset has a content hash');
    assert.ok(existsSync(join(dir, 'shot1.png')), 'image written under screenshotsDir');
    assert.equal(fb.isClosed(), true, 'browser closed on success');
  });

  // AC 2/3 — on error: browser still closed (finally) AND error propagates (no swallow→"")
  it('closes the browser and propagates on a mid-capture error', async () => {
    const fb = fakeBrowser({ throwOn: 'screenshot' });
    const adapter = createUrlScreenshotAdapter({ launch: async () => fb.browser, sleep: async () => {} });
    await assert.rejects(
      () => adapter.fetch('https://x.example', { itemId: 'shot2', boardId: 'b', screenshotsDir: dir }),
      /shot failed/,
    );
    assert.equal(fb.isClosed(), true, 'browser must be closed on the error path');
  });

  // AC 1 — registered for ingest_mode url-screenshot
  it('declares ingest_mode = url-screenshot', () => {
    const adapter = createUrlScreenshotAdapter();
    assert.equal(adapter.ingestMode, 'url-screenshot');
  });

  // non-URL source is rejected (this adapter needs a URL)
  it('rejects a non-URL source', async () => {
    const adapter = createUrlScreenshotAdapter({ launch: async () => fakeBrowser({}).browser, sleep: async () => {} });
    await assert.rejects(
      () => adapter.fetch({ buffer: Buffer.from('x') }, { itemId: 'x', boardId: 'b', screenshotsDir: dir }),
      /URL/i,
    );
  });
});
