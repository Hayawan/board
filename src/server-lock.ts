import net from 'node:net';

// Follow-up (16.3) — cross-process coordination for the maintenance CLIs. The
// concurrency-1 / single-Chrome guarantee (NFR-1) is PER-PROCESS, so a backfill CLI run
// alongside the live server would put two Chromiums on the box. The server binds its
// port, so a successful TCP connect to that port means "a server is up — don't launch a
// second Chrome." (A heuristic, not a hard lock: it can't tell the board server apart
// from anything else on the port, but on a single-purpose box that's exactly the signal.)

/** Resolve true if a TCP listener accepts a connection on host:port within timeoutMs. */
export function isServerListening(host: string, port: number, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (result: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    // 0.0.0.0 (bind-all) isn't directly connectable on every platform — probe loopback.
    socket.connect(port, host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host);
  });
}
