import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  RetryExhaustedError,
  fetchWithRetry,
  isTransientNetworkError,
  parseRetryAfterMs,
  withProxyRetry,
  type RetryOptions,
  type RetryRequestInit,
  type RetryResponseLike,
} from './retry.js';

interface MockResponse extends RetryResponseLike {
  status: number;
  headers?: { get(name: string): string | null } | Record<string, string>;
  body?: string;
}

function response(status: number, headers: Record<string, string> = {}): MockResponse {
  return { status, headers };
}

function sequenceFetch(outcomes: Array<MockResponse | Error>): {
  fetch: (input: string | URL, init?: RetryRequestInit) => Promise<MockResponse>;
  calls: Array<{ input: string; init?: RetryRequestInit }>;
} {
  const calls: Array<{ input: string; init?: RetryRequestInit }> = [];
  return {
    calls,
    fetch: async (input, init) => {
      calls.push({ input: String(input), ...(init === undefined ? {} : { init }) });
      const outcome = outcomes[Math.min(calls.length - 1, outcomes.length - 1)];
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
  };
}

function instantClock(): { options: RetryOptions; sleeps: number[] } {
  const sleeps: number[] = [];
  let virtualNow = 0;
  return {
    sleeps,
    options: {
      sleep: async (ms: number) => {
        sleeps.push(ms);
        virtualNow += ms;
      },
      now: () => virtualNow,
      random: () => 0.5,
    },
  };
}

describe('parseRetryAfterMs', () => {
  it('parses delta-seconds', () => {
    assert.equal(parseRetryAfterMs('7', 0), 7000);
    assert.equal(parseRetryAfterMs('0', 0), 0);
  });

  it('parses HTTP-dates relative to now', () => {
    const now = Date.parse('2026-06-10T12:00:00Z');
    assert.equal(parseRetryAfterMs('Wed, 10 Jun 2026 12:00:30 GMT', now), 30_000);
  });

  it('clamps past HTTP-dates to zero', () => {
    const now = Date.parse('2026-06-10T12:00:00Z');
    assert.equal(parseRetryAfterMs('Wed, 10 Jun 2026 11:59:00 GMT', now), 0);
  });

  it('returns undefined for garbage and missing values', () => {
    assert.equal(parseRetryAfterMs('soon', 0), undefined);
    assert.equal(parseRetryAfterMs('', 0), undefined);
    assert.equal(parseRetryAfterMs(null, 0), undefined);
    assert.equal(parseRetryAfterMs(undefined, 0), undefined);
  });
});

describe('isTransientNetworkError', () => {
  it('classifies fetch TypeErrors and socket errors as transient', () => {
    assert.equal(isTransientNetworkError(new TypeError('fetch failed')), true);
    assert.equal(isTransientNetworkError(Object.assign(new Error('reset'), { code: 'ECONNRESET' })), true);
  });

  it('walks the cause chain', () => {
    const cause = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
    const wrapped = new Error('request failed', { cause });
    assert.equal(isTransientNetworkError(wrapped), true);
  });

  it('does not classify aborts or plain errors as transient', () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    assert.equal(isTransientNetworkError(abort), false);
    assert.equal(isTransientNetworkError(new Error('boom')), false);
  });
});

describe('fetchWithRetry', () => {
  it('returns the first successful response without retrying', async () => {
    const { fetch, calls } = sequenceFetch([response(200)]);
    const { options } = instantClock();

    const result = await fetchWithRetry('https://api.example.com/items', {}, { fetch, ...options });

    assert.equal(result.status, 200);
    assert.equal(calls.length, 1);
  });

  it('retries a 429 and honors Retry-After delta-seconds', async () => {
    const { fetch, calls } = sequenceFetch([
      response(429, { 'Retry-After': '3' }),
      response(200),
    ]);
    const { options, sleeps } = instantClock();

    const result = await fetchWithRetry('https://api.example.com/items', {}, { fetch, ...options });

    assert.equal(result.status, 200);
    assert.equal(calls.length, 2);
    assert.deepEqual(sleeps, [3000]);
  });

  it('honors Retry-After HTTP-date headers', async () => {
    let virtualNow = Date.parse('2026-06-10T12:00:00Z');
    const sleeps: number[] = [];
    const { fetch, calls } = sequenceFetch([
      response(429, { 'retry-after': 'Wed, 10 Jun 2026 12:00:05 GMT' }),
      response(200),
    ]);

    const result = await fetchWithRetry('https://api.example.com/items', {}, {
      fetch,
      now: () => virtualNow,
      sleep: async (ms) => {
        sleeps.push(ms);
        virtualNow += ms;
      },
      random: () => 0.5,
    });

    assert.equal(result.status, 200);
    assert.equal(calls.length, 2);
    assert.deepEqual(sleeps, [5000]);
  });

  it('retries a 500 with exponential backoff and jitter, then succeeds', async () => {
    const { fetch, calls } = sequenceFetch([response(500), response(500), response(200)]);
    const { options, sleeps } = instantClock();

    const result = await fetchWithRetry('https://api.example.com/items', { method: 'GET' }, {
      fetch,
      ...options,
    });

    assert.equal(result.status, 200);
    assert.equal(calls.length, 3);
    // Equal jitter with random()=0.5: delay = base/2 + 0.5 * base/2 = 0.75 * base.
    assert.deepEqual(sleeps, [187.5, 375]);
  });

  it('returns the final retryable response after exhausting attempts by default', async () => {
    const { fetch, calls } = sequenceFetch([response(503)]);
    const { options, sleeps } = instantClock();

    const result = await fetchWithRetry('https://api.example.com/items', {}, {
      fetch,
      maxAttempts: 3,
      ...options,
    });

    assert.equal(result.status, 503);
    assert.equal(calls.length, 3);
    assert.equal(sleeps.length, 2);
  });

  it('throws a typed RetryExhaustedError on exhaustion when asked to', async () => {
    const { fetch, calls } = sequenceFetch([response(429, { 'Retry-After': '1' })]);
    const { options } = instantClock();

    await assert.rejects(
      fetchWithRetry('https://api.example.com/items', {}, {
        fetch,
        maxAttempts: 2,
        throwOnExhaustedRetryableStatus: true,
        ...options,
      }),
      (error: unknown) => {
        assert.ok(error instanceof RetryExhaustedError);
        assert.equal(error.code, 'RETRY_EXHAUSTED');
        assert.equal(error.attempts, 2);
        assert.equal(error.lastStatus, 429);
        return true;
      },
    );
    assert.equal(calls.length, 2);
  });

  it('throws a typed RetryExhaustedError when network errors persist', async () => {
    const networkError = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    const { fetch, calls } = sequenceFetch([networkError]);
    const { options } = instantClock();

    await assert.rejects(
      fetchWithRetry('https://api.example.com/items', {}, { fetch, maxAttempts: 3, ...options }),
      (error: unknown) => {
        assert.ok(error instanceof RetryExhaustedError);
        assert.equal(error.attempts, 3);
        assert.equal(error.cause, networkError);
        return true;
      },
    );
    assert.equal(calls.length, 3);
  });

  it('recovers when a transient network error is followed by success', async () => {
    const { fetch, calls } = sequenceFetch([new TypeError('fetch failed'), response(200)]);
    const { options } = instantClock();

    const result = await fetchWithRetry('https://api.example.com/items', {}, { fetch, ...options });

    assert.equal(result.status, 200);
    assert.equal(calls.length, 2);
  });

  it('does not retry non-retryable statuses like 400 or 404', async () => {
    for (const status of [400, 404]) {
      const { fetch, calls } = sequenceFetch([response(status)]);
      const { options, sleeps } = instantClock();

      const result = await fetchWithRetry('https://api.example.com/items', {}, { fetch, ...options });

      assert.equal(result.status, status);
      assert.equal(calls.length, 1);
      assert.equal(sleeps.length, 0);
    }
  });

  it('does not retry POST requests by default', async () => {
    const { fetch, calls } = sequenceFetch([response(500), response(200)]);
    const { options, sleeps } = instantClock();

    const result = await fetchWithRetry('https://api.example.com/items', { method: 'POST' }, {
      fetch,
      ...options,
    });

    assert.equal(result.status, 500);
    assert.equal(calls.length, 1);
    assert.equal(sleeps.length, 0);
  });

  it('does not retry POST network errors by default', async () => {
    const networkError = new TypeError('fetch failed');
    const { fetch, calls } = sequenceFetch([networkError]);
    const { options } = instantClock();

    await assert.rejects(
      fetchWithRetry('https://api.example.com/items', { method: 'POST' }, { fetch, ...options }),
      (error: unknown) => error === networkError,
    );
    assert.equal(calls.length, 1);
  });

  it('retries POST when the caller opts in', async () => {
    const { fetch, calls } = sequenceFetch([response(503), response(201)]);
    const { options } = instantClock();

    const result = await fetchWithRetry('https://api.example.com/items', { method: 'POST' }, {
      fetch,
      retryNonIdempotent: true,
      ...options,
    });

    assert.equal(result.status, 201);
    assert.equal(calls.length, 2);
  });

  it('treats POST as retryable when marked idempotent', async () => {
    const { fetch, calls } = sequenceFetch([response(503), response(200)]);
    const { options } = instantClock();

    const result = await fetchWithRetry('https://api.example.com/search', { method: 'POST' }, {
      fetch,
      idempotent: true,
      ...options,
    });

    assert.equal(result.status, 200);
    assert.equal(calls.length, 2);
  });

  it('does not retry plain (non-transient) errors', async () => {
    const failure = new Error('invalid payload');
    const { fetch, calls } = sequenceFetch([failure]);
    const { options } = instantClock();

    await assert.rejects(
      fetchWithRetry('https://api.example.com/items', {}, { fetch, ...options }),
      (error: unknown) => error === failure,
    );
    assert.equal(calls.length, 1);
  });

  it('stops retrying when the elapsed-time budget would be exceeded', async () => {
    const { fetch, calls } = sequenceFetch([response(429, { 'Retry-After': '3600' })]);
    const { options, sleeps } = instantClock();

    const result = await fetchWithRetry('https://api.example.com/items', {}, {
      fetch,
      maxAttempts: 5,
      maxElapsedMs: 10_000,
      ...options,
    });

    // A one-hour Retry-After blows the 10s budget: return immediately.
    assert.equal(result.status, 429);
    assert.equal(calls.length, 1);
    assert.equal(sleeps.length, 0);
  });

  it('reads Retry-After through a Headers-like get() interface', async () => {
    const { options, sleeps } = instantClock();
    let calls = 0;
    const fetch = async (): Promise<MockResponse> => {
      calls += 1;
      if (calls === 1) {
        return {
          status: 429,
          headers: { get: (name: string) => (name.toLowerCase() === 'retry-after' ? '2' : null) },
        };
      }
      return { status: 200 };
    };

    const result = await fetchWithRetry('https://api.example.com/items', {}, { fetch, ...options });

    assert.equal(result.status, 200);
    assert.deepEqual(sleeps, [2000]);
  });

  it('respects an abort signal while sleeping between attempts', async () => {
    const controller = new AbortController();
    const { fetch, calls } = sequenceFetch([response(500), response(200)]);

    const pending = fetchWithRetry('https://api.example.com/items', {}, {
      fetch,
      signal: controller.signal,
      initialDelayMs: 5_000,
      random: () => 0.5,
    });
    setTimeout(() => controller.abort(), 5);

    await assert.rejects(pending, (error: unknown) => (error as Error).name === 'AbortError');
    assert.equal(calls.length, 1);
  });
});

describe('withProxyRetry', () => {
  interface ProxyRequest {
    method: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT';
    baseUrl: string;
    endpoint: string;
    connectionId: string;
    headers?: Record<string, string>;
    body?: unknown;
    query?: Record<string, string>;
  }
  interface ProxyResponse<T = unknown> {
    status: number;
    headers: Record<string, string>;
    data: T;
  }

  function sequenceProvider(outcomes: Array<ProxyResponse | Error>): {
    provider: {
      name: string;
      proxy<T = unknown>(request: ProxyRequest): Promise<ProxyResponse<T>>;
    };
    calls: ProxyRequest[];
  } {
    const calls: ProxyRequest[] = [];
    return {
      calls,
      provider: {
        name: 'mock',
        async proxy<T>(request: ProxyRequest): Promise<ProxyResponse<T>> {
          calls.push(request);
          const outcome = outcomes[Math.min(calls.length - 1, outcomes.length - 1)];
          if (outcome instanceof Error) throw outcome;
          return outcome as ProxyResponse<T>;
        },
      },
    };
  }

  const getRequest: ProxyRequest = {
    method: 'GET',
    baseUrl: 'https://api.example.com',
    endpoint: '/items',
    connectionId: 'conn-1',
  };

  it('passes successful responses through untouched', async () => {
    const { provider, calls } = sequenceProvider([
      { status: 200, headers: {}, data: { ok: true } },
    ]);
    const { options } = instantClock();

    const result = await withProxyRetry(provider, options).proxy<{ ok: boolean }>(getRequest);

    assert.deepEqual(result.data, { ok: true });
    assert.equal(calls.length, 1);
  });

  it('retries 429 proxy responses and honors Retry-After headers', async () => {
    const { provider, calls } = sequenceProvider([
      { status: 429, headers: { 'Retry-After': '4' }, data: { message: 'slow down' } },
      { status: 200, headers: {}, data: { ok: true } },
    ]);
    const { options, sleeps } = instantClock();

    const result = await withProxyRetry(provider, options).proxy(getRequest);

    assert.equal(result.status, 200);
    assert.equal(calls.length, 2);
    assert.deepEqual(sleeps, [4000]);
  });

  it('retries 5xx GET responses but returns the final response when exhausted', async () => {
    const { provider, calls } = sequenceProvider([
      { status: 502, headers: {}, data: { message: 'bad gateway' } },
    ]);
    const { options } = instantClock();

    const result = await withProxyRetry(provider, { maxAttempts: 3, ...options }).proxy(getRequest);

    assert.equal(result.status, 502);
    assert.equal(calls.length, 3);
  });

  it('does not retry POST proxy requests by default', async () => {
    const { provider, calls } = sequenceProvider([
      { status: 503, headers: {}, data: {} },
      { status: 201, headers: {}, data: {} },
    ]);
    const { options } = instantClock();

    const result = await withProxyRetry(provider, options).proxy({
      ...getRequest,
      method: 'POST',
    });

    assert.equal(result.status, 503);
    assert.equal(calls.length, 1);
  });

  it('retries POST proxy requests when retryNonIdempotent is set', async () => {
    const { provider, calls } = sequenceProvider([
      { status: 503, headers: {}, data: {} },
      { status: 201, headers: {}, data: {} },
    ]);
    const { options } = instantClock();

    const result = await withProxyRetry(provider, { retryNonIdempotent: true, ...options }).proxy({
      ...getRequest,
      method: 'POST',
    });

    assert.equal(result.status, 201);
    assert.equal(calls.length, 2);
  });

  it('does not retry 4xx proxy responses', async () => {
    const { provider, calls } = sequenceProvider([
      { status: 404, headers: {}, data: { message: 'missing' } },
    ]);
    const { options } = instantClock();

    const result = await withProxyRetry(provider, options).proxy(getRequest);

    assert.equal(result.status, 404);
    assert.equal(calls.length, 1);
  });

  it('retries transient proxy errors and surfaces RetryExhaustedError when they persist', async () => {
    const transient = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    const { provider, calls } = sequenceProvider([transient]);
    const { options } = instantClock();

    await assert.rejects(
      withProxyRetry(provider, { maxAttempts: 2, ...options }).proxy(getRequest),
      (error: unknown) => {
        assert.ok(error instanceof RetryExhaustedError);
        assert.equal(error.attempts, 2);
        assert.equal(error.cause, transient);
        return true;
      },
    );
    assert.equal(calls.length, 2);
  });

  it('preserves non-proxy members of the wrapped provider', async () => {
    const { provider } = sequenceProvider([{ status: 200, headers: {}, data: {} }]);
    const wrapped = withProxyRetry(provider, instantClock().options);
    assert.equal(wrapped.name, 'mock');
  });

  it('memoizes the default-options wrapper per provider', () => {
    const { provider } = sequenceProvider([{ status: 200, headers: {}, data: {} }]);
    assert.equal(withProxyRetry(provider), withProxyRetry(provider));
  });
});
