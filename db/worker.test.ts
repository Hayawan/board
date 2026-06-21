import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { enqueueWrite, enqueueJob, type Job, type TimeoutFn } from './queue.js';

function deferred<T = void>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
const tick = () => new Promise((r) => setImmediate(r));
// a timeoutFn whose callback the test fires manually (deterministic, no real clock)
function manualTimeout(): { fn: TimeoutFn; fire: () => void } {
  let cb: (() => void) | null = null;
  return { fn: (c) => { cb = c; return () => (cb = null); }, fire: () => cb?.() };
}
const neverFires: TimeoutFn = () => () => {};

describe('job worker (Story 5.1)', () => {
  // AC 1/5 — serial: a job holds the slot across an await; active-count never > 1
  it('runs jobs serially (concurrency 1) — a parallel impl would hit active-count 2', async () => {
    let active = 0;
    let max = 0;
    const d1 = deferred();
    const d2 = deferred();
    const mk = (d: { promise: Promise<void> }): Job => ({
      type: 't',
      timeoutMs: 60_000,
      run: async () => {
        active += 1;
        max = Math.max(max, active);
        await d.promise; // hold the slot across an async boundary
        active -= 1;
      },
    });
    const p1 = enqueueJob(mk(d1), { timeoutFn: neverFires });
    const p2 = enqueueJob(mk(d2), { timeoutFn: neverFires });
    await tick();
    assert.equal(active, 1, 'only one job may run at a time');
    d1.resolve();
    await p1;
    d2.resolve();
    await p2;
    assert.equal(max, 1);
  });

  // AC 4/5 — no double serializer: a raw enqueueWrite and a job-write share one worker
  it('serializes a raw enqueueWrite against a job (combined active-count never > 1)', async () => {
    let active = 0;
    let max = 0;
    const dw = deferred();
    const dj = deferred();
    const pw = enqueueWrite(async () => {
      active += 1;
      max = Math.max(max, active);
      await dw.promise;
      active -= 1;
    });
    const pj = enqueueJob(
      { type: 't', timeoutMs: 60_000, run: async () => { active += 1; max = Math.max(max, active); await dj.promise; active -= 1; } },
      { timeoutFn: neverFires },
    );
    await tick();
    assert.equal(active, 1, 'a job and a raw write must not overlap');
    dw.resolve();
    await pw;
    dj.resolve();
    await pj;
    assert.equal(max, 1);
  });

  // AC 2/5 — timeout fires the abort signal, marks failed, and the queue proceeds
  it('times out a hung job: aborts, marks failed, proceeds to the next', async () => {
    const t = manualTimeout();
    let aborted = false;
    const hung: Job = {
      type: 'capture',
      timeoutMs: 50,
      run: (signal) => {
        signal.addEventListener('abort', () => (aborted = true));
        return new Promise<void>(() => {}); // never resolves
      },
    };
    const p = enqueueJob(hung, { timeoutFn: t.fn });
    await tick();
    t.fire();
    const res = await p;
    assert.equal(res.ok, false);
    assert.equal(res.timedOut, true);
    assert.equal(aborted, true, 'the abort signal must fire on timeout');

    // queue proceeds: a subsequent job still runs
    const ran: string[] = [];
    await enqueueJob({ type: 'next', timeoutMs: 60_000, run: async () => { ran.push('x'); } }, { timeoutFn: neverFires });
    assert.deepEqual(ran, ['x']);
  });

  // AC 3 — the 5.1<->6.5 seam: after a capture timeout, the next job must NOT start
  // until the timed-out job's teardown releases memory.
  it('holds the slot until teardown completes before starting the next job', async () => {
    const t = manualTimeout();
    const td = deferred();
    const cap: Job = {
      type: 'capture',
      timeoutMs: 50,
      run: () => new Promise<void>(() => {}),
      teardown: () => td.promise,
    };
    const pcap = enqueueJob(cap, { timeoutFn: t.fn });
    await tick();
    t.fire();
    const status = await pcap;
    assert.equal(status.timedOut, true, 'status is marked failed immediately');

    let nextStarted = false;
    void enqueueJob({ type: 'next', timeoutMs: 60_000, run: async () => { nextStarted = true; } }, { timeoutFn: neverFires });
    await tick();
    assert.equal(nextStarted, false, 'next job must wait for teardown to release memory');

    td.resolve();
    await tick();
    await tick();
    assert.equal(nextStarted, true, 'next job runs once teardown completes');
  });
});
