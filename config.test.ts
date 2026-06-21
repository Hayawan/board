import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';

import { loadConfig } from './config.js';

// Story 2.1 — pure, injectable config loader. Tests never touch the real process.env.

describe('loadConfig (Story 2.1)', () => {
  // AC 1 — unset env yields safe defaults
  it('applies safe defaults when env is empty', () => {
    const c = loadConfig({});
    assert.equal(c.port, 3141);
    assert.equal(c.host, '127.0.0.1');
    assert.equal(typeof c.dataDir, 'string');
    assert.ok(c.dataDir.length > 0);
    assert.equal(c.chromePath, null);
    assert.equal(c.providerEnabled, false); // unset = no-AI
    assert.equal(c.provider.apiKey, null);
    assert.equal(c.provider.agent, null);
  });

  // AC 2 — env overrides win
  it('lets non-empty env override every knob', () => {
    const c = loadConfig({
      PORT: '8080',
      HOST: '0.0.0.0',
      DATA_DIR: '/tmp/board-x',
      CHROME_PATH: '/usr/bin/chromium',
      LLM_BASE_URL: 'https://api.example/v1',
      LLM_API_KEY: 'sk-secret',
      LLM_MODEL: 'gpt-x',
      LLM_AGENT: 'codex',
    });
    assert.equal(c.port, 8080);
    assert.equal(c.host, '0.0.0.0');
    assert.equal(c.dataDir, '/tmp/board-x');
    assert.equal(c.chromePath, '/usr/bin/chromium');
    assert.equal(c.provider.baseUrl, 'https://api.example/v1');
    assert.equal(c.provider.apiKey, 'sk-secret');
    assert.equal(c.provider.model, 'gpt-x');
    assert.equal(c.provider.agent, 'codex');
    assert.equal(c.providerEnabled, true);
  });

  // AC 1 — empty/whitespace string is treated as UNSET (the HOST="" security trap)
  it('treats empty/whitespace HOST and PORT as unset (not bind-all)', () => {
    assert.equal(loadConfig({ HOST: '' }).host, '127.0.0.1');
    assert.equal(loadConfig({ HOST: '   ' }).host, '127.0.0.1');
    assert.equal(loadConfig({ PORT: '' }).port, 3141);
  });

  // AC 4 — malformed value fails fast with a named error
  it('throws a clear, key-naming error on a malformed PORT', () => {
    assert.throws(() => loadConfig({ PORT: 'abc' }), /PORT/);
    assert.throws(() => loadConfig({ PORT: '-5' }), /PORT/);
    assert.throws(() => loadConfig({ PORT: '70000' }), /PORT/);
  });

  // AC 5 — the provider key never leaks into logs/serialized config
  it('redacts the provider API key in all serialization surfaces', () => {
    const c = loadConfig({ LLM_API_KEY: 'sk-supersecret-zzz' });
    assert.doesNotMatch(JSON.stringify(c), /sk-supersecret-zzz/);
    assert.doesNotMatch(inspect(c), /sk-supersecret-zzz/);
    assert.doesNotMatch(String(c), /sk-supersecret-zzz/);
    assert.doesNotMatch(`${c}`, /sk-supersecret-zzz/);
    // ...but the real key is still programmatically reachable for Epic 4.
    assert.equal(c.provider.apiKey, 'sk-supersecret-zzz');
  });

  // Provider env legacy aliases (keep the prototype CLI path working)
  it('folds legacy BOARD_ANALYSIS_AGENT / model env as provider aliases', () => {
    const c = loadConfig({ BOARD_ANALYSIS_AGENT: 'claude', BOARD_CLAUDE_MODEL: 'claude-x' });
    assert.equal(c.provider.agent, 'claude');
    assert.equal(c.provider.model, 'claude-x');
    assert.equal(c.providerEnabled, true);
    const codex = loadConfig({ BOARD_ANALYSIS_AGENT: 'codex', BOARD_CODEX_MODEL: 'codex-y' });
    assert.equal(codex.provider.model, 'codex-y');
    // explicit LLM_* wins over the legacy alias
    assert.equal(loadConfig({ BOARD_ANALYSIS_AGENT: 'claude', LLM_AGENT: 'codex' }).provider.agent, 'codex');
  });
});
