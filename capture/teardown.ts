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

/**
 * Build a memoized teardown for a launched browser. Calling it:
 *  - if the capture was ABORTED (timeout): SIGKILL the process and `await once(proc,
 *    'exit')` — because `close()` can hang on a wedged page and `kill()` is sync
 *    fire-and-forget — then also `close()` (no-op once dead);
 *  - otherwise: just `close()`.
 * Memoized: repeated calls (abort handler, the work's `finally`, the job teardown)
 * all await the SAME completion and tear down exactly once.
 */
export function createBrowserTeardown(browser: TeardownBrowser, signal?: AbortSignal): () => Promise<void> {
  let started: Promise<void> | undefined;
  return () =>
    (started ??= (async () => {
      const proc = signal?.aborted ? (browser.process?.() ?? null) : null;
      if (proc) {
        // Aborted (timeout): SIGKILL + await exit. Do NOT await close() — on a wedged
        // page close() is exactly what hangs, which is why we kill instead.
        try {
          proc.kill('SIGKILL');
        } catch {
          /* already gone */
        }
        try {
          await once(proc as never, 'exit');
        } catch {
          /* ignore */
        }
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
