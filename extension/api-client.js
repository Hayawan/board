// Story 13.4 — the pure browser-extension API client. No DOM, no chrome.* references,
// so it's importable by node:test (the collections-ui.js precedent). It speaks ONLY the
// token-authed /api/v1/* contracts (Epics 12 + 14) — there is no extension-specific
// backend. The popup UI (popup.js) is the thin, untestable shell around this.
//
// Token handling: the plaintext bearer token is passed in (the shell reads it from
// chrome.storage.local) and is sent ONLY in the Authorization header — never in a URL
// query string, never logged. Treat it like a password.

/**
 * Create a client bound to one instance URL + token.
 * @param {{ baseUrl: string, token: string, fetch?: typeof fetch }} cfg
 */
export function createBoardClient(cfg) {
  const f = cfg.fetch ?? globalThis.fetch;
  const base = (cfg.baseUrl ?? "").replace(/\/+$/, ""); // strip trailing slash(es)
  const authHeaders = () => ({
    Authorization: `Bearer ${cfg.token}`,
    "Content-Type": "application/json",
  });

  async function asJson(res) {
    if (!res.ok) {
      throw new Error(`Board API ${res.status}`);
    }
    return res.json();
  }

  return {
    /** Save the current tab to the Inbox (no board → Story 13.1 cheap capture). */
    async save(tab) {
      const res = await f(`${base}/api/v1/items`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ url: tab.url, title: tab.title }),
      });
      return asJson(res);
    },

    /**
     * List recent captures, newest-first (the server's ordering, Story 12.2). Scoped to
     * the Inbox — the review lane is about triaging the firehose. `since` is passed
     * through as a real filter param (both limit + since are named in AC1).
     */
    async listRecent(limit = 20, since) {
      const qs = new URLSearchParams({ board: "inbox", limit: String(limit) });
      if (since !== undefined && since !== null) qs.set("since", String(since));
      const res = await f(`${base}/api/v1/items?${qs.toString()}`, { headers: authHeaders() });
      return asJson(res);
    },

    /** The read-only AI suggested home board for an item ({suggestedBoardId|null}, 14.3). */
    async getSuggestion(itemId) {
      const res = await f(`${base}/api/v1/items/${encodeURIComponent(itemId)}/suggestion`, {
        headers: authHeaders(),
      });
      return asJson(res);
    },

    /** The lean board list for the manual picker fallback (Story 12.2). */
    async listBoards() {
      const res = await f(`${base}/api/v1/boards`, { headers: authHeaders() });
      return asJson(res);
    },

    /**
     * Promote an item to a board via the ONE assign verb (Story 14.2): single-FK move
     * THEN earned-tier enrichment. Body is {itemIds:[id], boardId} — the batch-capable
     * contract; a single id is just a batch of one. Only ever called on explicit confirm.
     */
    async assign(itemId, boardId) {
      const res = await f(`${base}/api/v1/items/assign`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ itemIds: [itemId], boardId }),
      });
      return asJson(res);
    },
  };
}

/**
 * Pure decision: given a suggestion result, show the one-tap chip (a real suggested
 * board) or fall back to the dignified manual picker (no suggestion / no provider).
 * Story 14.3 AC2 — the degraded path is a manual board pick, never a dead end.
 * @param {{ suggestedBoardId: string | null } | null | undefined} suggestion
 */
export function reviewAction(suggestion) {
  const id = suggestion && suggestion.suggestedBoardId ? suggestion.suggestedBoardId : null;
  return id ? { mode: "chip", boardId: id } : { mode: "manual" };
}
