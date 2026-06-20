#!/usr/bin/env node
/**
 * inspect-bookmarks.mjs — read-only inspector for bookmarks.json
 *
 * Iterates the bookmarks array and prints chosen properties for each entry,
 * one bookmark per line. Supports dot-notation for nested fields (e.g. meta.category).
 *
 * Usage:
 *   node scripts/inspect-bookmarks.mjs <prop> [prop...]
 *
 * Examples:
 *   node scripts/inspect-bookmarks.mjs title meta.category
 *   node scripts/inspect-bookmarks.mjs meta.category | sort -u           # unique categories
 *   node scripts/inspect-bookmarks.mjs meta.category | sort | uniq -c    # counts per category
 *   node scripts/inspect-bookmarks.mjs id title meta.tier favorite
 *
 * Output: tab-separated, one bookmark per line. Pipes cleanly to sort/uniq/awk/cut.
 *
 * Writes are not supported in this version. To add write support later, load the JSON,
 * mutate the array, and write back with fs.writeFileSync(BOOKMARKS, JSON.stringify(arr, null, 2)).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const BOOKMARKS = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bookmarks.json');

const props = process.argv.slice(2);
if (props.length === 0) {
  console.error('Usage: node scripts/inspect-bookmarks.mjs <prop> [prop...]');
  console.error('Example: node scripts/inspect-bookmarks.mjs title meta.category');
  process.exit(1);
}

const get = (obj, path) =>
  path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), obj);

const fmt = (v) => {
  if (v === undefined) return '';
  if (v === null) return 'null';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

const bookmarks = JSON.parse(readFileSync(BOOKMARKS, 'utf8'));
for (const b of bookmarks) {
  console.log(props.map((p) => fmt(get(b, p))).join('\t'));
}
