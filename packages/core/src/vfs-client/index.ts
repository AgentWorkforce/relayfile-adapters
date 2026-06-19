import { randomUUID } from "node:crypto";
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

export interface RelayfileWritebackTerminalErrorOptions {
  provider: string;
  operation: string;
  opId: string;
  status: string;
  lastError?: string | null;
}

export class RelayfileWritebackTerminalError extends RelayfileWritebackError {
  readonly opId: string;
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
   * client returns immediately without a receipt.
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

export interface WritebackResult {
  path: string;
  absolutePath: string;
  opId?: string;
  receipt?: WritebackReceipt;
}

const DEFAULT_WRITEBACK_TIMEOUT_MS = 3_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
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
 * Resolve the absolute Relayfile mount root, honoring (in order) the
 * client-supplied option, deployed sandbox mount-root env vars, legacy
 * Relayfile root env vars, and finally `workspaceCwd` / `process.cwd()`.
 */
export function resolveMountRoot(client: IntegrationClientOptions): string {
  return path.resolve(
    mountRootCandidate(client.relayfileMountRoot) ??
      mountRootCandidate(client.relayfileRoot) ??
      mountRootCandidate(client.mountRoot) ??
      mountRootCandidate(process.env.RELAYFILE_MOUNT_PATH) ??
      mountRootCandidate(process.env.WORKSPACE_ROOT) ??
      mountRootCandidate(process.env.WORKFORCE_SANDBOX_ROOT) ??
      mountRootCandidate(process.env.RELAYFILE_MOUNT_ROOT) ??
      mountRootCandidate(process.env.RELAYFILE_ROOT) ??
      mountRootCandidate(client.workspaceCwd) ??
      process.cwd()
  );
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
  return {
    workspaceId,
    relayfile: new RelayFileClient({
      baseUrl,
      token,
      fetchImpl: client.fetchImpl
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
  return typeof receipt.externalId === "string" || typeof receipt.ts === "string";
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
  const queued = await direct.relayfile.writeFile({
    workspaceId: direct.workspaceId,
    path: relayPath,
    baseRevision: "*",
    contentType: "application/json",
    content: `${JSON.stringify(body, null, 2)}\n`
  });
  const receipt = queued.opId
    ? await waitForOperationReceipt(client, provider, operation, direct, queued.opId, relayPath)
    : undefined;
  return {
    path: relayPath,
    absolutePath: relayPath,
    opId: queued.opId,
    ...(receipt ? { receipt } : {})
  };
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
    const direct = directClientConfig(client);
    if (direct) {
      return await writeJsonFileViaRelayfileApi(client, provider, operation, relayPath, body, direct);
    }
    const absolutePath = toAbsolutePath(client, relayPath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    const tempPath = `${absolutePath}.tmp-${randomUUID()}`;
    await writeFile(tempPath, `${JSON.stringify(body, null, 2)}\n`, "utf8");
    await rename(tempPath, absolutePath);
    const receipt = await waitForReceipt(absolutePath, client, body);
    return { path: relayPath, absolutePath, ...(receipt ? { receipt } : {}) };
  } catch (cause) {
    if (cause instanceof RelayfileWritebackError) {
      throw cause;
    }
    throw new RelayfileWritebackError({ provider, operation, cause, retryable: false });
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
