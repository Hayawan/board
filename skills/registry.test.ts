import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';

import { defineSkill, disabledLlm, EnrichmentDisabledError, buildCtx, type Ctx } from './types.js';
import { createRegistry } from './registry.js';

// A spy ctx: db/llm/queue/logger are all fakes — the test module imports NO real
// db/llm/queue singleton, so a skill reaching a global is impossible by construction
// (this is the structural "no global" proof; AC 6).
function spyCtx(): { ctx: Ctx; calls: { log: string[]; enqueued: number } } {
  const calls = { log: [] as string[], enqueued: 0 };
  const ctx = buildCtx({
    db: {} as never,
    queue: {
      enqueueWrite: async <T>(fn: () => T | Promise<T>) => {
        calls.enqueued += 1;
        return fn();
      },
    },
    logger: { info: (m) => calls.log.push(m), warn: () => {}, error: () => {} },
  });
  return { ctx, calls };
}

const echoSkill = defineSkill(
  'echo',
  z.object({ value: z.string() }),
  z.object({ echoed: z.string() }),
  async (input, ctx) => {
    // CALLS ctx collaborators (positive injection proof — not a passthrough).
    ctx.logger.info(`echo:${input.value}`);
    await ctx.queue.enqueueWrite(() => undefined);
    return { echoed: input.value };
  },
);

describe('skill registry (Story 3.1)', () => {
  // AC 1 — defineSkill infers I/O from the zod schemas
  it('defines a skill with inferred schemas', () => {
    assert.equal(echoSkill.name, 'echo');
    assert.ok(echoSkill.inputSchema instanceof z.ZodType);
    assert.ok(echoSkill.outputSchema instanceof z.ZodType);
  });

  // AC 6 — ctx injection works positively (spy receives the call)
  it('runs a skill against an injected ctx whose collaborators are actually called', async () => {
    const { ctx, calls } = spyCtx();
    const out = await echoSkill.run({ value: 'hi' }, ctx);
    assert.deepEqual(out, { echoed: 'hi' });
    assert.deepEqual(calls.log, ['echo:hi'], 'ctx.logger.info must have been invoked');
    assert.equal(calls.enqueued, 1, 'ctx.queue.enqueueWrite must have been invoked');
  });

  // AC 4 — fresh registry per test (factory, not a module-global)
  it('registers and resolves a skill in a fresh registry', () => {
    const reg = createRegistry();
    reg.register(echoSkill);
    assert.equal(reg.get('echo'), echoSkill);
    assert.deepEqual(reg.list().map((s) => s.name), ['echo']);
  });

  // AC 3 — get returns undefined on a miss (the route owns the 404)
  it('returns undefined for an unknown skill name (does not throw)', () => {
    const reg = createRegistry();
    assert.equal(reg.get('nope'), undefined);
  });

  // registration-time dup guard (the processors.ts footgun this avoids)
  it('throws when registering a duplicate skill name', () => {
    const reg = createRegistry();
    reg.register(echoSkill);
    assert.throws(() => reg.register(echoSkill), /echo|duplicate|already/i);
  });

  // AC 5 — disabledLlm is a real LLMProvider whose complete THROWS the typed error
  it('disabledLlm.complete throws EnrichmentDisabledError (throwing sentinel, not null)', async () => {
    await assert.rejects(
      () => disabledLlm.complete('prompt', z.object({})),
      (err: unknown) => err instanceof EnrichmentDisabledError,
    );
  });

  // AC 5 — ctx.llm defaults to disabledLlm (never null)
  it('buildCtx defaults llm to disabledLlm (never null)', () => {
    const { ctx } = spyCtx();
    assert.equal(ctx.llm, disabledLlm);
  });
});
