import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';

import { buildServer } from './server.js';
import { createRegistry } from './skills/registry.js';
import { defineSkill } from './skills/types.js';

// Hermetic: a fresh registry of FAKE skills per server; no dependence on concrete
// skills (3.3/3.4). A fake db is injected so the route never opens the real DB.
const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

function serverWith(skills: ReturnType<typeof defineSkill>[]) {
  const registry = createRegistry();
  for (const s of skills) registry.register(s);
  return buildServer({ registry, db: {} as never, logger: silentLogger });
}

describe('generic /skills/:name route (Story 3.2)', () => {
  let runCount = 0;
  const echo = defineSkill(
    'echo',
    z.object({ value: z.string() }),
    z.object({ echoed: z.string() }),
    async (input) => {
      runCount += 1;
      return { echoed: input.value };
    },
  );
  const badOutput = defineSkill(
    'bad-output',
    z.object({}),
    z.object({ n: z.number() }),
    async () => ({ n: 'not-a-number' }) as never,
  );
  const throws = defineSkill('throws', z.object({}), z.object({}), async () => {
    throw new Error('secret internal detail at /Users/x/server.ts:42');
  });

  // AC 1 — valid body → parse, run, validate, return 200
  it('runs a registered skill and returns its validated output', async () => {
    const app = await serverWith([echo]);
    const res = await app.inject({
      method: 'POST',
      url: '/skills/echo',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'hi' }),
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body), { echoed: 'hi' });
  });

  // AC 2 — invalid body → 400 with the zod error, run NOT called
  it('returns 400 + zod error on invalid input and does not call run', async () => {
    runCount = 0;
    const app = await serverWith([echo]);
    const res = await app.inject({
      method: 'POST',
      url: '/skills/echo',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ wrong: 1 }),
    });
    assert.equal(res.statusCode, 400);
    const body = JSON.parse(res.body);
    assert.ok(body.issues || body.error, 'should include a structured validation error');
    assert.equal(runCount, 0, 'run must NOT be called when input is invalid');
  });

  // AC 3 — unknown skill → 404 (not 500)
  it('returns 404 for an unknown skill', async () => {
    const app = await serverWith([echo]);
    const res = await app.inject({ method: 'POST', url: '/skills/nope', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(res.statusCode, 404);
  });

  // AC 4 — output failing its own schema → 500 (server bug)
  it('returns 500 when a skill produces output failing its outputSchema', async () => {
    const app = await serverWith([badOutput]);
    const res = await app.inject({ method: 'POST', url: '/skills/bad-output', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(res.statusCode, 500);
  });

  // AC 5 — run throws → 500, handled, no stack leak
  it('returns 500 when run throws, without leaking a stack trace', async () => {
    const app = await serverWith([throws]);
    const res = await app.inject({ method: 'POST', url: '/skills/throws', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(res.statusCode, 500);
    assert.doesNotMatch(res.body, /server\.ts:42|secret internal detail/, 'must not leak the error stack/message');
  });
});
