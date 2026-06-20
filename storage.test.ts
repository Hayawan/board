import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  BOOKMARKS_FILE,
  getCollection,
  listCollections,
  loadCollection,
  mutateCollection,
  saveCollection,
} from "./storage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LIBRARY_FILE = path.join(__dirname, "library.json");

function snapshotLibrary(): string {
  return fs.readFileSync(LIBRARY_FILE, "utf-8");
}

function restoreLibrary(snapshot: string): void {
  fs.writeFileSync(LIBRARY_FILE, snapshot);
}

// --- Manifest resolution ---

test("listCollections returns exactly two entries", () => {
  const cols = listCollections();
  assert.equal(cols.length, 2);
  assert.ok(cols.find((c) => c.id === "inspiration"), "missing inspiration");
  assert.ok(cols.find((c) => c.id === "library"), "missing library");
});

test("getCollection resolves library dataFile", () => {
  assert.equal(getCollection("library").dataFile, "library.json");
});

test("getCollection resolves inspiration dataFile", () => {
  assert.equal(getCollection("inspiration").dataFile, "bookmarks.json");
});

test("getCollection throws on unknown id", () => {
  assert.throws(() => getCollection("nope"), /nope/);
});

// --- loadCollection / saveCollection round-trip ---

test("saveCollection and loadCollection round-trip for library", () => {
  const snapshot = snapshotLibrary();
  try {
    const items = [{ id: 1, title: "Test" }];
    saveCollection("library", items);
    const loaded = loadCollection<{ id: number; title: string }>("library");
    assert.deepEqual(loaded, items);
  } finally {
    restoreLibrary(snapshot);
  }
});

// --- mutateCollection read-modify-write ---

test("mutateCollection appends an item for library", () => {
  const snapshot = snapshotLibrary();
  try {
    saveCollection("library", []);
    const result = mutateCollection<{ id: number }, number>("library", (items) => {
      items.push({ id: 42 });
      return items.length;
    });
    assert.equal(result, 1);
    const loaded = loadCollection<{ id: number }>("library");
    assert.deepEqual(loaded, [{ id: 42 }]);
  } finally {
    restoreLibrary(snapshot);
  }
});

// --- Backward-compatible delegate parity ---

test("BOOKMARKS_FILE is the absolute path to bookmarks.json", () => {
  assert.ok(path.isAbsolute(BOOKMARKS_FILE), "should be absolute");
  assert.ok(BOOKMARKS_FILE.endsWith("bookmarks.json"), `got ${BOOKMARKS_FILE}`);
});

test("BOOKMARKS_FILE matches inspiration collection dataFile path", () => {
  const expected = path.join(__dirname, getCollection("inspiration").dataFile);
  assert.equal(BOOKMARKS_FILE, expected);
});
