import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { formatSseEvent, StatusHub, startSseStream, type StatusEvent } from './sse.js';

const evt: StatusEvent = { itemId: 'i1', boardId: 'b1', status: 'done', fields: { summary: 'hi' } };

describe('SSE formatting + hub (Story 5.3)', () => {
  // AC 1/4 — the pinned framing + payload contract
  it('formats an SSE frame with event: status and a JSON data line', () => {
    const frame = formatSseEvent(evt);
    assert.match(frame, /^event: status\n/);
    assert.match(frame, /\n\n$/);
    const dataLine = frame.split('\n').find((l) => l.startsWith('data: '))!;
    const payload = JSON.parse(dataLine.slice('data: '.length));
    assert.deepEqual(payload, { itemId: 'i1', boardId: 'b1', status: 'done', fields: { summary: 'hi' } });
  });

  it('publishes a frame to subscribers and filters by boardId', () => {
    const hub = new StatusHub();
    const a: string[] = [];
    const b: string[] = [];
    hub.subscribe({ write: (s) => a.push(s) }); // all boards
    hub.subscribe({ write: (s) => b.push(s) }, 'other-board'); // only "other-board"
    hub.publish(evt);
    assert.equal(a.length, 1, 'unfiltered subscriber receives the event');
    assert.equal(b.length, 0, 'board-filtered subscriber does NOT receive a different board');
  });

  // AC 5 — disconnect cleanup: a removed subscriber is never written to again
  it('removes a subscriber on unsubscribe and never writes to it again', () => {
    const hub = new StatusHub();
    const got: string[] = [];
    const unsub = hub.subscribe({ write: (s) => got.push(s) });
    hub.publish(evt);
    assert.equal(got.length, 1);
    unsub();
    assert.equal(hub.size(), 0, 'subscriber removed');
    hub.publish(evt);
    assert.equal(got.length, 1, 'no write to a removed subscriber');
  });

  it('drops a subscriber whose write throws (dead stream)', () => {
    const hub = new StatusHub();
    hub.subscribe({ write: () => { throw new Error('EPIPE'); } });
    hub.publish(evt); // must not throw
    assert.equal(hub.size(), 0, 'a throwing (dead) sink is dropped');
  });
});

describe('startSseStream (Story 5.3)', () => {
  // AC 3/4/5 — hijack + headers + framing + cleanup, via fake req/reply (no socket)
  it('hijacks, sets text/event-stream, streams events, and cleans up on close', () => {
    const hub = new StatusHub();
    let hijacked = false;
    let head: { code: number; headers: Record<string, string> } | undefined;
    const writes: string[] = [];
    let closeHandler: (() => void) | undefined;

    const reply = {
      hijack: () => { hijacked = true; },
      raw: {
        writeHead: (code: number, headers: Record<string, string>) => { head = { code, headers }; },
        write: (s: string) => writes.push(s),
      },
    };
    const req = { raw: { on: (ev: string, cb: () => void) => { if (ev === 'close') closeHandler = cb; } } };

    startSseStream(req as never, reply as never, hub);

    assert.equal(hijacked, true, 'must hijack the socket out of Fastify');
    assert.equal(head?.code, 200);
    assert.equal(head?.headers['Content-Type'], 'text/event-stream');

    hub.publish(evt);
    assert.ok(writes.some((w) => w.startsWith('event: status')), 'transition streamed to the client');

    // disconnect → removed from the hub; later emit does not write
    const writesBefore = writes.length;
    closeHandler?.();
    assert.equal(hub.size(), 0);
    hub.publish(evt);
    assert.equal(writes.length, writesBefore, 'no write to a closed stream');
  });
});
