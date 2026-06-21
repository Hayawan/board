import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { eq } from 'drizzle-orm';

import { initDb } from '../db/index.js';
import { boards, items } from '../db/schema.js';
import { enqueueJob, runItemJob, type Job, type TimeoutFn } from '../db/queue.js';
import { createBrowserTeardown, type TeardownBrowser } from './teardown.js';

function deferred<T = void>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
const tick = () => new Promise((r) => setImmediate(r));
const neverFires: TimeoutFn = () => () => {};
function manualTimeout(): { fn: TimeoutFn; fire: () => void } {
  let cb: (() => void) | null = null;
  return { fn: (c) => { cb = c; return () => (cb = null); }, fire: () => cb?.() };
}

// A fake browser: process() returns an EventEmitter that emits 'exit' after kill().
function fakeBrowser(opts: { closeHangs?: boolean; close?: Promise<void> }) {
  const proc = new EventEmitter() as EventEmitter & { kill: (s?: string) => boolean; killed: boolean };
  proc.killed = false;
  proc.kill = () => { proc.killed = true; setImmediate(() => proc.emit('exit', 0)); return true; };
  const browser: TeardownBrowser = {
    close: async () => {
      if (opts.closeHangs) return new Promise<void>(() => {}); // never resolves
      if (opts.close) return opts.close;
    },
    process: () => proc,
  };
  return { browser, proc };
}

describe('createBrowserTeardown (Story 6.5)', () => {
  // AC 2/3 — on abort: SIGKILL + await the process exit (close may hang)
  it('force-kills a hung browser on abort and resolves on process exit', async () => {
    const controller = new AbortController();
    const { browser, proc } = fakeBrowser({ closeHangs: true });
    const teardown = createBrowserTeardown(browser, controller.signal);
    controller.abort();
    await teardown(); // resolves only after proc 'exit'
    assert.equal(proc.killed, true, 'a hung browser must be SIGKILL-ed');
  });

  // normal path: no abort → just close()
  it('closes (no kill) when not aborted', async () => {
    const { browser, proc } = fakeBrowser({ close: Promise.resolve() });
    const teardown = createBrowserTeardown(browser, new AbortController().signal);
    await teardown();
    assert.equal(proc.killed, false, 'a clean close must not kill');
  });

  // memoized — repeated calls tear down once
  it('is memoized (kills at most once)', async () => {
    const controller = new AbortController();
    const { browser, proc } = fakeBrowser({ closeHangs: true });
    let kills = 0;
    const realKill = proc.kill;
    proc.kill = (s) => { kills += 1; return realKill(s); };
    const teardown = createBrowserTeardown(browser, controller.signal);
    controller.abort();
    await Promise.all([teardown(), teardown(), teardown()]);
    assert.equal(kills, 1, 'teardown must run once');
  });
});

describe('capture concurrency 1 (Story 6.5)', () => {
  // AC 1/4 — the next capture does NOT launch until the prior teardown (close) completes
  it('does not launch capture-2 until capture-1 teardown completes', async () => {
    let launches = 0;
    const close1 = deferred();
    const mk = (closeP: Promise<void>): Job => ({
      type: 'capture',
      timeoutMs: 60_000,
      run: async () => {
        launches += 1; // "browser launched"
        await closeP; // finally-await-teardown holds the single slot
      },
    });
    const p1 = enqueueJob(mk(close1.promise), { timeoutFn: neverFires });
    const p2 = enqueueJob(mk(Promise.resolve()), { timeoutFn: neverFires });
    await tick();
    assert.equal(launches, 1, 'capture-2 must not launch while capture-1 holds the slot');
    close1.resolve();
    await Promise.all([p1, p2]);
    assert.equal(launches, 2);
  });

  // AC 1 (timeout path) — after a capture TIMES OUT, the next capture must not launch
  // until the timed-out capture's teardown (kill + exit) completes.
  it('does not launch the next capture until a timed-out capture teardown completes', async () => {
    const t = manualTimeout();
    const td = deferred(); // simulates kill+exit taking time
    let nextLaunched = false;

    const p1 = enqueueJob(
      { type: 'capture', timeoutMs: 50, run: () => new Promise<void>(() => {}), teardown: async () => { await td.promise; } },
      { timeoutFn: t.fn },
    );
    await tick();
    t.fire();
    await p1; // status resolved (timed out); the worker SLOT is held by teardown

    void enqueueJob({ type: 'capture', timeoutMs: 60_000, run: async () => { nextLaunched = true; } }, { timeoutFn: neverFires });
    await tick();
    assert.equal(nextLaunched, false, 'next capture must wait for the timed-out teardown');

    td.resolve();
    await tick();
    await tick();
    assert.equal(nextLaunched, true, 'next capture runs once teardown completes');
  });
});

describe('capture timeout → kill + error (Story 6.5)', () => {
  let dir: string;
  let handle: ReturnType<typeof initDb>;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'board-oss-conc-'));
    handle = initDb(join(dir, 'c.db'));
    handle.db.insert(boards).values({ id: 'b', name: 'B', view: 'grid' }).run();
    handle.db.insert(items).values({ id: 'hang', boardId: 'b', source: 'x' }).run();
  });
  after(() => { handle.sqlite.close(); rmSync(dir, { recursive: true, force: true }); });

  // AC 2 — a hung capture is force-killed and the item marked error
  it('force-kills a hung capture on timeout and marks the item error', async () => {
    const t = manualTimeout();
    const { browser, proc } = fakeBrowser({ closeHangs: true });
    let teardownFn: (() => Promise<void>) | undefined;

    const p = runItemJob(handle, {
      itemId: 'hang',
      type: 'capture',
      timeoutMs: 50,
      timeoutFn: t.fn,
      work: (signal) => {
        teardownFn = createBrowserTeardown(browser, signal);
        signal.addEventListener('abort', () => void teardownFn!(), { once: true });
        return new Promise<void>(() => {}); // hung capture
      },
      teardown: async () => { await teardownFn?.(); }, // worker awaits this before next capture
    });

    await tick();
    t.fire();
    await p;
    assert.equal(proc.killed, true, 'hung browser SIGKILL-ed');
    const row = handle.db.select().from(items).where(eq(items.id, 'hang')).get();
    assert.equal(row?.status, 'error');
    assert.equal(row?.errorReason, 'timed out');
  });
});
