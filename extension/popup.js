// Story 13.4 — the review-lane popup: a thin shell around the tested pure client
// (api-client.js). It loads recent Inbox captures and, for each, shows the AI
// suggested-board chip (one-tap confirm → assign) or a manual board picker when there's
// no suggestion. Saving and assigning go ONLY through the authed /api/v1/* contracts.
//
// The compose-review (suggested home + one-tap confirm) is the differentiator — this is
// a triage lane, not a bare "save the tab" button (that would be a linkding clone).

import { createBoardClient, reviewAction } from "./api-client.js";

const statusEl = document.getElementById("status");
const listEl = document.getElementById("list");

const setStatus = (msg) => { statusEl.textContent = msg; };

/** Read the instance URL + token the user set in the options page. */
async function loadConfig() {
  const { instanceUrl, token } = await chrome.storage.local.get(["instanceUrl", "token"]);
  return { instanceUrl, token };
}

function needsSetup() {
  listEl.innerHTML = "";
  setStatus("");
  const p = document.createElement("p");
  p.className = "muted";
  p.innerHTML = 'Set your instance URL and API token in <a href="#" id="go-options">Settings</a> first.';
  listEl.appendChild(p);
  document.getElementById("go-options").addEventListener("click", openOptions);
}

function openOptions(e) {
  if (e) e.preventDefault();
  chrome.runtime.openOptionsPage();
}

/** The active tab's URL + title (activeTab grants this on the popup click gesture). */
async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return { url: tab?.url, title: tab?.title };
}

function render(client, items, boards) {
  const boardName = (id) => boards.find((b) => b.id === id)?.name ?? id;
  // Targetable boards exclude the Inbox itself (you assign OUT of the Inbox).
  const targets = boards.filter((b) => b.id !== "inbox");
  listEl.innerHTML = "";
  if (items.length === 0) {
    setStatus("Inbox is empty — nothing to triage.");
    return;
  }
  setStatus(`${items.length} recent capture${items.length === 1 ? "" : "s"}`);

  for (const item of items) {
    const row = document.createElement("div");
    row.className = "row";

    const title = document.createElement("div");
    title.className = "title";
    title.textContent = item.title || item.url || "(untitled)";
    const url = document.createElement("div");
    url.className = "url";
    url.textContent = item.url || "";
    const actions = document.createElement("div");
    actions.className = "actions";
    row.append(title, url, actions);
    listEl.appendChild(row);

    const promote = async (boardId, controls) => {
      controls.forEach((c) => (c.disabled = true));
      try {
        await client.assign(item.id, boardId);
        row.remove(); // promoted out of the Inbox — drop it from the lane
      } catch {
        controls.forEach((c) => (c.disabled = false));
        setStatus("Assign failed — check your connection/token.");
      }
    };

    // Dignified manual fallback — never a dead end (Story 14.3 AC2). Used when there's
    // no suggestion AND when the (best-effort) suggestion call fails: an item is always
    // promotable.
    const showManualPicker = () => {
      const picker = document.createElement("select");
      const ph = document.createElement("option");
      ph.value = "";
      ph.textContent = "Move to…";
      picker.appendChild(ph);
      for (const b of targets) {
        const opt = document.createElement("option");
        opt.value = b.id;
        opt.textContent = b.name;
        picker.appendChild(opt);
      }
      picker.addEventListener("change", () => {
        if (picker.value) promote(picker.value, [picker]);
      });
      actions.appendChild(picker);
    };

    // Resolve the suggested home, then show the chip or the manual picker.
    client.getSuggestion(item.id).then((suggestion) => {
      const action = reviewAction(suggestion);
      if (action.mode === "chip" && targets.some((b) => b.id === action.boardId)) {
        const chip = document.createElement("button");
        chip.className = "chip";
        chip.textContent = `→ ${boardName(action.boardId)}`;
        chip.title = "Confirm the AI-suggested home board";
        chip.addEventListener("click", () => promote(action.boardId, [chip]));
        actions.appendChild(chip);
      } else {
        showManualPicker();
      }
    }).catch(showManualPicker); // suggestion is best-effort — degrade to the manual picker
  }
}

async function refresh(client) {
  setStatus("Loading…");
  try {
    const [items, boards] = await Promise.all([client.listRecent(20), client.listBoards()]);
    render(client, items, boards);
  } catch {
    setStatus("Couldn’t reach your Board instance — check Settings.");
  }
}

async function main() {
  document.getElementById("open-options").addEventListener("click", openOptions);
  const { instanceUrl, token } = await loadConfig();
  if (!instanceUrl || !token) {
    needsSetup();
    return;
  }
  const client = createBoardClient({ baseUrl: instanceUrl, token, fetch: (...a) => fetch(...a) });

  document.getElementById("save").addEventListener("click", async () => {
    const tab = await currentTab();
    if (!tab.url) { setStatus("No active tab URL to save."); return; }
    setStatus("Saving…");
    try {
      await client.save(tab);
      await refresh(client);
    } catch {
      setStatus("Save failed — check your connection/token.");
    }
  });

  await refresh(client);
}

main();
