#!/usr/bin/env node
// Usage: node scripts/check-taxonomy.mjs
// Reads bookmarks.json + taxonomy.json and reports any meta.audience /
// meta.form / meta.domain values that aren't in the canonical lists.
// Exits 0 when clean, 1 when drift is found. Tags are not checked here —
// they're an open vocabulary by design.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const taxonomy = JSON.parse(fs.readFileSync(path.join(ROOT, "taxonomy.json"), "utf-8"));
const bookmarks = JSON.parse(fs.readFileSync(path.join(ROOT, "bookmarks.json"), "utf-8"));

const FACETS = ["audience", "form", "domain"];
const allowed = Object.fromEntries(FACETS.map((f) => [f, new Set(taxonomy[f])]));
allowed.domain.add(null);

const drift = { audience: new Map(), form: new Map(), domain: new Map() };

for (const b of bookmarks) {
  for (const facet of FACETS) {
    const value = b.meta?.[facet];
    if (value === undefined) continue;
    if (!allowed[facet].has(value)) {
      const map = drift[facet];
      map.set(value, (map.get(value) || 0) + 1);
    }
  }
}

let dirty = false;
for (const facet of FACETS) {
  if (drift[facet].size === 0) continue;
  dirty = true;
  console.log(`\n${facet}: ${drift[facet].size} unknown value(s)`);
  const sorted = [...drift[facet].entries()].sort((a, b) => b[1] - a[1]);
  for (const [value, count] of sorted) {
    console.log(`  ${count.toString().padStart(3)}× ${JSON.stringify(value)}`);
  }
}

if (dirty) {
  console.log("\nFix by editing taxonomy.json (canonicalize) or bookmarks.json (correct).");
  process.exit(1);
}

console.log("Taxonomy clean — all values present in taxonomy.json.");
