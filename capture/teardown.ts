import { once } from 'node:events';

// Story 6.5 — guaranteed browser teardown with force-kill on timeout.
//
// The prototype only `close()`s (no kill, no timeout) — a wedged Chrome would leak
// ~500MB and OOM the 512MB box. On the timeout/abort path a plain `close()` may
// itself hang on a stuck page, so we SIGKILL the process and AWAIT its `exit`. The
// returned teardown is memoized and AWAITABLE (kill() is sync fire-and-forget), so
// the worker can hold the slot until the browser is confirmed dead before launching
// the next capture (the 5.1↔6.5 ordering contract — two Chromiums never coexist).

export interface CaptureProcess {
  kill(signal?: string): unknown;
  once(event: 'exit', listener: (...args: unknown[]) => void): unknown;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
}

export interface TeardownBrowser {
  close(): Promise<void> | void;
  /** puppeteer Browser.process() — the underlying ChildProcess (or null). */
  process?(): CaptureProcess | null | undefined;
}

// Bounded wait for the killed process's `exit` so a missed/never-firing exit event
// (e.g. an OOM-kill that fired exit BEFORE we attached the listener, or a D-state
// process) can NEVER hang the single-writer worker forever (BLOCKER fix).
const EXIT_WAIT_MS = 5_000;
type SetTimer = (cb: () => void, ms: number) => () => void;
const defaultSetTimer: SetTimer = (cb, ms) => {
  const t = setTimeout(cb, ms);
  if (typeof t.unref === 'function') t.unref();
  return () => clearTimeout(t);
};

async function awaitExitBounded(proc: CaptureProcess, opts: { exitWaitMs?: number; setTimer?: SetTimer }): Promise<void> {
  const waitMs = opts.exitWaitMs ?? EXIT_WAIT_MS;
  const setTimer = opts.setTimer ?? defaultSetTimer;
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => { if (done) return; done = true; cancel(); resolve(); };
    const cancel = setTimer(finish, waitMs); // proceed even if exit never fires
    Promise.resolve(once(proc as never, 'exit')).then(finish, finish);
  });
}

/**
 * Build a memoized teardown for a launched browser (or an in-flight launch Promise —
 * so a timeout DURING launch still tears down what eventually spawns). Calling it:
 *  - if the capture was ABORTED (timeout): SIGKILL the process and `await exit`
 *    (BOUNDED — never hangs the worker) — because `close()` can hang on a wedged page;
 *  - otherwise: just `close()`.
 * Memoized: repeated calls (abort handler, the work's `finally`, the job teardown)
 * all await the SAME completion and tear down exactly once.
 */
export function createBrowserTeardown(
  browserOrLaunch: TeardownBrowser | Promise<TeardownBrowser>,
  signal?: AbortSignal,
  opts: { exitWaitMs?: number; setTimer?: SetTimer } = {},
): () => Promise<void> {
  let started: Promise<void> | undefined;
  return () =>
    (started ??= (async () => {
      // Await the launch if it's still in flight (closes the launch-window race).
      const browser = await Promise.resolve(browserOrLaunch).catch(() => null);
      if (!browser) return;
      const proc = signal?.aborted ? (browser.process?.() ?? null) : null;
      if (proc) {
        // Aborted (timeout): SIGKILL + bounded await exit. Do NOT await close() — on a
        // wedged page close() is exactly what hangs, which is why we kill instead.
        try {
          proc.kill('SIGKILL');
        } catch {
          /* already gone */
        }
        await awaitExitBounded(proc, opts);
        return;
      }
      // Normal path: a clean close.
      try {
        await browser.close();
      } catch {
        /* ignore */
      }
    })());
}
