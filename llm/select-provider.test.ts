import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';

import { loadConfig } from '../config.js';
import { disabledLlm, EnrichmentDisabledError } from '../skills/types.js';
import { HttpProvider } from './http-provider.js';
import { CliProvider } from './cli-provider.js';
import { selectProvider } from './select-provider.js';

describe('selectProvider (Story 4.4)', () => {
  // AC 1/3/6 — no provider config → disabledLlm (the C10 no-AI default)
  it('returns disabledLlm when no provider is configured', () => {
    assert.equal(selectProvider(loadConfig({})), disabledLlm);
  });

  // AC 2/6 — HTTP config → HttpProvider
  it('returns HttpProvider for HTTP config (base-URL + model)', () => {
    const p = selectProvider(loadConfig({ LLM_BASE_URL: 'http://x/v1', LLM_MODEL: 'm', LLM_API_KEY: 'k' }));
    assert.ok(p instanceof HttpProvider);
  });

  // AC 2/6 — CLI config → CliProvider (claude/codex)
  it('returns CliProvider for a CLI agent', () => {
    assert.ok(selectProvider(loadConfig({ LLM_AGENT: 'claude' })) instanceof CliProvider);
    assert.ok(selectProvider(loadConfig({ LLM_AGENT: 'codex', LLM_MODEL: 'o4' })) instanceof CliProvider);
  });

  // AC 4 — both configured → HTTP wins (documented precedence), asserted
  it('prefers HttpProvider when BOTH HTTP and CLI are configured', () => {
    const p = selectProvider(loadConfig({ LLM_BASE_URL: 'http://x/v1', LLM_MODEL: 'm', LLM_AGENT: 'claude' }));
    assert.ok(p instanceof HttpProvider, 'explicit HTTP base-URL wins over CLI');
  });

  // graceful: an unknown/unsupported agent must not break boot → disabledLlm
  it('returns disabledLlm for an unknown CLI agent (e.g. cursor, out of scope)', () => {
    assert.equal(selectProvider(loadConfig({ LLM_AGENT: 'cursor' })), disabledLlm);
  });

  // HTTP needs a model — base-URL alone (no model, no agent) → disabledLlm
  it('returns disabledLlm when base-URL is set without a model', () => {
    assert.equal(selectProvider(loadConfig({ LLM_BASE_URL: 'http://x/v1' })), disabledLlm);
  });

  // AC 5 — disabledLlm.complete THROWS the typed error (the degrade is Story 5.2's)
  it('disabledLlm.complete throws EnrichmentDisabledError', async () => {
    await assert.rejects(
      () => disabledLlm.complete('p', z.object({})),
      (e: unknown) => e instanceof EnrichmentDisabledError,
    );
  });
});
