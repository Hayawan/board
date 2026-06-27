import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';

import { isServerListening } from './server-lock.js';

// Follow-up (16.3): the backfill CLI must refuse to run while the live server is up —
// concurrency-1 is per-process, so a second Chrome would risk the OOM NFR-1 guards against.
// isServerListening is the cross-process probe (the server binds its port).

function listenOn(): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port;
      resolve({ port, close: () => new Promise((r) => srv.close(() => r())) });
    });
  });
}

describe('isServerListening (backfill cross-process guard)', () => {
  it('returns true when something is listening on the port', async () => {
    const srv = await listenOn();
    try {
      assert.equal(await isServerListening('127.0.0.1', srv.port), true);
    } finally {
      await srv.close();
    }
  });

  it('returns false when the port is free', async () => {
    const srv = await listenOn();
    const port = srv.port;
    await srv.close(); // free the port
    assert.equal(await isServerListening('127.0.0.1', port), false);
  });

  it('treats 0.0.0.0 (bind-all) as localhost', async () => {
    const srv = await listenOn();
    try {
      assert.equal(await isServerListening('0.0.0.0', srv.port), true);
    } finally {
      await srv.close();
    }
  });
});
