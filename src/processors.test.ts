import assert from "node:assert/strict";
import test from "node:test";
import "./add.js"; // registers the inspiration processor as a module side-effect
import { getProcessor } from "./processors.js";
import { validateAnalysis } from "./add.js";

const validAnalysis = {
  title: "Example",
  meta: {
    audience: "consumer",
    form: "app",
    domain: null,
    tags: ["editorial", "warm"],
    tier: "reference",
    tone: ["warm", "focused"],
  },
  design: {
    steal_this: "Lead with one concrete product moment.",
    above_fold: "A focused hero with product proof.",
    nav_pattern: "Simple top navigation.",
    whitespace: "Balanced spacing around key sections.",
    color_story: "Warm neutrals with a crisp accent.",
    design_system_score: "semi-systematic",
  },
  reflection: {
    five_second_message: "This product helps you make progress.",
  },
};

// --- Registry lookup ---

test("getProcessor returns inspiration processor with all required fields", () => {
  const p = getProcessor("inspiration");
  assert.equal(p.type, "inspiration");
  assert.ok(p.schema && typeof p.schema === "object", "should have schema object");
  assert.ok(typeof p.systemPrompt === "string" && p.systemPrompt.length > 0, "should have non-empty systemPrompt");
  assert.ok(typeof p.capture === "function", "should have capture function");
  assert.ok(typeof p.validate === "function", "should have validate function");
  assert.ok(typeof p.buildEntry === "function", "should have buildEntry function");
});

test("getProcessor returns library processor after registration", () => {
  const p = getProcessor("library");
  assert.equal(p.type, "library");
  assert.ok(typeof p.capture === "function");
  assert.ok(typeof p.validate === "function");
  assert.ok(typeof p.buildEntry === "function");
});

test("getProcessor throws for unregistered type 'nope'", () => {
  assert.throws(() => getProcessor("nope"), /No processor registered for type "nope"/);
});

// --- Validate parity ---

test("inspirationProcessor.validate is parity with validateAnalysis", () => {
  const p = getProcessor("inspiration");
  assert.deepEqual(p.validate(validAnalysis), validateAnalysis(validAnalysis));
});

// --- buildEntry: append branch (no existing) ---

test("inspirationProcessor.buildEntry assembles correct append entry", () => {
  const p = getProcessor("inspiration");
  const ctx = {
    id: "example-com-12345",
    url: "https://example.com",
    analysis: validAnalysis,
    captured: { text: "page content", screenshotPath: "/abs/path/screenshot.png" },
    agent: { id: "claude", model: null as string | null },
  };
  const entry = p.buildEntry(ctx);
  assert.equal(entry.id, ctx.id);
  assert.equal(entry.url, ctx.url);
  assert.match(entry.added as string, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(entry.screenshot, `screenshots/${ctx.id}.png`);
  assert.equal(entry.title, validAnalysis.title);
  assert.deepEqual(entry.meta, validAnalysis.meta);
  assert.deepEqual(entry.design, validAnalysis.design);
  assert.deepEqual(entry.reflection, validAnalysis.reflection);
  assert.equal(entry.analysis_agent, "claude");
  assert.equal(entry.analysis_model, null);
});

test("inspirationProcessor.buildEntry uses null screenshot when capture has no screenshotPath", () => {
  const p = getProcessor("inspiration");
  const entry = p.buildEntry({
    id: "test-id",
    url: "https://example.com",
    analysis: validAnalysis,
    captured: { text: "", screenshotPath: null },
    agent: { id: "claude", model: null },
  });
  assert.equal(entry.screenshot, null);
});

// --- buildEntry: refetch branch (with existing) ---

test("inspirationProcessor.buildEntry merges into existing for refetch", () => {
  const p = getProcessor("inspiration");
  const existing: Record<string, unknown> = {
    id: "example-com-12345",
    url: "https://old.example.com",
    added: "2025-01-15",
    screenshot: "screenshots/example-com-12345.png",
    title: "Old Title",
    meta: { audience: "b2b" },
    design: { steal_this: "old idea" },
    reflection: { five_second_message: "old message", apply_to_naruki: "old apply" },
    favorite: true,
    analysis_agent: "codex",
    analysis_model: "gpt-4",
  };
  const newAnalysis = {
    ...validAnalysis,
    reflection: {
      five_second_message: "new five second message",
      what_we_learn: "new learning",
    },
  };
  const entry = p.buildEntry({
    id: "example-com-12345",
    url: "https://example.com",
    analysis: newAnalysis,
    captured: { text: "content", screenshotPath: "/new/screenshot.png" },
    agent: { id: "claude", model: null },
    existing,
  });
  assert.equal(entry.id, existing.id);
  assert.equal(entry.added, existing.added);
  assert.equal(entry.url, "https://example.com");
  assert.equal(entry.title, newAnalysis.title);
  assert.deepEqual(entry.meta, newAnalysis.meta);
  assert.deepEqual(entry.design, newAnalysis.design);
  // reflection merges: existing spread first, analysis overrides + adds new keys
  assert.deepEqual(entry.reflection, {
    five_second_message: "new five second message",
    apply_to_naruki: "old apply",
    what_we_learn: "new learning",
  });
  assert.equal(entry.favorite, true);
  assert.equal(entry.analysis_agent, "claude");
  assert.equal(entry.screenshot, `screenshots/example-com-12345.png`);
});

test("inspirationProcessor.buildEntry falls back to existing screenshot when no new screenshotPath", () => {
  const p = getProcessor("inspiration");
  const existing: Record<string, unknown> = {
    id: "x",
    screenshot: "screenshots/x.png",
    reflection: {},
  };
  const entry = p.buildEntry({
    id: "x",
    url: "https://x.com",
    analysis: validAnalysis,
    captured: { text: "", screenshotPath: null },
    agent: { id: "claude", model: null },
    existing,
  });
  assert.equal(entry.screenshot, "screenshots/x.png");
});

// --- summarize ---

test("inspirationProcessor.summarize returns steal_this, facets, and tags lines", () => {
  const p = getProcessor("inspiration");
  assert.ok(typeof p.summarize === "function", "inspiration processor must implement summarize");
  const entry: Record<string, unknown> = {
    design: { steal_this: "Bold hero with product proof" },
    meta: { audience: "consumer", form: "app", domain: "productivity", tags: ["editorial", "warm"] },
  };
  const lines = p.summarize!(entry);
  assert.ok(Array.isArray(lines) && lines.length > 0, "should return non-empty array");
  assert.ok(lines.some((l) => l.includes("Bold hero")), "should include steal_this");
  assert.ok(lines.some((l) => l.includes("consumer")), "should include audience facet");
  assert.ok(lines.some((l) => l.includes("editorial")), "should include a tag");
  assert.ok(!lines.some((l) => l.includes("summary")), "should not reference library summary field");
  assert.ok(!lines.some((l) => l.includes("key_points")), "should not reference library key_points field");
});
