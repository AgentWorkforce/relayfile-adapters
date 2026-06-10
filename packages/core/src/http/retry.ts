/**
 * Shared HTTP rate-limit / retry helpers.
 *
 * Adapters in this repo talk to providers through one of two transports:
 *
 * 1. A `fetch`-shaped client (Notion's raw token path, the X search client).
 *    Wrap those call sites with {@link fetchWithRetry}.
 * 2. A relayfile `ConnectionProvider.proxy()` call. Wrap the provider with
 *    {@link withProxyRetry} at the call site:
 *
 *        const response = await withProxyRetry(provider).proxy({ ... });
 *
 * Both honor `Retry-After` (delta-seconds and HTTP-date forms), retry on 429,
 * 5xx, and transient network errors with exponential backoff plus jitter, and
 * never retry non-idempotent requests (POST/PATCH) unless the caller opts in
 * via `retryNonIdempotent: true`.
 *
 * Exhaustion semantics:
 * - If the final attempt produced an HTTP response, that response is returned
 *   so existing status handling in adapters keeps working unchanged. Callers
 *   that want a typed failure instead can pass
 *   `throwOnExhaustedRetryableStatus: true` to receive a
 *   {@link RetryExhaustedError}.
 * - If the final attempt failed with a transient network error, a
 *   {@link RetryExhaustedError} is thrown with the underlying error as
 *   `cause`.
 */

export interface RetryOptions {
  /** Total attempts, including the first one. Default 3. */
  maxAttempts?: number;
  /** Give up once this much wall-clock time has been spent. Default 30s. */
  maxElapsedMs?: number;
  /** Base delay before the first retry. Default 250ms. */
  initialDelayMs?: number;
  /** Upper bound for a single computed backoff delay. Default 10s. */
  maxDelayMs?: number;
  /** Exponential growth factor. Default 2. */
  backoffFactor?: number;
  /**
   * Retry POST/PATCH requests too. Default false: only idempotent methods
   * (GET, HEAD, OPTIONS, PUT, DELETE, TRACE) are retried.
   */
  retryNonIdempotent?: boolean;
  /** Status classifier. Default: 429 or any 5xx is retryable. */
  isRetryableStatus?: (status: number) => boolean;
  /** Error classifier. Default: {@link isTransientNetworkError}. */
  isRetryableError?: (error: unknown) => boolean;
  /**
   * Throw a {@link RetryExhaustedError} instead of returning the final
   * response when attempts run out while the response is still retryable
   * (e.g. a persistent 429). Default false.
   */
  throwOnExhaustedRetryableStatus?: boolean;
  /** Abort retries (and in-flight sleeps) when this signal fires. */
  signal?: AbortSignal;
  /** Injectable sleep, for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable jitter source, for tests. Must return [0, 1). */
  random?: () => number;
  /** Injectable clock, for tests. Returns epoch milliseconds. */
  now?: () => number;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_MAX_ELAPSED_MS = 30_000;
const DEFAULT_INITIAL_DELAY_MS = 250;
const DEFAULT_MAX_DELAY_MS = 10_000;
const DEFAULT_BACKOFF_FACTOR = 2;

const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE', 'TRACE']);

const TRANSIENT_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'EPIPE',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

/** Typed error surfaced when retries are exhausted. */
export class RetryExhaustedError extends Error {
  readonly code = 'RETRY_EXHAUSTED';
  /** Number of attempts that were made. */
  readonly attempts: number;
  /** Wall-clock time spent across all attempts, in milliseconds. */
  readonly elapsedMs: number;
  /** Status of the final response, when the final attempt got one. */
  readonly lastStatus?: number;

  constructor(
    message: string,
    details: { attempts: number; elapsedMs: number; lastStatus?: number; cause?: unknown },
  ) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = 'RetryExhaustedError';
    this.attempts = details.attempts;
    this.elapsedMs = details.elapsedMs;
    if (details.lastStatus !== undefined) this.lastStatus = details.lastStatus;
  }
}

/** True for errors that look like transient network failures worth retrying. */
export function isTransientNetworkError(error: unknown): boolean {
  if (isAbortError(error)) return false;
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== null && typeof current === 'object'; depth += 1) {
    const record = current as Record<string, unknown>;
    const code = record.code ?? record.errno;
    if (typeof code === 'string' && TRANSIENT_ERROR_CODES.has(code)) return true;
    if (current instanceof TypeError) {
      // undici / WHATWG fetch reports network failures as `TypeError: fetch failed`.
      return true;
    }
    current = record.cause;
  }
  return false;
}

function isAbortError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

function isIdempotentMethod(method: string | undefined): boolean {
  return IDEMPOTENT_METHODS.has((method ?? 'GET').toUpperCase());
}

function defaultIsRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

/**
 * Parse a `Retry-After` header value: either delta-seconds or an HTTP-date.
 * Returns the wait in milliseconds, or `undefined` when unparseable.
 */
export function parseRetryAfterMs(value: string | null | undefined, nowMs: number): number | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  if (/^\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10) * 1000;
  }
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - nowMs);
}

type HeadersLike =
  | { get(name: string): string | null }
  | Record<string, string | string[] | undefined>;

function readHeader(headers: HeadersLike | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  if (typeof (headers as { get?: unknown }).get === 'function') {
    const value = (headers as { get(name: string): string | null }).get(name);
    return value ?? undefined;
  }
  const record = headers as Record<string, string | string[] | undefined>;
  const lower = name.toLowerCase();
  for (const key of Object.keys(record)) {
    if (key.toLowerCase() === lower) {
      const value = record[key];
      if (typeof value === 'string') return value;
      if (Array.isArray(value)) return value[0];
      return undefined;
    }
  }
  return undefined;
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      reject(createAbortError());
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function createAbortError(): Error {
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
}

interface ResolvedRetryOptions {
  maxAttempts: number;
  maxElapsedMs: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffFactor: number;
  retryNonIdempotent: boolean;
  isRetryableStatus: (status: number) => boolean;
  isRetryableError: (error: unknown) => boolean;
  throwOnExhaustedRetryableStatus: boolean;
  signal?: AbortSignal;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  random: () => number;
  now: () => number;
}

function resolveOptions(options: RetryOptions): ResolvedRetryOptions {
  const resolved: ResolvedRetryOptions = {
    maxAttempts: Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS),
    maxElapsedMs: options.maxElapsedMs ?? DEFAULT_MAX_ELAPSED_MS,
    initialDelayMs: options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS,
    maxDelayMs: options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS,
    backoffFactor: options.backoffFactor ?? DEFAULT_BACKOFF_FACTOR,
    retryNonIdempotent: options.retryNonIdempotent ?? false,
    isRetryableStatus: options.isRetryableStatus ?? defaultIsRetryableStatus,
    isRetryableError: options.isRetryableError ?? isTransientNetworkError,
    throwOnExhaustedRetryableStatus: options.throwOnExhaustedRetryableStatus ?? false,
    sleep: options.sleep ?? defaultSleep,
    random: options.random ?? Math.random,
    now: options.now ?? Date.now,
  };
  if (options.signal) resolved.signal = options.signal;
  return resolved;
}

interface AttemptInspection {
  retryable: boolean;
  status: number;
  retryAfterMs?: number;
}

/**
 * Core retry loop shared by {@link fetchWithRetry} and {@link withProxyRetry}.
 *
 * `attempt` performs one request; `inspect` classifies its result. Thrown
 * errors are retried only when `isRetryableError` says so and the request is
 * idempotent (or `retryNonIdempotent` is set).
 */
export async function executeWithRetry<R>(args: {
  attempt: () => Promise<R>;
  inspect: (result: R) => AttemptInspection;
  idempotent: boolean;
  describe: string;
  options: RetryOptions;
}): Promise<R> {
  const opts = resolveOptions(args.options);
  const canRetry = args.idempotent || opts.retryNonIdempotent;
  const startedAt = opts.now();

  for (let attemptNumber = 1; ; attemptNumber += 1) {
    if (opts.signal?.aborted) throw createAbortError();

    let result: R;
    try {
      result = await args.attempt();
    } catch (error) {
      if (isAbortError(error) || !canRetry || !opts.isRetryableError(error)) {
        throw error;
      }
      const delayMs = nextDelayMs(opts, attemptNumber, undefined);
      if (attemptNumber >= opts.maxAttempts || exceedsBudget(opts, startedAt, delayMs)) {
        throw new RetryExhaustedError(
          `${args.describe} failed after ${attemptNumber} attempt(s): ${describeError(error)}`,
          { attempts: attemptNumber, elapsedMs: opts.now() - startedAt, cause: error },
        );
      }
      await opts.sleep(delayMs, opts.signal);
      continue;
    }

    const inspection = args.inspect(result);
    if (!inspection.retryable || !canRetry) {
      return result;
    }
    const delayMs = nextDelayMs(opts, attemptNumber, inspection.retryAfterMs);
    if (attemptNumber >= opts.maxAttempts || exceedsBudget(opts, startedAt, delayMs)) {
      if (opts.throwOnExhaustedRetryableStatus) {
        throw new RetryExhaustedError(
          `${args.describe} still returning ${inspection.status} after ${attemptNumber} attempt(s)`,
          {
            attempts: attemptNumber,
            elapsedMs: opts.now() - startedAt,
            lastStatus: inspection.status,
          },
        );
      }
      return result;
    }
    await opts.sleep(delayMs, opts.signal);
  }
}

function nextDelayMs(
  opts: ResolvedRetryOptions,
  attemptNumber: number,
  retryAfterMs: number | undefined,
): number {
  if (retryAfterMs !== undefined) {
    // Honor the server's request, but never beyond the elapsed-time budget
    // (checked by the caller via exceedsBudget).
    return retryAfterMs;
  }
  const exponential = Math.min(
    opts.maxDelayMs,
    opts.initialDelayMs * opts.backoffFactor ** (attemptNumber - 1),
  );
  // Equal jitter: half deterministic, half random.
  return exponential / 2 + opts.random() * (exponential / 2);
}

function exceedsBudget(opts: ResolvedRetryOptions, startedAt: number, delayMs: number): boolean {
  return opts.now() - startedAt + delayMs > opts.maxElapsedMs;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Minimal response surface required by {@link fetchWithRetry}. */
export interface RetryResponseLike {
  status: number;
  headers?: HeadersLike;
}

/** Permissive `RequestInit` so any fetch implementation can be wrapped. */
export interface RetryRequestInit {
  method?: string;
  signal?: AbortSignal | null;
  [key: string]: unknown;
}

export interface FetchRetryOptions<R extends RetryResponseLike> extends RetryOptions {
  /** Fetch implementation. Defaults to `globalThis.fetch`. */
  fetch?: (input: string | URL, init?: RetryRequestInit) => Promise<R>;
  /**
   * Force the idempotency classification instead of deriving it from
   * `init.method`. Useful for POST endpoints that are semantically reads.
   */
  idempotent?: boolean;
}

/**
 * `fetch` with rate-limit aware retries.
 *
 * Retries 429/5xx responses (honoring `Retry-After`) and transient network
 * errors with exponential backoff plus jitter. Non-idempotent methods
 * (POST/PATCH) are never retried unless the caller opts in via
 * `retryNonIdempotent` or `idempotent: true`.
 *
 * Returns the final response even when it is still an error status, unless
 * `throwOnExhaustedRetryableStatus` is set; network-error exhaustion throws a
 * {@link RetryExhaustedError}.
 */
export async function fetchWithRetry<R extends RetryResponseLike = Response>(
  input: string | URL,
  init: RetryRequestInit = {},
  options: FetchRetryOptions<R> = {},
): Promise<R> {
  const fetchImpl =
    options.fetch ??
    ((globalThis.fetch as unknown) as (input: string | URL, init?: RetryRequestInit) => Promise<R>);
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('fetchWithRetry requires a fetch implementation');
  }
  const idempotent = options.idempotent ?? isIdempotentMethod(init.method);
  const nowFn = options.now ?? Date.now;
  const retryableStatus = options.isRetryableStatus ?? defaultIsRetryableStatus;
  const retryOptions: RetryOptions = { ...options };
  if (!retryOptions.signal && init.signal) retryOptions.signal = init.signal;

  return executeWithRetry<R>({
    attempt: () => fetchImpl(input, init),
    inspect: (response) => {
      const retryable = retryableStatus(response.status);
      const inspection: AttemptInspection = { retryable, status: response.status };
      if (retryable) {
        const retryAfterMs = parseRetryAfterMs(readHeader(response.headers, 'retry-after'), nowFn());
        if (retryAfterMs !== undefined) inspection.retryAfterMs = retryAfterMs;
      }
      return inspection;
    },
    idempotent,
    describe: `${(init.method ?? 'GET').toUpperCase()} ${String(input)}`,
    options: retryOptions,
  });
}

/** Minimal proxy response surface required by {@link withProxyRetry}. */
export interface ProxyResponseLike {
  status: number;
  headers?: Record<string, string>;
}

/**
 * Minimal provider surface required by {@link withProxyRetry}. The `never`
 * parameter type makes any concrete `proxy(request)` method assignable here
 * (method parameters are checked bivariantly).
 */
export interface ProxyCapable {
  proxy(request: never): Promise<ProxyResponseLike>;
}

interface ProxyRequestShape {
  method?: string;
  signal?: AbortSignal;
}

const defaultWrappedProviders = new WeakMap<object, unknown>();

/**
 * Wrap a `ConnectionProvider`-shaped object so `proxy()` retries 429/5xx
 * responses (honoring `Retry-After`) and transient network errors. The
 * wrapper preserves the provider's full type, so call sites change from
 * `provider.proxy({...})` to `withProxyRetry(provider).proxy({...})`.
 *
 * POST/PATCH requests pass through without retries unless
 * `retryNonIdempotent` is set.
 */
export function withProxyRetry<P extends ProxyCapable>(provider: P, options?: RetryOptions): P {
  if (options === undefined) {
    const cached = defaultWrappedProviders.get(provider);
    if (cached) return cached as P;
  }
  const wrapped = Object.create(provider) as P;
  const retryOptions = options ?? {};
  const nowFn = retryOptions.now ?? Date.now;
  const retryableStatus = retryOptions.isRetryableStatus ?? defaultIsRetryableStatus;
  Object.defineProperty(wrapped, 'proxy', {
    configurable: true,
    writable: true,
    enumerable: false,
    value: (request: ProxyRequestShape) => {
      const perCall: RetryOptions = { ...retryOptions };
      if (!perCall.signal && request?.signal) perCall.signal = request.signal;
      return executeWithRetry<ProxyResponseLike>({
        attempt: () =>
          (provider as { proxy(req: unknown): Promise<ProxyResponseLike> }).proxy(request),
        inspect: (response) => {
          const retryable = retryableStatus(response.status);
          const inspection: AttemptInspection = { retryable, status: response.status };
          if (retryable) {
            const retryAfterMs = parseRetryAfterMs(
              readHeader(response.headers, 'retry-after'),
              nowFn(),
            );
            if (retryAfterMs !== undefined) inspection.retryAfterMs = retryAfterMs;
          }
          return inspection;
        },
        idempotent: isIdempotentMethod(request?.method),
        describe: `${(request?.method ?? 'GET').toUpperCase()} proxy request`,
        options: perCall,
      });
    },
  });
  if (options === undefined) {
    defaultWrappedProviders.set(provider, wrapped);
  }
  return wrapped;
}
