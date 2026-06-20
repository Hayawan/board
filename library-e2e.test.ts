import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runAdd } from "./add.js";
import { BOOKMARKS_FILE, getCollection } from "./storage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LIBRARY_FILE = path.join(__dirname, getCollection("library").dataFile);

const FIXED_ANALYSIS = {
  title: "How Agents Work",
  summary: "An introduction to AI agent architectures and their components.",
  topics: ["ai", "agents", "llm"],
  author: "Alice Smith",
  type: "article",
  key_points: [
    "Agents use tools to interact with the world",
    "Planning and memory are key components",
    "Tool use enables real actions",
  ],
};

// --- Library add: full pipeline round trip ---

test("library add: appends one valid entry to library.json, leaves bookmarks.json untouched", async () => {
  const libSnapshot = fs.readFileSync(LIBRARY_FILE, "utf-8");
  const bmSnapshot = fs.readFileSync(BOOKMARKS_FILE, "utf-8");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "board-e2e-"));
  const resultFile = path.join(tempDir, "result.json");

  // Start from a known empty state so the assertion (length === 1) is unambiguous
  fs.writeFileSync(LIBRARY_FILE, "[]");

  try {
    const { entry, isRefetch } = await runAdd(
      ["node", "add.ts", "https://example.com/article", "--collection", "library"],
      { BOARD_RESULT_FILE: resultFile },
      {
        captureOverride: async () => ({ text: "article content for testing", screenshotPath: null }),
        analyzeOverride: async () => FIXED_ANALYSIS,
      }
    );

    assert.equal(isRefetch, false);
    assert.equal(entry.title, FIXED_ANALYSIS.title);
    assert.equal(entry.summary, FIXED_ANALYSIS.summary);
    assert.deepEqual(entry.topics, FIXED_ANALYSIS.topics);
    assert.equal(entry.notes, "");
    assert.ok(!("screenshot" in entry), "library entry should have no screenshot key");
    assert.match(entry.added as string, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(entry.url, "https://example.com/article");

    // Exactly one entry persisted to library.json
    const lib = JSON.parse(fs.readFileSync(LIBRARY_FILE, "utf-8")) as unknown[];
    assert.equal(lib.length, 1, "library.json should have exactly one entry");
    assert.deepEqual(lib[0], entry);

    // BOARD_RESULT_FILE received the entry
    const result = JSON.parse(fs.readFileSync(resultFile, "utf-8"));
    assert.deepEqual(result, entry);

    // bookmarks.json is byte-for-byte unchanged
    assert.equal(
      fs.readFileSync(BOOKMARKS_FILE, "utf-8"),
      bmSnapshot,
      "bookmarks.json must not be modified by a library add"
    );
  } finally {
    fs.writeFileSync(LIBRARY_FILE, libSnapshot);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// --- Library refetch: preserves notes ---

test("library refetch: updates entry and preserves user notes field", async () => {
  const libSnapshot = fs.readFileSync(LIBRARY_FILE, "utf-8");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "board-e2e-"));
  const resultFile = path.join(tempDir, "result.json");

  try {
    const existingEntry = {
      id: "example-com-article-99999",
      url: "https://example.com/old",
      added: "2025-01-01",
      title: "Old Title",
      summary: "Old summary.",
      topics: ["old"],
      author: null,
      type: "article",
      key_points: ["old point one", "old point two"],
      notes: "my personal research notes",
      analysis_agent: "claude",
      analysis_model: null,
    };
    fs.writeFileSync(LIBRARY_FILE, JSON.stringify([existingEntry]));

    const updatedAnalysis = { ...FIXED_ANALYSIS, title: "Updated Title", summary: "Updated summary." };

    const { entry, isRefetch } = await runAdd(
      ["node", "add.ts", "https://example.com/article", "--collection", "library"],
      { BOARD_UPDATE_ID: existingEntry.id, BOARD_RESULT_FILE: resultFile },
      {
        captureOverride: async () => ({ text: "updated content", screenshotPath: null }),
        analyzeOverride: async () => updatedAnalysis,
      }
    );

    assert.equal(isRefetch, true);
    assert.equal(entry.title, "Updated Title");
    assert.equal(entry.notes, "my personal research notes", "refetch must preserve notes");
    assert.equal(entry.id, existingEntry.id, "id must be preserved");
    assert.equal(entry.added, existingEntry.added, "added date must be preserved");
    assert.equal(entry.url, "https://example.com/article");

    // Verify persisted correctly
    const lib = JSON.parse(fs.readFileSync(LIBRARY_FILE, "utf-8")) as any[];
    assert.equal(lib.length, 1);
    assert.equal(lib[0].notes, "my personal research notes");
    assert.equal(lib[0].title, "Updated Title");

    // BOARD_RESULT_FILE received the updated entry
    const result = JSON.parse(fs.readFileSync(resultFile, "utf-8"));
    assert.equal(result.notes, "my personal research notes");
    assert.equal(result.title, "Updated Title");
  } finally {
    fs.writeFileSync(LIBRARY_FILE, libSnapshot);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
