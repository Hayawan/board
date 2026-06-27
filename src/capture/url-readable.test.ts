import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createUrlReadableAdapter } from './url-readable.js';

const LONG = 'This is a substantial paragraph of article content that easily clears the useful-text threshold. '.repeat(6);
const ARTICLE_HTML = `<!doctype html><html><head><title>Great Article</title></head><body>
  <article><h1>Great Article</h1><p>${LONG}</p><p>${LONG}</p></article></body></html>`;
const THIN_SHELL = '<!doctype html><html><head><title>SPA</title></head><body><div id="root"></div></body></html>';

const fakeFetch = (html: string) => (async () => ({ text: async () => html })) as unknown as typeof fetch;

describe('url-readable adapter (Story 6.3)', () => {
  // AC 1 — readable markdown from an article URL via plain fetch (no browser)
  it('extracts markdown (title + content) from an article URL', async () => {
    const adapter = createUrlReadableAdapter({ fetchImpl: fakeFetch(ARTICLE_HTML) });
    const out = await adapter.fetch('https://blog.example/post', { itemId: 'r1', boardId: 'b' });
    assert.equal(out.fields.title, 'Great Article');
    assert.match(String(out.fields.text), /substantial paragraph/);
    assert.equal(out.fields.url, 'https://blog.example/post');
    assert.deepEqual(out.assets, []); // Library captures no screenshot
  });

  // AC 2 — SPA fallback: thin shell → headless render keeps the longer result
  it('falls back to a headless render when the fetched text is too thin', async () => {
    let rendered = false;
    const adapter = createUrlReadableAdapter({
      fetchImpl: fakeFetch(THIN_SHELL),
      renderImpl: async () => {
        rendered = true;
        return LONG + LONG;
      },
    });
    const out = await adapter.fetch('https://spa.example', { itemId: 'r2', boardId: 'b' });
    assert.equal(rendered, true, 'render fallback must run for a thin shell');
    assert.match(String(out.fields.text), /substantial paragraph/);
  });

  // AC 3 — no readable text even after fallback → clear error
  it('throws a clear "no readable text" error when nothing extracts', async () => {
    const adapter = createUrlReadableAdapter({
      fetchImpl: fakeFetch(THIN_SHELL),
      renderImpl: async () => '', // render also yields nothing
    });
    await assert.rejects(
      () => adapter.fetch('https://empty.example', { itemId: 'r3', boardId: 'b' }),
      /no readable text/i,
    );
  });

  it('declares ingest_mode = url-readable and rejects a non-URL source', async () => {
    const adapter = createUrlReadableAdapter({ fetchImpl: fakeFetch(ARTICLE_HTML) });
    assert.equal(adapter.ingestMode, 'url-readable');
    await assert.rejects(() => adapter.fetch({ buffer: Buffer.from('x') }, { itemId: 'x', boardId: 'b' }), /URL/i);
  });
});
