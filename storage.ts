import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type CollectionMeta = {
  id: string;
  name: string;
  type: string;
  view: "grid" | "list";
  dataFile: string;
};

const LOCK_TIMEOUT_MS = 10_000;
const LOCK_RETRY_MS = 50;

function sleepSync(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function withFileLock<T>(filePath: string, operation: () => T): T {
  const lockFile = `${filePath}.lock`;
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  let lockFd = -1;
  while (true) {
    try {
      lockFd = fs.openSync(lockFile, "wx");
      break;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST" || Date.now() >= deadline) throw err;
      sleepSync(LOCK_RETRY_MS);
    }
  }

  try {
    return operation();
  } finally {
    fs.closeSync(lockFd);
    fs.rmSync(lockFile, { force: true });
  }
}

function readJsonFile<T>(filePath: string): T[] {
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T[];
}

function writeJsonAtomic(filePath: string, data: unknown[]): void {
  const tempFile = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(data, null, 2));
  fs.renameSync(tempFile, filePath);
}

function mutateJsonFile<T, R>(filePath: string, operation: (items: T[]) => R): R {
  return withFileLock(filePath, () => {
    const items = readJsonFile<T>(filePath);
    const result = operation(items);
    writeJsonAtomic(filePath, items);
    return result;
  });
}

// --- Manifest ---

let _manifest: CollectionMeta[] | null = null;

function loadManifest(): CollectionMeta[] {
  if (!_manifest) {
    _manifest = JSON.parse(
      fs.readFileSync(path.join(__dirname, "collections.json"), "utf-8")
    ) as CollectionMeta[];
  }
  return _manifest;
}

export function listCollections(): CollectionMeta[] {
  return loadManifest();
}

export function getCollection(id: string): CollectionMeta {
  const col = loadManifest().find((c) => c.id === id);
  if (!col) throw new Error(`Unknown collection: "${id}"`);
  return col;
}

function resolveDataFile(id: string): string {
  return path.join(__dirname, getCollection(id).dataFile);
}

// --- Collection-aware API ---

export function loadCollection<T>(id: string): T[] {
  return readJsonFile<T>(resolveDataFile(id));
}

export function saveCollection(id: string, items: unknown[]): void {
  writeJsonAtomic(resolveDataFile(id), items);
}

export function mutateCollection<T, R>(id: string, op: (items: T[]) => R): R {
  return mutateJsonFile<T, R>(resolveDataFile(id), op);
}

// --- Backward-compatible delegates over the "inspiration" collection ---

export const BOOKMARKS_FILE = resolveDataFile("inspiration");

export function withBookmarksLock<T>(operation: () => T): T {
  return withFileLock(BOOKMARKS_FILE, operation);
}

export function readBookmarks<T>(): T[] {
  return readJsonFile<T>(BOOKMARKS_FILE);
}

export function writeBookmarksAtomic(bookmarks: unknown[]): void {
  writeJsonAtomic(BOOKMARKS_FILE, bookmarks);
}

export function mutateBookmarks<TBookmark, TResult>(
  operation: (bookmarks: TBookmark[]) => TResult
): TResult {
  return mutateJsonFile<TBookmark, TResult>(BOOKMARKS_FILE, operation);
}
