// Story 13.2 — the bookmarklet capture client. A pure builder that produces a
// `javascript:` one-liner which POSTs the current tab to the token-authed capture
// endpoint (Story 12.2's POST /api/v1/items) with NO target board, so it lands in
// the Inbox (Story 13.1's omitted-board default) with cheap enrichment.
//
// 12.1 reconciliation: the server holds only the SHA-256 HASH of the API token, never
// the plaintext — so the server cannot embed a working token. The plaintext is the
// operator's own secret; the help surface lets them paste it (client-side) into the
// placeholder. This builder is pure so it can run client-side (or in a test) without
// the server ever handling the plaintext.

/** A clearly-marked placeholder the help-page client replaces with the user's token. */
export const TOKEN_PLACEHOLDER = "PASTE_YOUR_BOARD_API_TOKEN";

export interface BookmarkletOptions {
  /** The instance origin, e.g. "https://board.example" (no trailing slash needed). */
  instanceUrl: string;
  /** The plaintext bearer token (or TOKEN_PLACEHOLDER for the served template). */
  token: string;
}

/**
 * Build the `javascript:` bookmarklet string. It `fetch`es the authed capture endpoint
 * with `{url, title}` from the current tab, shows a transient in-page confirmation, and
 * never navigates the user away (no full-page redirect). Compact, no dependencies.
 */
export function buildBookmarklet({ instanceUrl, token }: BookmarkletOptions): string {
  const base = instanceUrl.replace(/\/+$/, ""); // strip trailing slash(es)
  const endpoint = `${base}/api/v1/items`;
  // A self-contained IIFE. JSON.stringify the interpolated strings so quotes/specials
  // are escaped safely into the source.
  const code =
    `(function(){` +
    `fetch(${JSON.stringify(endpoint)},{` +
    `method:'POST',` +
    `headers:{'Content-Type':'application/json','Authorization':'Bearer '+${JSON.stringify(token)}},` +
    `body:JSON.stringify({url:location.href,title:document.title})` +
    `}).then(function(r){` +
    `var b=document.createElement('div');` +
    `b.textContent=r.ok?'✓ Saved to Inbox':'Save failed';` +
    `b.style.cssText='position:fixed;top:12px;right:12px;z-index:2147483647;padding:8px 12px;background:#222;color:#fff;border-radius:6px;font:14px sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.3)';` +
    `document.body.appendChild(b);` +
    `setTimeout(function(){b.remove();},2200);` +
    `}).catch(function(){` +
    `var e=document.createElement('div');e.textContent='Save failed';` +
    `e.style.cssText='position:fixed;top:12px;right:12px;z-index:2147483647;padding:8px 12px;background:#b00;color:#fff;border-radius:6px;font:14px sans-serif';` +
    `document.body.appendChild(e);setTimeout(function(){e.remove();},2200);` +
    `});` +
    `})();`;
  return `javascript:${code}`;
}
