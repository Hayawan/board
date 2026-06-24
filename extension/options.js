// Story 13.4 — settings for the review-lane extension. Persists the instance URL +
// token to chrome.storage.local (this browser only) and, for a non-localhost instance,
// requests the host permission needed to fetch it. The token is treated like a password:
// stored locally, sent only as a Bearer header, never logged or placed in a URL.

const urlEl = document.getElementById("url");
const tokenEl = document.getElementById("token");
const statusEl = document.getElementById("status");

async function load() {
  const { instanceUrl, token } = await chrome.storage.local.get(["instanceUrl", "token"]);
  if (instanceUrl) urlEl.value = instanceUrl;
  if (token) tokenEl.value = token;
}

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

/**
 * Normalize to an origin (scheme + host + port), or return an {error} for a rejected
 * URL. A remote instance MUST be https — the bearer token is sent on every request, so
 * cleartext http to a non-local host would leak it on the wire ("treat like a password").
 * Local dev over http (localhost/127.0.0.1) stays allowed.
 */
function normalizeUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return { error: "Enter a valid instance URL (e.g. http://localhost:3141)." };
  }
  const isLocal = LOCAL_HOSTS.includes(u.hostname);
  if (u.protocol !== "https:" && !isLocal) {
    return { error: "Use https:// for a remote instance — http would leak your token over the network." };
  }
  return { origin: u.origin };
}

/** Ask for the host permission so the popup's fetch can reach a non-localhost instance. */
async function ensureHostPermission(origin) {
  const pattern = `${origin}/*`;
  try {
    const has = await chrome.permissions.contains({ origins: [pattern] });
    if (has) return true;
    return await chrome.permissions.request({ origins: [pattern] });
  } catch {
    return true; // localhost/127.0.0.1 are already in host_permissions
  }
}

document.getElementById("save").addEventListener("click", async () => {
  const { origin, error } = normalizeUrl(urlEl.value.trim());
  const token = tokenEl.value.trim();
  if (error) { statusEl.textContent = error; return; }
  if (!token) { statusEl.textContent = "Enter your API token."; return; }

  const granted = await ensureHostPermission(origin);
  if (!granted) { statusEl.textContent = "Host permission denied — the popup can’t reach that instance."; return; }

  await chrome.storage.local.set({ instanceUrl: origin, token });
  statusEl.textContent = "Saved.";
});

load();
