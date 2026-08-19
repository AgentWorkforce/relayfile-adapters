import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { RelayFileApiError, RelayFileClient, type OperationStatusResponse } from "@relayfile/sdk";

/**
 * Shared VFS-backed transport for Relayfile integration writes/reads.
 *
 * A consumer does not call provider REST APIs directly. Instead it reads and
 * writes JSON files at canonical paths inside a Relayfile mount
 * (`/<provider>/<resource>/<id>.json`). A Relayfile writeback worker picks up
 * the draft files, turns them into real provider calls, and writes a receipt
 * back to the same path. This gets writeback durability + retry semantics for
 * free.
 *
 * Pair this with `@relayfile/adapter-core/writeback-paths` (`writebackPath`) to
 * resolve the canonical path, and `@relayfile/relay-helpers` for ergonomic
 * per-provider clients on top.
 *
 * Previously lived in `@agentworkforce/runtime/clients`; relocated here so the
 * write protocol sits in the relayfile layer (no workforce dependency) and the
 * ergonomic clients can build on it without inverting the package layering.
 */

/**
 * Error thrown when a Relayfile write or read fails. Carries enough metadata
 * for a retry layer to decide without parsing message strings.
 */
export interface RelayfileWritebackErrorOptions {
  provider: string;
  operation: string;
  cause?: unknown;
  retryable?: boolean;
}

export class RelayfileWritebackError extends Error {
  readonly provider: string;
  readonly operation: string;
  override readonly cause?: unknown;
  readonly retryable: boolean;

  constructor(options: RelayfileWritebackErrorOptions) {
    super(
      `${options.provider}.${options.operation} failed${
        options.cause instanceof Error ? `: ${options.cause.message}` : ""
      }`
    );
    this.name = "RelayfileWritebackError";
    this.provider = options.provider;
    this.operation = options.operation;
    if (options.cause !== undefined) this.cause = options.cause;
    this.retryable = options.retryable ?? false;
  }
}

export interface RelayfileWritebackPendingErrorOptions {
  provider: string;
  operation: string;
  opId: string;
  path: string;
  status: string;
  timeoutMs: number;
}

export class RelayfileWritebackPendingError extends RelayfileWritebackError {
  readonly opId: string;
  readonly path: string;
  readonly status: string;
  readonly timeoutMs: number;

  constructor(options: RelayfileWritebackPendingErrorOptions) {
    super({
      provider: options.provider,
      operation: options.operation,
      cause: new Error(
        `writeback_pending: op ${options.opId} remained ${options.status} after ${options.timeoutMs}ms`
      ),
      retryable: true
    });
    this.name = "RelayfileWritebackPendingError";
    this.opId = options.opId;
    this.path = options.path;
    this.status = options.status;
    this.timeoutMs = options.timeoutMs;
  }
}

export interface RelayfileWritebackAdmissionTimeoutErrorOptions {
  provider: string;
  operation: string;
  path: string;
  timeoutMs: number;
}

/** Direct HTTP admission never minted an op before the caller's admission deadline. */
export class RelayfileWritebackAdmissionTimeoutError extends RelayfileWritebackError {
  readonly path: string;
  readonly timeoutMs: number;

  constructor(options: RelayfileWritebackAdmissionTimeoutErrorOptions) {
    super({
      provider: options.provider,
      operation: options.operation,
      cause: new Error(
        `writeback_admission_timeout: no operation admitted for ${options.path} after ${options.timeoutMs}ms`
      ),
      retryable: true
    });
    this.name = "RelayfileWritebackAdmissionTimeoutError";
    this.path = options.path;
    this.timeoutMs = options.timeoutMs;
  }
}

export interface RelayfileWritebackTerminalErrorOptions {
  provider: string;
  operation: string;
  opId: string;
  /** Relayfile path when the caller has it; optional for constructor compatibility. */
  path?: string;
  status: string;
  lastError?: string | null;
}

export class RelayfileWritebackTerminalError extends RelayfileWritebackError {
  readonly opId: string;
  readonly path?: string;
  readonly status: string;

  constructor(options: RelayfileWritebackTerminalErrorOptions) {
    super({
      provider: options.provider,
      operation: options.operation,
      cause: new Error(
        `writeback_${options.status}: op ${options.opId}${
          options.lastError ? `: ${options.lastError}` : ""
        }`
      ),
      retryable: false
    });
    this.name = "RelayfileWritebackTerminalError";
    this.opId = options.opId;
    this.path = options.path;
    this.status = options.status;
  }
}

export interface RelayfileWritebackReceiptErrorOptions {
  provider: string;
  operation: string;
  opId: string;
  reason: string;
}

export class RelayfileWritebackReceiptError extends RelayfileWritebackError {
  readonly opId: string;

  constructor(options: RelayfileWritebackReceiptErrorOptions) {
    super({
      provider: options.provider,
      operation: options.operation,
      cause: new Error(`writeback_receipt_invalid: op ${options.opId}: ${options.reason}`),
      retryable: false
    });
    this.name = "RelayfileWritebackReceiptError";
    this.opId = options.opId;
  }
}

export interface IntegrationClientOptions {
  /** Absolute path to the Relayfile mount the consumer is running in. */
  relayfileMountRoot?: string;
  /** @deprecated alias for {@link relayfileMountRoot}. */
  relayfileRoot?: string;
  /** @deprecated alias for {@link relayfileMountRoot}. */
  mountRoot?: string;
  /** Working directory fallback when no mount root is configured. */
  workspaceCwd?: string;
  /**
   * Max wait, in ms, for the Relayfile writeback worker to emit a receipt onto
   * the just-written draft. Defaults to 3000ms. `0` means fire-and-forget — the
   * client returns immediately without a receipt. In direct HTTP mode, an
   * explicit value also bounds write admission as an independent phase. When
   * omitted, receipt waiting defaults to 3s while admission defaults to 90s.
   * Advertised delays are honored while they fit inside that admission budget;
   * after three consecutive 30s delays, the deadline wins at t+90s before a
   * fourth request.
   */
  writebackTimeoutMs?: number;
  /** Poll interval while waiting for a receipt. Default 250ms. */
  writebackPollMs?: number;
  /** Relayfile connection id, if the writeback needs one. */
  connectionId?: string;
  /** Direct Relayfile API base URL, when the client talks to it out-of-band. */
  relayfileBaseUrl?: string;
  /** API token for the Relayfile API, when applicable. */
  relayfileApiToken?: string;
  /** @deprecated alias for {@link relayfileApiToken}. */
  relayfileOpsToken?: string;
  /** Optional fetch implementation for direct Relayfile API writes. */
  fetchImpl?: typeof fetch;
  /** Workforce cloud API token, for cross-service auth (slack, jira). */
  cloudApiToken?: string;
  /** Workspace id the consumer is bound to. */
  workspaceId?: string;
  /** Slack team id, when the client targets a specific workspace. */
  slackTeamId?: string;
}

/**
 * Shape of the JSON the Relayfile writeback worker writes back into a draft
 * file once the remote write completes. Clients read this back to populate
 * their return values (issue numbers, comment ids, etc.).
 */
export interface WritebackReceipt {
  created?: string;
  path?: string;
  url?: string;
  id?: string;
  identifier?: string;
  externalId?: string;
  ts?: string;
  merged?: boolean | string;
  sha?: string;
  [key: string]: unknown;
}

/**
 * Delivery knowledge available when a transport returns from a write.
 *
 * `pending` means the draft was accepted but no provider receipt was observed
 * inside the caller's wait window. It must not be treated as a failed write:
 * retrying it can duplicate a provider-side effect. `dropped` is reserved for
 * transports that have positive evidence that the draft will not be handled.
 */
export type WritebackDeliveryStatus = "confirmed" | "pending" | "dropped";

export interface WritebackResult {
  path: string;
  absolutePath: string;
  opId?: string;
  receipt?: WritebackReceipt;
  /**
   * Explicit delivery knowledge. Optional so existing custom transports remain
   * source-compatible; consumers may infer confirmed/pending from receipt
   * presence when an older transport omits it.
   */
  deliveryStatus?: WritebackDeliveryStatus;
}

const DEFAULT_WRITEBACK_TIMEOUT_MS = 3_000;
const SDK_LEGACY_RETRY_MAX_DELAY_MS = 2_000;
const WORKSPACE_BUSY_RETRY_MAX_DELAY_MS = 30_000;
const DEFAULT_WRITEBACK_ADMISSION_TIMEOUT_MS = WORKSPACE_BUSY_RETRY_MAX_DELAY_MS * 3;
const MOUNT_WRITEBACK_CREATE_DRAFT_IDENTITY_KIND = "mount-writeback-create-draft";
const MOUNT_WRITEBACK_CREATE_DRAFT_IDENTITY_TTL_SECONDS = 30 * 24 * 60 * 60;
const RELAYFILE_DRAFT_BASENAME_PATTERN =
  /^.+ [0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.json$/;

interface MountWritebackCreateDraftContentIdentity {
  kind: typeof MOUNT_WRITEBACK_CREATE_DRAFT_IDENTITY_KIND;
  key: string;
  ttlSeconds: number;
}

function serializeJsonFile(body: unknown): string {
  return `${JSON.stringify(body, null, 2)}\n`;
}

function normalizeRelayfileRemotePath(relayPath: string): string {
  const trimmed = relayPath.trim();
  if (!trimmed) return "/";
  const normalized = path.posix.normalize(trimmed.startsWith("/") ? trimmed : `/${trimmed}`);
  return normalized.length > 1 ? normalized.replace(/\/+$/, "") : normalized;
}

function mountWritebackCreateDraftContentIdentity(
  workspaceId: string,
  relayPath: string,
  content: string
): MountWritebackCreateDraftContentIdentity | undefined {
  const normalizedPath = normalizeRelayfileRemotePath(relayPath);
  const basename = path.posix.basename(normalizedPath);
  const isCreateDraft =
    RELAYFILE_DRAFT_BASENAME_PATTERN.test(basename) ||
    (basename.startsWith("factory-create-") && basename.endsWith(".json"));
  if (!isCreateDraft) return undefined;

  const contentHash = createHash("sha256").update(content).digest("hex");
  return {
    kind: MOUNT_WRITEBACK_CREATE_DRAFT_IDENTITY_KIND,
    key: `${workspaceId.trim()}:${normalizedPath}:${contentHash}`,
    ttlSeconds: MOUNT_WRITEBACK_CREATE_DRAFT_IDENTITY_TTL_SECONDS
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isWorkspaceBusyAdmission(value: unknown): boolean {
  if (!isRecord(value) || value.code !== "workspace_busy") return false;
  const reason = value.reason ?? (isRecord(value.details) ? value.details.reason : undefined);
  return reason === "write_admission_limit";
}

function isWorkspaceBusyAdmissionError(value: unknown): value is RelayFileApiError {
  return value instanceof RelayFileApiError && value.status === 429 && isWorkspaceBusyAdmission(value);
}

function retryAfterDelayMs(value: string): number | undefined {
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (Number.isFinite(seconds)) return seconds * 1_000;
  }
  const timestamp = Date.parse(trimmed);
  return Number.isNaN(timestamp) ? undefined : Math.max(0, timestamp - Date.now());
}

async function responseIsWorkspaceBusyAdmission(response: Response): Promise<boolean> {
  if (response.status !== 429) return false;
  try {
    return isWorkspaceBusyAdmission(await response.clone().json());
  } catch {
    return false;
  }
}

function responseWithRetryAfter(response: Response, retryAfter: string): Response {
  const headers = new Headers(response.headers);
  headers.set("Retry-After", retryAfter);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function isDirectWriteAdmissionRequest(input: RequestInfo | URL, init?: RequestInit): boolean {
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  const url = input instanceof Request ? input.url : String(input);
  try {
    return method === "PUT" && new URL(url, "http://relayfile.invalid").pathname.endsWith("/fs/file");
  } catch {
    return false;
  }
}

/**
 * The SDK owns the only retry loop. Raising its max delay lets workspace write
 * admission honor Retry-After; this adapter keeps the SDK's previous 2s cap for
 * every other retryable response so unrelated 429/5xx behavior does not move.
 */
function directRetryFetch(fetchImpl: typeof fetch): typeof fetch {
  return async (input, init) => {
    const response = await fetchImpl(input, init);
    if (response.status !== 429 && (response.status < 500 || response.status > 599)) {
      return response;
    }
    const retryAfter = response.headers.get("Retry-After");
    if (!retryAfter) return response;
    const delayMs = retryAfterDelayMs(retryAfter);
    if (
      isDirectWriteAdmissionRequest(input, init) &&
      (await responseIsWorkspaceBusyAdmission(response))
    ) {
      return delayMs === undefined
        ? response
        : responseWithRetryAfter(response, String(Math.ceil(delayMs / 1_000)));
    }

    if (delayMs === undefined || delayMs <= SDK_LEGACY_RETRY_MAX_DELAY_MS) {
      return response;
    }
    return responseWithRetryAfter(response, String(SDK_LEGACY_RETRY_MAX_DELAY_MS / 1_000));
  };
}

function mountRootCandidate(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** Percent-encode a path segment so identifiers safely round-trip. */
export function encodeSegment(value: string | number): string {
  return encodeURIComponent(String(value));
}

/**
 * Allocate a unique draft filename for a new resource. The Relayfile writeback
 * worker renames the file to the canonical id on receipt.
 */
export function draftFile(prefix: string): string {
  return `${prefix} ${randomUUID()}.json`;
}

/**
 * The configured Relayfile mount root, if any — the same precedence as
 * {@link resolveMountRoot} but WITHOUT the `client.workspaceCwd` / `process.cwd()`
 * fallback. Returns `undefined` when no caller-supplied mount root and no
 * sandbox mount-root env var is present.
 *
 * This is the signal for "a real Relayfile FS mount exists". The cwd fallback is
 * deliberately excluded: under `sandbox: false` there is no mount, so we must NOT
 * treat the process cwd as a mount (which would write a stray draft into cwd that
 * no writeback worker ever picks up). When this returns `undefined` the write
 * path routes over HTTP instead (see {@link writeJsonFile}).
 */
export function configuredMountRoot(client: IntegrationClientOptions): string | undefined {
  const candidate =
    mountRootCandidate(client.relayfileMountRoot) ??
    mountRootCandidate(client.relayfileRoot) ??
    mountRootCandidate(client.mountRoot) ??
    mountRootCandidate(process.env.RELAYFILE_MOUNT_PATH) ??
    mountRootCandidate(process.env.WORKSPACE_ROOT) ??
    mountRootCandidate(process.env.WORKFORCE_SANDBOX_ROOT) ??
    mountRootCandidate(process.env.RELAYFILE_MOUNT_ROOT) ??
    mountRootCandidate(process.env.RELAYFILE_ROOT);
  return candidate ? path.resolve(candidate) : undefined;
}

/**
 * Resolve the absolute Relayfile mount root, honoring (in order) the
 * client-supplied option, deployed sandbox mount-root env vars, legacy
 * Relayfile root env vars, and finally `workspaceCwd` / `process.cwd()`.
 */
export function resolveMountRoot(client: IntegrationClientOptions): string {
  return (
    configuredMountRoot(client) ??
    path.resolve(mountRootCandidate(client.workspaceCwd) ?? process.cwd())
  );
}

/**
 * True when the caller passed a mount root explicitly on `opts` (as opposed to
 * picking one up from an env var). An explicit option is an unambiguous "use the
 * FS mount" intent and outranks any env-derived direct HTTP config.
 */
function hasExplicitMountOption(client: IntegrationClientOptions): boolean {
  return (
    mountRootCandidate(client.relayfileMountRoot) !== undefined ||
    mountRootCandidate(client.relayfileRoot) !== undefined ||
    mountRootCandidate(client.mountRoot) !== undefined
  );
}

/**
 * True when the caller passed direct Relayfile HTTP config explicitly on `opts`
 * (base URL + token + workspace id). An explicit option is an unambiguous "talk
 * to Relayfile over HTTP" intent and outranks any env-derived mount root.
 */
function hasExplicitDirectOption(client: IntegrationClientOptions): boolean {
  const baseUrl = nonEmpty(client.relayfileBaseUrl);
  const token = nonEmpty(client.relayfileApiToken) ?? nonEmpty(client.relayfileOpsToken);
  const workspaceId = nonEmpty(client.workspaceId);
  return Boolean(baseUrl && token && workspaceId);
}

function directClientConfig(
  client: IntegrationClientOptions
): { workspaceId: string; relayfile: RelayFileClient } | undefined {
  const baseUrl =
    nonEmpty(client.relayfileBaseUrl) ??
    nonEmpty(process.env.RELAYFILE_BASE_URL) ??
    nonEmpty(process.env.RELAYFILE_URL);
  const token =
    nonEmpty(client.relayfileApiToken) ??
    nonEmpty(client.relayfileOpsToken) ??
    nonEmpty(process.env.RELAYFILE_TOKEN);
  const workspaceId =
    nonEmpty(client.workspaceId) ??
    nonEmpty(process.env.RELAYFILE_WORKSPACE_ID) ??
    nonEmpty(process.env.RELAYFILE_WORKSPACE) ??
    nonEmpty(process.env.RELAY_WORKSPACE_ID);
  if (!baseUrl || !token || !workspaceId) return undefined;
  const fetchImpl = directRetryFetch(client.fetchImpl ?? globalThis.fetch);
  return {
    workspaceId,
    relayfile: new RelayFileClient({
      baseUrl,
      token,
      fetchImpl,
      retry: {
        maxDelayMs: WORKSPACE_BUSY_RETRY_MAX_DELAY_MS
      }
    })
  };
}

function isTerminalOp(op: OperationStatusResponse): boolean {
  return (
    op.status === "succeeded" ||
    op.status === "failed" ||
    op.status === "dead_lettered" ||
    op.status === "canceled"
  );
}

function providerResultReceipt(op: OperationStatusResponse): WritebackReceipt | undefined {
  return isRecord(op.providerResult) ? (op.providerResult as WritebackReceipt) : undefined;
}

function hasReceiptPayload(receipt: WritebackReceipt | undefined): receipt is WritebackReceipt {
  return receipt !== undefined && Object.keys(receipt).length > 0;
}

function hasSlackReceiptTs(receipt: WritebackReceipt): boolean {
  return nonEmpty(receipt.externalId) !== undefined || nonEmpty(receipt.ts) !== undefined;
}

function validateTerminalReceipt(
  provider: string,
  operation: string,
  opId: string,
  receipt: WritebackReceipt | undefined
): WritebackReceipt {
  if (!hasReceiptPayload(receipt)) {
    throw new RelayfileWritebackReceiptError({
      provider,
      operation,
      opId,
      reason: "succeeded without providerResult"
    });
  }
  if (provider === "slack" && !hasSlackReceiptTs(receipt)) {
    throw new RelayfileWritebackReceiptError({
      provider,
      operation,
      opId,
      reason: "succeeded without providerResult.externalId or providerResult.ts"
    });
  }
  return receipt;
}

async function waitForOperationReceipt(
  client: IntegrationClientOptions,
  provider: string,
  operation: string,
  direct: { workspaceId: string; relayfile: RelayFileClient },
  opId: string,
  relayPath: string
): Promise<WritebackReceipt | undefined> {
  const timeoutMs = client.writebackTimeoutMs ?? DEFAULT_WRITEBACK_TIMEOUT_MS;
  if (timeoutMs <= 0) return undefined;

  const deadline = Date.now() + timeoutMs;
  let last: OperationStatusResponse | undefined;
  do {
    try {
      const op = await direct.relayfile.getOp(direct.workspaceId, opId);
      last = op;
      if (op.status === "succeeded") {
        return validateTerminalReceipt(provider, operation, opId, providerResultReceipt(op));
      }
      if (isTerminalOp(op)) {
        throw new RelayfileWritebackTerminalError({
          provider,
          operation,
          opId,
          path: relayPath,
          status: op.status,
          lastError: op.lastError
        });
      }
    } catch (error) {
      if (error instanceof RelayfileWritebackTerminalError || error instanceof RelayfileWritebackReceiptError) {
        throw error;
      }
      if (error instanceof RelayFileApiError && error.status !== 404) {
        throw error;
      }
      if (!(error instanceof RelayFileApiError)) {
        throw error;
      }
      // The op can briefly be unreadable immediately after enqueue. Keep polling
      // until the caller's bounded wait expires.
    }
    await new Promise((resolve) => setTimeout(resolve, client.writebackPollMs ?? 250));
  } while (Date.now() < deadline);

  throw new RelayfileWritebackPendingError({
    provider,
    operation,
    opId,
    path: relayPath,
    status: last?.status ?? "(no op observed)",
    timeoutMs
  });
}

async function writeJsonFileViaRelayfileApi(
  client: IntegrationClientOptions,
  provider: string,
  operation: string,
  relayPath: string,
  body: unknown,
  direct: { workspaceId: string; relayfile: RelayFileClient }
): Promise<WritebackResult> {
  const timeoutMs = client.writebackTimeoutMs ?? DEFAULT_WRITEBACK_ADMISSION_TIMEOUT_MS;
  const content = serializeJsonFile(body);
  const contentIdentity = mountWritebackCreateDraftContentIdentity(
    direct.workspaceId,
    relayPath,
    content
  );
  const controller = timeoutMs > 0 ? new AbortController() : undefined;
  const deadlineTimer = controller
    ? setTimeout(() => controller.abort(), timeoutMs)
    : undefined;
  let admitted = false;
  try {
    const queued = await direct.relayfile.writeFile({
      workspaceId: direct.workspaceId,
      path: relayPath,
      baseRevision: "*",
      contentType: "application/json",
      content,
      ...(contentIdentity ? { contentIdentity } : {}),
      signal: controller?.signal
    });
    admitted = true;
    if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
    if (queued.writeback && !nonEmpty(queued.opId)) {
      throw new RelayfileWritebackReceiptError({
        provider,
        operation,
        opId: "(missing)",
        reason: "queued writeback response did not include opId"
      });
    }
    const receipt = queued.opId
      ? await waitForOperationReceipt(client, provider, operation, direct, queued.opId, relayPath)
      : undefined;
    return {
      path: relayPath,
      absolutePath: relayPath,
      opId: queued.opId,
      deliveryStatus: receipt ? "confirmed" : "pending",
      ...(receipt ? { receipt } : {})
    };
  } catch (error) {
    if (controller?.signal.aborted && !admitted && !(error instanceof RelayfileWritebackError)) {
      throw new RelayfileWritebackAdmissionTimeoutError({
        provider,
        operation,
        path: relayPath,
        timeoutMs
      });
    }
    throw error;
  } finally {
    if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
  }
}

function toAbsolutePath(client: IntegrationClientOptions, relayPath: string): string {
  const root = resolveMountRoot(client);
  const normalized = relayPath.startsWith("/") ? relayPath.slice(1) : relayPath;
  const absolute = path.resolve(root, normalized);
  const relative = path.relative(root, absolute);
  // `startsWith("..")` alone would also reject a legit in-mount name like
  // `..foo.json`; only an exact `..` or a `../`-prefixed segment escapes.
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Relayfile path escapes mount root: ${relayPath}`);
  }
  return absolute;
}

export async function readJsonFile<T>(
  client: IntegrationClientOptions,
  provider: string,
  operation: string,
  relayPath: string
): Promise<T> {
  try {
    const absolutePath = toAbsolutePath(client, relayPath);
    return JSON.parse(await readFile(absolutePath, "utf8")) as T;
  } catch (cause) {
    if (cause instanceof RelayfileWritebackError) {
      throw cause;
    }
    throw new RelayfileWritebackError({ provider, operation, cause, retryable: false });
  }
}

export async function readTextFile(
  client: IntegrationClientOptions,
  provider: string,
  operation: string,
  relayPath: string
): Promise<string> {
  try {
    return await readFile(toAbsolutePath(client, relayPath), "utf8");
  } catch (cause) {
    if (cause instanceof RelayfileWritebackError) {
      throw cause;
    }
    throw new RelayfileWritebackError({ provider, operation, cause, retryable: false });
  }
}

export async function listJsonFiles<T>(
  client: IntegrationClientOptions,
  provider: string,
  operation: string,
  relayDir: string
): Promise<Array<{ path: string; value: T }>> {
  try {
    const absoluteDir = toAbsolutePath(client, relayDir);
    const entries = await readdirIfPresent(absoluteDir);
    const out: Array<{ path: string; value: T }> = [];
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const relayPath = `${relayDir.replace(/\/+$/, "")}/${entry}`;
      const value = JSON.parse(await readFile(path.join(absoluteDir, entry), "utf8")) as T;
      out.push({ path: relayPath, value });
    }
    return out;
  } catch (cause) {
    if (cause instanceof RelayfileWritebackError) {
      throw cause;
    }
    throw new RelayfileWritebackError({ provider, operation, cause, retryable: false });
  }
}

export async function listDirectoryEntries(
  client: IntegrationClientOptions,
  provider: string,
  operation: string,
  relayDir: string
): Promise<string[]> {
  try {
    return await readdirIfPresent(toAbsolutePath(client, relayDir));
  } catch (cause) {
    throw new RelayfileWritebackError({ provider, operation, cause, retryable: false });
  }
}

async function readdirIfPresent(absoluteDir: string): Promise<string[]> {
  try {
    return await readdir(absoluteDir);
  } catch (error) {
    if (isNoEntryError(error)) {
      return [];
    }
    throw error;
  }
}

function isNoEntryError(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

/**
 * Write a draft JSON payload atomically (write-then-rename) so the writeback
 * worker never sees a partial file. Waits for a receipt by default; pass
 * `writebackTimeoutMs: 0` to return immediately.
 */
export async function writeJsonFile(
  client: IntegrationClientOptions,
  provider: string,
  operation: string,
  relayPath: string,
  body: unknown
): Promise<WritebackResult> {
  try {
    // Backend selection. A real FS mount (an explicit mount-root option or a
    // sandbox mount-root env var — NOT the cwd fallback) always wins so harness
    // agents are byte-for-byte unchanged: write the draft into the mount and let
    // the relayfile-mount daemon turn it into a provider call + receipt.
    //
    // When there is no mount (e.g. a `sandbox: false` reply bot running in the
    // cloud worker with no Daytona box), route the SAME draft to the SAME path
    // over HTTP via `RelayFileClient` (RELAYFILE_URL/RELAYFILE_TOKEN/
    // RELAYFILE_WORKSPACE_ID, injected by the cloud). The server fires the
    // identical writeback and returns the receipt — no FS, no cold start.
    //
    // No mount AND no HTTP config is a hard error: silently writing into cwd
    // would drop a draft no writeback worker ever picks up.
    //
    // Precedence:
    //   1. An explicit HTTP option on `opts` (relayfileBaseUrl+token+workspaceId)
    //      means "talk over HTTP" even if a mount env var happens to be set.
    //   2. Otherwise a configured mount (explicit option OR sandbox env var) wins.
    //   3. Otherwise fall back to env-derived HTTP config, if present.
    //   4. Otherwise error (never a stray cwd write).
    const useDirectFirst = hasExplicitDirectOption(client) && !hasExplicitMountOption(client);
    const hasMount = configuredMountRoot(client) !== undefined;
    if (useDirectFirst || !hasMount) {
      const direct = directClientConfig(client);
      if (direct) {
        return await writeJsonFileViaRelayfileApi(client, provider, operation, relayPath, body, direct);
      }
      if (!hasMount) {
        throw new RelayfileWritebackError({
          provider,
          operation,
          cause: new Error(
            "no Relayfile mount and no direct HTTP config: set a mount root " +
              "(relayfileMountRoot / RELAYFILE_MOUNT_PATH) or RELAYFILE_URL + " +
              "RELAYFILE_TOKEN + RELAYFILE_WORKSPACE_ID"
          ),
          retryable: false
        });
      }
    }
    const absolutePath = toAbsolutePath(client, relayPath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    const tempPath = `${absolutePath}.tmp-${randomUUID()}`;
    await writeFile(tempPath, serializeJsonFile(body), "utf8");
    await rename(tempPath, absolutePath);
    const receipt = await waitForReceipt(absolutePath, client, body);
    return {
      path: relayPath,
      absolutePath,
      deliveryStatus: receipt ? "confirmed" : "pending",
      ...(receipt ? { receipt } : {})
    };
  } catch (cause) {
    if (cause instanceof RelayfileWritebackError) {
      throw cause;
    }
    throw new RelayfileWritebackError({
      provider,
      operation,
      cause,
      retryable: isWorkspaceBusyAdmissionError(cause)
    });
  }
}

async function waitForReceipt(
  absolutePath: string,
  client: IntegrationClientOptions,
  draft: unknown
): Promise<WritebackReceipt | undefined> {
  const timeoutMs = client.writebackTimeoutMs ?? DEFAULT_WRITEBACK_TIMEOUT_MS;
  if (timeoutMs <= 0) return undefined;
  // Never reinterpret the just-written draft as a receipt. The draft payload may
  // legitimately carry top-level `id` / `path` / `created` fields (e.g. an
  // upsert update writing back the canonical issue), so the first poll could
  // otherwise return the draft itself and surface a bogus identifier. Only
  // accept a file whose content has changed from the draft we wrote.
  const draftJson = JSON.stringify(draft);
  const deadline = Date.now() + timeoutMs;
  do {
    const parsed = await readCurrentJson(absolutePath);
    if (
      parsed !== undefined &&
      JSON.stringify(parsed) !== draftJson &&
      isRecord(parsed) &&
      (typeof parsed.created === "string" ||
        typeof parsed.path === "string" ||
        typeof parsed.id === "string" ||
        typeof parsed.externalId === "string" ||
        typeof parsed.merged === "boolean" ||
        typeof parsed.merged === "string")
    ) {
      return parsed as WritebackReceipt;
    }
    await new Promise((resolve) => setTimeout(resolve, client.writebackPollMs ?? 250));
  } while (Date.now() < deadline);
  return undefined;
}

async function readCurrentJson(absolutePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(absolutePath, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

// Re-export the writeback status normalizer + normalized types so consumers
// of the high-level write path (WritebackResult) have a single import site for
// the W6 / observability bridge (RFC PR 2291 alignment).
// Types needed for the normalized writeback error (imported as types to avoid cycles)
import type {
  NormalizedWritebackState,
  NormalizedWritebackStatus,
  WritebackOperation,
  WritebackReceiptLike,
} from "../runtime/writeback-status.js";

// Re-export the normalize + status types (the implementation of normalize stays in writeback-status)
export {
  normalizeWritebackStatus,
  type NormalizedWritebackState,
  type NormalizedWritebackStatus,
  type WritebackOutcome,
  type WritebackStatusEntry,
} from "../runtime/writeback-status.js";

/**
 * Typed error for writeback failures after normalization (high-level writeJsonFile etc).
 * Extends the existing RelayfileWritebackError so that instanceof checks
 * (WorkforceIntegrationError aliases, cloud/agent catches) continue to work.
 *
 * For RFC 2291 / W6 / W2 alignment. Carries `state` for taxonomy mapping.
 */
export class WritebackError extends RelayfileWritebackError {
  readonly state: NormalizedWritebackState;
  readonly path: string;
  readonly op?: WritebackOperation;
  readonly id?: string;
  readonly receipt?: WritebackReceiptLike;
  readonly field?: string;
  readonly timestamp?: string;

  constructor(normalized: NormalizedWritebackStatus) {
    const detail = normalized.error ? `: ${normalized.error}` : "";
    // Call super with synthetic provider/operation so the base message and fields are populated.
    // We use a stable "writeback" provider and the state as operation for diagnostics.
    super({
      provider: "writeback",
      operation: normalized.state,
      cause: normalized.error ? new Error(normalized.error) : undefined,
      retryable: false,
    });
    // Override message to be more precise (the super sets a transport-style one).
    this.message = `writeback ${normalized.state} ${normalized.path}${detail}`;
    this.name = "WritebackError";
    this.state = normalized.state;
    this.path = normalized.path;
    this.op = normalized.op;
    this.id = normalized.id;
    this.receipt = normalized.receipt;
    this.field = normalized.field;
    this.timestamp = normalized.timestamp;
  }
}
