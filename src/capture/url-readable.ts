import { captureLibrary } from '../processor-library.js';
import type { CaptureAdapter, CaptureCtx, CaptureResult, CaptureSource } from './adapter.js';

// Story 6.3 — url-readable adapter (Library). A thin wrapper over the prototype's
// proven Library capture (`captureLibrary`: plain fetch → Readability + turndown →
// markdown, with a headless-render SPA fallback when the text is too thin, and a
// clear "no readable text" error otherwise). REUSED from processor-library.ts (not
// forked) — the logic is sound and already injectable/tested. Decoupled from
// analysis (Library enrichment is Epic 7). Library captures no screenshot.

/** Pull the title from the markdown's leading `# ` line (extractReadableMarkdown). */
function titleFromMarkdown(markdown: string): string | undefined {
  const m = /^#\s+(.+)$/m.exec(markdown);
  return m ? m[1].trim() : undefined;
}

interface Deps {
  fetchImpl?: typeof fetch;
  renderImpl?: (url: string) => Promise<string>;
}

export function createUrlReadableAdapter(deps: Deps = {}): CaptureAdapter {
  return {
    ingestMode: 'url-readable',
    async fetch(source: CaptureSource, ctx: CaptureCtx): Promise<CaptureResult> {
      if (typeof source !== 'string') {
        throw new Error('url-readable adapter requires a URL source');
      }
      const url = source;
      // captureLibrary throws a clear "No readable text…" error if both the direct
      // fetch and the render fallback yield too little (→ Story 5.2 marks `error`).
      // The render fallback launches Chrome via renderPageText, which closes in
      // `finally` (browser.ts); Story 6.5 adds the abort-signal force-close.
      void ctx.signal; // (6.5 wires cooperative cancellation into the render fallback)
      const captured = await captureLibrary(url, { fetchImpl: deps.fetchImpl, renderImpl: deps.renderImpl });

      const text = captured.text;
      const title = titleFromMarkdown(text);
      // Only include title when extracted — an undefined title must not overwrite an
      // existing item.title on re-capture (runCaptureForItem lifts title → column).
      const fields: Record<string, unknown> = { text, url };
      if (title) fields.title = title;
      return { fields, assets: [] };
    },
  };
}
