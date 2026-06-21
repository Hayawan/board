import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';

import { LLMSchemaError, type LLMProvider } from './provider.js';

// Story 4.1 — the ONE shared provider-conformance suite. Both transports (4.2 HTTP,
// 4.3 CLI) run THIS via their own seam, so they're provably interchangeable — no
// per-transport "does it parse?" tests that drift.
//
// `makeProviderReturning(rawModelOutput)` builds a provider whose backend emits the
// given raw model-output string. The suite drives BOTH the valid and the
// schema-violating case in one run (a no-arg factory couldn't — it returns one
// fixed thing, forcing each transport to reimplement the failure case).

export interface ConformanceSeam {
  label: string;
  makeProviderReturning: (rawModelOutput: string) => LLMProvider;
}

export function runProviderConformance({ label, makeProviderReturning }: ConformanceSeam): void {
  describe(`LLMProvider conformance: ${label}`, () => {
    const schema = z.object({ title: z.string(), n: z.number() });

    // AC 2 — valid structured output → parsed, schema-valid object
    it('returns the parsed schema-valid object on valid output', async () => {
      const provider = makeProviderReturning('{"title":"ok","n":5}');
      const result = await provider.complete('prompt', schema);
      assert.deepEqual(result, { title: 'ok', n: 5 });
    });

    // AC 3 — schema mismatch → LLMSchemaError (instanceof, not string match)
    it('throws LLMSchemaError on schema-violating output', async () => {
      const provider = makeProviderReturning('{"title":"ok","n":"not-a-number"}');
      await assert.rejects(
        () => provider.complete('prompt', schema),
        (err: unknown) => err instanceof LLMSchemaError,
      );
    });
  });
}
