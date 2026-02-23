/**
 * analyzeWithServer.test.ts
 *
 * Unit tests for src/services/api.ts → analyzeWithServer().
 *
 * Critical regressions guarded:
 *  1. Timeout is 25 minutes (not 10). The previous 10-min value caused
 *     large recordings (26+ MB, 28+ min) to abort before Gemini finished.
 *  2. SSE stream is parsed correctly end-to-end.
 *  3. Server-sent error events are surfaced to the caller.
 *  4. Malformed / comment SSE lines are silently skipped.
 *  5. clearTimeout is always called (no timer leaks).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { analyzeWithServer } from '../services/api';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a ReadableStream that emits the concatenated SSE event strings. */
function sseStream(events: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const body = events.join('');
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });
}

/** Stub global fetch to return an SSE response with the given events. */
function mockSseResponse(events: string[], status = 200) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    body: sseStream(events),
    json: async () => ({ error: `HTTP ${status}` }),
  }));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ── Timeout Configuration (the regression) ───────────────────────────────────

describe('analyzeWithServer — timeout configuration', () => {
  it('registers a 25-minute timeout (1 500 000 ms), not a 10-minute one', () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(globalThis, 'setTimeout');

    // Fetch never resolves so the SSE loop runs indefinitely
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));

    // Fire-and-forget; we only care about the setTimeout call
    analyzeWithServer('meeting-1', null);

    // Find the AbortController timeout (the only call with a long delay)
    const abortTimerCall = spy.mock.calls.find(([, delay]) => delay === 25 * 60 * 1000);
    expect(abortTimerCall).toBeDefined();

    // Confirm the old 10-minute value was NOT used
    const oldTimerCall = spy.mock.calls.find(([, delay]) => delay === 10 * 60 * 1000);
    expect(oldTimerCall).toBeUndefined();
  });

  it('does NOT abort the fetch signal before 25 minutes have elapsed', async () => {
    vi.useFakeTimers();
    let aborted = false;

    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url: string, opts: RequestInit) => {
      opts.signal!.addEventListener('abort', () => { aborted = true; });
      return new Promise(() => {}); // Never resolves
    }));

    analyzeWithServer('meeting-1', null); // fire-and-forget

    // Advance to exactly the old (wrong) 10-minute mark — must NOT abort
    vi.advanceTimersByTime(10 * 60 * 1000);
    await Promise.resolve();
    expect(aborted).toBe(false);

    // Advance to 24 min 59 sec — still must NOT abort
    vi.advanceTimersByTime(14 * 60 * 1000 + 59 * 1000);
    await Promise.resolve();
    expect(aborted).toBe(false);
  });

  it('aborts the fetch signal after 25 minutes have elapsed', async () => {
    vi.useFakeTimers();
    let aborted = false;

    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url: string, opts: RequestInit) => {
      opts.signal!.addEventListener('abort', () => { aborted = true; });
      return new Promise(() => {});
    }));

    analyzeWithServer('meeting-1', null);

    // Advance exactly 25 minutes + 1 ms
    vi.advanceTimersByTime(25 * 60 * 1000 + 1);
    await Promise.resolve();
    expect(aborted).toBe(true);
  });
});

// ── Success Path ──────────────────────────────────────────────────────────────

describe('analyzeWithServer — success path', () => {
  it('returns the result from a done event', async () => {
    mockSseResponse([
      'data: {"stage":"Starting","detail":"Model: gemini-2.5-flash","percent":5}\n\n',
      'data: {"stage":"Analyzing","detail":"Waiting for Gemini..."}\n\n',
      'data: {"done":true,"result":"# Report\\nFull details here.","percent":100}\n\n',
    ]);

    const result = await analyzeWithServer('meeting-1', null);
    expect(result).toBe('# Report\nFull details here.');
  });

  it('calls onProgress for each stage event (not for the done event)', async () => {
    mockSseResponse([
      'data: {"stage":"Uploading audio","detail":"26.4 MB"}\n\n',
      'data: {"stage":"Processing images","detail":"27 image(s)"}\n\n',
      'data: {"done":true,"result":"# Report"}\n\n',
    ]);

    const onProgress = vi.fn();
    await analyzeWithServer('meeting-1', null, onProgress);

    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenNthCalledWith(1, 'Uploading audio', '26.4 MB');
    expect(onProgress).toHaveBeenNthCalledWith(2, 'Processing images', '27 image(s)');
  });

  it('invokes clearTimeout in the finally block on success (no timer leak)', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    mockSseResponse(['data: {"done":true,"result":"# Report"}\n\n']);

    await analyzeWithServer('meeting-1', null);
    expect(clearSpy).toHaveBeenCalled();
  });

  it('passes model to request body when provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: sseStream(['data: {"done":true,"result":"r"}\n\n']),
    });
    vi.stubGlobal('fetch', fetchMock);

    await analyzeWithServer('meeting-1', 'gemini-2.5-pro');

    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string);
    expect(body.model).toBe('gemini-2.5-pro');
  });

  it('omits model from body when null is passed', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: sseStream(['data: {"done":true,"result":"r"}\n\n']),
    });
    vi.stubGlobal('fetch', fetchMock);

    await analyzeWithServer('meeting-1', null);

    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string);
    expect(body.model).toBeUndefined();
  });
});

// ── Error Paths ───────────────────────────────────────────────────────────────

describe('analyzeWithServer — error paths', () => {
  it('throws the server error message when a done+error event is received', async () => {
    mockSseResponse([
      'data: {"stage":"Error","error":"Daily quota exhausted.","done":true}\n\n',
    ]);

    await expect(analyzeWithServer('meeting-1', null))
      .rejects.toThrow('Daily quota exhausted.');
  });

  it('throws when the HTTP status is non-2xx (e.g. 404)', async () => {
    mockSseResponse([], 404);
    await expect(analyzeWithServer('meeting-1', null)).rejects.toThrow();
  });

  it('throws when stream ends with no done event', async () => {
    mockSseResponse([
      'data: {"stage":"Analyzing"}\n\n',
      // No done event — stream just closes
    ]);

    await expect(analyzeWithServer('meeting-1', null))
      .rejects.toThrow('Analysis stream ended unexpectedly without a result.');
  });

  it('throws when done event contains neither result nor error', async () => {
    mockSseResponse(['data: {"done":true}\n\n']);

    await expect(analyzeWithServer('meeting-1', null))
      .rejects.toThrow('Analysis stream ended without a result.');
  });

  it('invokes clearTimeout in the finally block on error (no timer leak)', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    mockSseResponse(['data: {"error":"boom","done":true}\n\n']);

    await expect(analyzeWithServer('meeting-1', null)).rejects.toThrow('boom');
    expect(clearSpy).toHaveBeenCalled();
  });
});

// ── SSE Stream Robustness ─────────────────────────────────────────────────────

describe('analyzeWithServer — SSE stream robustness', () => {
  it('skips malformed JSON lines and still processes valid ones', async () => {
    mockSseResponse([
      'data: {not valid json at all}\n\n',
      'data: {"stage":"Analyzing"}\n\n',
      'data: {"done":true,"result":"# Report"}\n\n',
    ]);

    const result = await analyzeWithServer('meeting-1', null);
    expect(result).toBe('# Report');
  });

  it('skips SSE comment lines (keepalive) without error', async () => {
    mockSseResponse([
      ': keepalive\n\n',
      ': keepalive\n\n',
      'data: {"done":true,"result":"# Report"}\n\n',
    ]);

    const result = await analyzeWithServer('meeting-1', null);
    expect(result).toBe('# Report');
  });

  it('skips empty lines between events', async () => {
    mockSseResponse([
      '\n',
      '\n',
      'data: {"done":true,"result":"# Report"}\n\n',
    ]);

    const result = await analyzeWithServer('meeting-1', null);
    expect(result).toBe('# Report');
  });

  it('handles a large payload (many progress events before done)', async () => {
    const events = Array.from({ length: 50 }, (_, i) =>
      `data: {"stage":"Step ${i + 1}"}\n\n`
    );
    events.push('data: {"done":true,"result":"# Long Report"}\n\n');

    mockSseResponse(events);

    const onProgress = vi.fn();
    const result = await analyzeWithServer('meeting-1', null, onProgress);

    expect(result).toBe('# Long Report');
    expect(onProgress).toHaveBeenCalledTimes(50);
  });
});
