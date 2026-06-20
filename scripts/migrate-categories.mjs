#!/usr/bin/env node
// Usage:
//   node scripts/migrate-categories.mjs --dry-run   # print summary, don't write
//   node scripts/migrate-categories.mjs             # apply migration in place
//
// One-shot, idempotent. Maps the legacy meta.category string onto the new
// {audience, form, domain} faceted shape, normalizes meta.tags, and drops
// meta.category. Re-running on already-migrated data is a no-op.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BOOKMARKS_FILE = path.join(ROOT, "bookmarks.json");

const dryRun = process.argv.includes("--dry-run");

// ── Category → (audience, form, domain) mapping ─────────────────────────────
// Hand-curated. Every distinct meta.category string in the dataset as of the
// migration's authoring lives here. New strings encountered at runtime trigger
// a hard error so the table stays exhaustive.
const CATEGORY_MAP = {
  "SaaS":                                              ["b2b",        "saas",           null],
  "B2B SaaS":                                          ["b2b",        "saas",           null],
  "B2B SaaS / Healthcare Tech":                        ["b2b",        "saas",           "health"],
  "B2B Recruitment / Agency":                          ["b2b",        "agency",         "recruitment"],
  "SaaS / Productivity Tool":                          ["b2b",        "saas",           "productivity"],
  "SaaS / Productivity Suite":                         ["b2b",        "saas",           "productivity"],
  "SaaS / Developer Tools":                            ["developer",  "saas",           "dev-tools"],
  "SaaS / Utility App":                                ["consumer",   "saas",           "productivity"],
  "SaaS / E-commerce Infrastructure":                  ["b2b",        "infrastructure", "commerce"],
  "SaaS / Design Tool":                                ["prosumer",   "saas",           "creative"],
  "SaaS / Creative Platform":                          ["consumer",   "saas",           "creative"],
  "SaaS / Community Platform":                         ["consumer",   "saas",           null],
  "SaaS / Beta gate":                                  ["b2b",        "saas",           null],
  "SaaS / AI productivity":                            ["b2b",        "saas",           "ai"],
  "SaaS — Note-taking / Productivity":                 ["consumer",   "saas",           "productivity"],
  "SaaS — File sharing / AI workspace":                ["b2b",        "saas",           "ai"],
  "Productivity SaaS":                                 ["b2b",        "saas",           "productivity"],
  "Productivity SaaS (AI Calendar + Meeting Notes)":   ["b2b",        "saas",           "productivity"],
  "Indie SaaS / Creative Tool":                        ["prosumer",   "saas",           "creative"],
  "Consumer SaaS / Reading App":                       ["consumer",   "saas",           null],
  "Consumer Health / Mental Wellness SaaS":            ["consumer",   "saas",           "health"],
  "Health Tech / Consumer Health SaaS":                ["consumer",   "saas",           "health"],
  "Health & Wellness SaaS":                            ["consumer",   "saas",           "health"],
  "Digital Health / MedTech":                          ["b2b",        "saas",           "health"],
  "Fintech / Private Banking SaaS":                    ["enterprise", "saas",           "fintech"],
  "Enterprise AI / SaaS":                              ["enterprise", "saas",           "ai"],
  "Developer SaaS":                                    ["developer",  "saas",           "dev-tools"],
  "Developer Tool / Open Source SaaS":                 ["developer",  "saas",           "dev-tools"],
  "Developer Tool / AI Coding Agent":                  ["developer",  "saas",           "dev-tools"],
  "Developer Tools / AI SaaS":                         ["developer",  "saas",           "dev-tools"],
  "AI SaaS / Productivity":                            ["b2b",        "saas",           "ai"],
  "AI SaaS / Productivity Tool":                       ["b2b",        "saas",           "ai"],
  "AI SaaS / Agent Workspace":                         ["b2b",        "saas",           "ai"],
  "AI Agent SaaS":                                     ["b2b",        "saas",           "ai"],

  "Developer Tools / SDK":                             ["developer",  "infrastructure", "dev-tools"],
  "Developer Tools / Open Source":                     ["developer",  "infrastructure", "dev-tools"],
  "Developer Tool / Open Source CLI":                  ["developer",  "infrastructure", "dev-tools"],
  "Developer Platform / Infrastructure SaaS":          ["developer",  "infrastructure", "dev-tools"],
  "Developer Platform / AI Infrastructure":            ["developer",  "infrastructure", "ai"],
  "Developer Infrastructure / SaaS":                   ["developer",  "infrastructure", "dev-tools"],
  "Developer infrastructure / Payments security SaaS": ["developer",  "infrastructure", "fintech"],
  "API Infrastructure / AI Marketplace":               ["developer",  "infrastructure", "ai"],
  "Web3 / Developer Tools":                            ["developer",  "infrastructure", "crypto"],

  "Mobile App Landing Page":                           ["consumer",   "mobile-app",     null],
  "Mobile App / Indie":                                ["prosumer",   "mobile-app",     null],
  "Personal AI / Consumer App":                        ["consumer",   "mobile-app",     "ai"],
  "Consumer AI / Personal AI app":                     ["consumer",   "mobile-app",     "ai"],
  "Consumer App / Email":                              ["consumer",   "mobile-app",     "productivity"],
  "Consumer App (iOS/Mac)":                            ["consumer",   "mobile-app",     null],
  "Consumer Fintech":                                  ["consumer",   "mobile-app",     "fintech"],
  "Fintech / Crypto Wallet":                           ["consumer",   "mobile-app",     "crypto"],
  "Wellness / Spiritual App":                          ["consumer",   "mobile-app",     "health"],
  "Wellness / Mental Health App":                      ["consumer",   "mobile-app",     "health"],
  "Health/Wellness app marketing":                     ["consumer",   "mobile-app",     "health"],
  "Creative App / Studio Product Page":                ["prosumer",   "mobile-app",     "creative"],

  "Hardware Product / DTC":                            ["consumer",   "hardware",       null],
  "Hardware / Robotics":                               ["enterprise", "hardware",       null],
  "Hardware / Health Tech":                            ["consumer",   "hardware",       "health"],
  "Consumer Hardware / Software (Home Server)":        ["consumer",   "hardware",       null],
  "Consumer Hardware / Health Tech":                   ["consumer",   "hardware",       "health"],
  "Consumer Hardware / Beauty Tech":                   ["consumer",   "hardware",       null],

  "E-commerce":                                        ["consumer",   "e-commerce",     null],
  "E-commerce (premium hardware)":                     ["consumer",   "e-commerce",     null],
  "E-commerce (DTC single-product)":                   ["consumer",   "e-commerce",     null],
  "Type Foundry / Product Page":                       ["prosumer",   "e-commerce",     "creative"],

  "Portfolio":                                         ["prosumer",   "portfolio",      "creative"],
  "Director/Production Portfolio":                     ["prosumer",   "portfolio",      "creative"],
  "VC-backed Holding Company / Private Equity":        ["b2b",        "portfolio",      "fintech"],

  "Publishing / Editorial":                            ["consumer",   "editorial",      null],
  "Editorial / Print Magazine":                        ["consumer",   "editorial",      null],

  "Agency":                                            ["b2b",        "agency",         null],
  "Creative Studio / Agency":                          ["prosumer",   "agency",         "creative"],
  "Professional Services / Legal":                     ["b2b",        "agency",         "legal"],
};

// ── Tag normalization ───────────────────────────────────────────────────────
// 1. lowercase, hyphenate spaces, collapse repeats
// 2. apply synonym map
// 3. drop tags that are now structured fields
const TAG_SYNONYMS = {
  "dark-mode": "dark-theme",
  "developertools": "developer-tools",
  "ai-native": "ai",
  "ai-agents": "ai",
  "ai-assistant": "ai",
};
const TAG_DROPS = new Set([
  "b2b", "enterprise", "consumer-app", "consumer",
  "developer-tools", "developer-focused",
]);

function normalizeTag(raw) {
  let t = String(raw).toLowerCase().trim().replace(/\s+/g, "-").replace(/-+/g, "-");
  if (Object.prototype.hasOwnProperty.call(TAG_SYNONYMS, t)) t = TAG_SYNONYMS[t];
  return t;
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of tags) {
    const t = normalizeTag(raw);
    if (!t) continue;
    if (TAG_DROPS.has(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

// ── Apply ───────────────────────────────────────────────────────────────────
const bookmarks = JSON.parse(fs.readFileSync(BOOKMARKS_FILE, "utf-8"));

let alreadyMigrated = 0;
let migrated = 0;
let unknownCategory = [];

const audienceCounts = {};
const formCounts = {};
const domainCounts = {};
let tagsBefore = 0;
let tagsAfter = 0;

for (const b of bookmarks) {
  // Idempotency: skip already-migrated entries
  if (b.meta?.audience !== undefined && b.meta?.form !== undefined) {
    alreadyMigrated++;
    continue;
  }

  const cat = b.meta?.category;
  const mapping = CATEGORY_MAP[cat];
  if (!mapping) {
    unknownCategory.push({ id: b.id, category: cat });
    continue;
  }

  const [audience, form, domain] = mapping;
  audienceCounts[audience] = (audienceCounts[audience] || 0) + 1;
  formCounts[form] = (formCounts[form] || 0) + 1;
  const domainKey = domain ?? "(null)";
  domainCounts[domainKey] = (domainCounts[domainKey] || 0) + 1;

  tagsBefore += b.meta.tags?.length || 0;
  const newTags = normalizeTags(b.meta.tags);
  tagsAfter += newTags.length;

  b.meta = {
    audience,
    form,
    domain,
    tier: b.meta.tier,
    tone: b.meta.tone,
    tags: newTags,
  };

  migrated++;
}

console.log(`Migrated: ${migrated}`);
console.log(`Already migrated (skipped): ${alreadyMigrated}`);
console.log(`Unknown categories: ${unknownCategory.length}`);
if (unknownCategory.length) {
  for (const u of unknownCategory) console.log(`  - ${u.id}: ${JSON.stringify(u.category)}`);
  console.error("Add the above to CATEGORY_MAP and re-run.");
  process.exit(1);
}

const printCounts = (label, counts) => {
  console.log(`\n${label}:`);
  for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${v.toString().padStart(3)}  ${k}`);
  }
};
printCounts("audience", audienceCounts);
printCounts("form", formCounts);
printCounts("domain", domainCounts);

console.log(`\nTags: ${tagsBefore} → ${tagsAfter} (${tagsBefore - tagsAfter} dropped/dedup'd)`);

if (dryRun) {
  console.log("\nDry run — no changes written.");
} else {
  fs.writeFileSync(BOOKMARKS_FILE, JSON.stringify(bookmarks, null, 2));
  console.log(`\nWrote ${BOOKMARKS_FILE}`);
}
