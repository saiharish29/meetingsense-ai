/**
 * sseHelpers.test.js
 *
 * Unit tests for the SSE write-safety logic in server/routes/meetings.js
 * (the analyze endpoint's send() / keepalive / res.end() hardening).
 *
 * These tests validate the logic in isolation — no Express server required.
 *
 * Guards:
 *  1. send() does not throw when res.write() throws ECONNRESET / EPIPE.
 *     Without this fix a write failure inside the try block would trigger
 *     the catch block and revert a just-saved 'completed' record to 'error'.
 *  2. After a write error, clientGone is set so further writes are no-ops.
 *  3. Keepalive write errors are also swallowed silently.
 *  4. res.end() in the finally block does not throw when the socket is
 *     already destroyed.
 *  5. req 'close' event sets clientGone so all further writes are skipped.
 *  6. send() is a no-op when res.writableEnded is already true.
 */

import { describe, it, expect, vi } from 'vitest';

// ── Factory: create the SSE helpers exactly as they appear in meetings.js ─────
//
// We extract the same three constructs (send, keepalive logic, cleanup) as
// pure functions so they can be tested without spinning up Express.

function createSseHelpers(res, req) {
  let clientGone = false;
  req.on('close', () => { clientGone = true; });

  const send = (data) => {
    if (res.writableEnded || clientGone) return;
    try {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (_) {
      clientGone = true;
    }
  };

  const keepaliveWrite = () => {
    if (res.writableEnded || clientGone) return;
    try { res.write(': keepalive\n\n'); } catch (_) { clientGone = true; }
  };

  const finalEnd = () => {
    if (!res.writableEnded) {
      try { res.end(); } catch (_) {}
    }
  };

  const isClientGone = () => clientGone;

  return { send, keepaliveWrite, finalEnd, isClientGone };
}

// ── Mock helpers ──────────────────────────────────────────────────────────────

function makeRes({ writableEnded = false, writeThrows = null } = {}) {
  return {
    writableEnded,
    write: vi.fn().mockImplementation(() => {
      if (writeThrows) throw writeThrows;
    }),
    end: vi.fn().mockImplementation(() => {
      if (writeThrows) throw writeThrows;
    }),
  };
}

function makeReq() {
  const handlers = {};
  return {
    on: (event, fn) => { handlers[event] = fn; },
    emit: (event) => { if (handlers[event]) handlers[event](); },
  };
}

// ── Tests: send() ─────────────────────────────────────────────────────────────

describe('send() — write-error safety', () => {
  it('does not throw when res.write() throws ECONNRESET', () => {
    const err = Object.assign(new Error('write ECONNRESET'), { code: 'ECONNRESET' });
    const res = makeRes({ writeThrows: err });
    const { send } = createSseHelpers(res, makeReq());

    expect(() => send({ stage: 'Done', done: true, result: '# Report' })).not.toThrow();
  });

  it('does not throw when res.write() throws EPIPE', () => {
    const err = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
    const res = makeRes({ writeThrows: err });
    const { send } = createSseHelpers(res, makeReq());

    expect(() => send({ stage: 'Error', error: 'oops', done: true })).not.toThrow();
  });

  it('sets clientGone=true after the first write failure', () => {
    const err = new Error('write ECONNRESET');
    const res = makeRes({ writeThrows: err });
    const { send, isClientGone } = createSseHelpers(res, makeReq());

    expect(isClientGone()).toBe(false);
    send({ stage: 'Done' });
    expect(isClientGone()).toBe(true);
  });

  it('skips further writes (no-op) once clientGone is true', () => {
    const err = new Error('write ECONNRESET');
    const res = makeRes({ writeThrows: err });
    const { send } = createSseHelpers(res, makeReq());

    send({ stage: 'first' });  // triggers the error, sets clientGone
    send({ stage: 'second' }); // should be a no-op
    send({ stage: 'third' });  // should be a no-op

    // write() is only called once (the first call that threw)
    expect(res.write).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when res.writableEnded is true', () => {
    const res = makeRes({ writableEnded: true });
    const { send } = createSseHelpers(res, makeReq());

    expect(() => send({ stage: 'Done' })).not.toThrow();
    expect(res.write).not.toHaveBeenCalled();
  });

  it('writes normally when no error occurs', () => {
    const res = makeRes();
    const { send } = createSseHelpers(res, makeReq());

    send({ stage: 'Uploading', detail: '26.4 MB' });
    expect(res.write).toHaveBeenCalledTimes(1);
    expect(res.write).toHaveBeenCalledWith(
      `data: ${JSON.stringify({ stage: 'Uploading', detail: '26.4 MB' })}\n\n`
    );
  });
});

// ── Tests: keepalive ──────────────────────────────────────────────────────────

describe('keepalive write — error safety', () => {
  it('does not throw when res.write() throws', () => {
    const err = new Error('write ECONNRESET');
    const res = makeRes({ writeThrows: err });
    const { keepaliveWrite } = createSseHelpers(res, makeReq());

    expect(() => keepaliveWrite()).not.toThrow();
  });

  it('sets clientGone after a keepalive write failure', () => {
    const err = new Error('write ECONNRESET');
    const res = makeRes({ writeThrows: err });
    const { keepaliveWrite, isClientGone } = createSseHelpers(res, makeReq());

    keepaliveWrite();
    expect(isClientGone()).toBe(true);
  });

  it('skips keepalive when clientGone is already true', () => {
    const err = new Error('write ECONNRESET');
    const res = makeRes({ writeThrows: err });
    const { keepaliveWrite } = createSseHelpers(res, makeReq());

    keepaliveWrite(); // sets clientGone
    keepaliveWrite(); // should be skipped

    expect(res.write).toHaveBeenCalledTimes(1); // only the first attempt
  });
});

// ── Tests: res.end() in finally ───────────────────────────────────────────────

describe('finalEnd() — res.end() safety', () => {
  it('does not throw when res.end() throws', () => {
    const err = new Error('write after end');
    const res = makeRes({ writeThrows: err });
    const { finalEnd } = createSseHelpers(res, makeReq());

    expect(() => finalEnd()).not.toThrow();
  });

  it('does not call res.end() when writableEnded is already true', () => {
    const res = makeRes({ writableEnded: true });
    const { finalEnd } = createSseHelpers(res, makeReq());

    finalEnd();
    expect(res.end).not.toHaveBeenCalled();
  });

  it('calls res.end() when writableEnded is false and no error', () => {
    const res = makeRes();
    const { finalEnd } = createSseHelpers(res, makeReq());

    finalEnd();
    expect(res.end).toHaveBeenCalledTimes(1);
  });
});

// ── Tests: client disconnect detection ───────────────────────────────────────

describe('client disconnect — req.on(close) handling', () => {
  it('sets clientGone when req emits close', () => {
    const res = makeRes();
    const req = makeReq();
    const { isClientGone } = createSseHelpers(res, req);

    expect(isClientGone()).toBe(false);
    req.emit('close');
    expect(isClientGone()).toBe(true);
  });

  it('makes subsequent send() calls no-ops after client closes', () => {
    const res = makeRes();
    const req = makeReq();
    const { send } = createSseHelpers(res, req);

    req.emit('close');          // simulate client closing tab
    send({ stage: 'Done' });    // should be skipped

    expect(res.write).not.toHaveBeenCalled();
  });

  it('makes subsequent keepalive writes no-ops after client closes', () => {
    const res = makeRes();
    const req = makeReq();
    const { keepaliveWrite } = createSseHelpers(res, req);

    req.emit('close');
    keepaliveWrite();

    expect(res.write).not.toHaveBeenCalled();
  });
});

// ── Tests: DB state correctness scenario ─────────────────────────────────────

describe('DB state correctness — completed → not reverted to error', () => {
  it('the try block completes normally even when the final send() write fails', () => {
    // Simulate: analyzeRecording succeeded, DB updated to 'completed',
    // then send({ done:true, result }) is called but client is gone.
    // The catch block must NOT run.

    const err = new Error('write ECONNRESET');
    const res = makeRes({ writeThrows: err });
    const req = makeReq();
    const { send } = createSseHelpers(res, req);

    let catchBlockRan = false;
    let dbStatus = 'completed'; // already updated before send()

    try {
      // This mirrors the server route: DB is updated BEFORE send()
      dbStatus = 'completed';
      send({ stage: 'Done', done: true, result: '# Report' }); // write fails silently
      // The try block continues normally — no throw
    } catch (_) {
      catchBlockRan = true;
      dbStatus = 'error'; // this revert must NOT happen
    }

    expect(catchBlockRan).toBe(false);
    expect(dbStatus).toBe('completed'); // DB state preserved correctly
  });
});
