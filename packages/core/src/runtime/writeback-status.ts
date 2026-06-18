export type WritebackOperation = "patch" | "create" | "delete";

export type WritebackOutcome =
  | "ok"
  | "validation_failed"
  | "readonly_rejected"
  | "adapter_error"
  | "no_receipt";

export type WritebackStatusState = "accepted" | "rejected";

export type WritebackStatusCode =
  | "OK"
  | "VALIDATION_FAILED"
  | "READ_ONLY_FIELD"
  | "ADAPTER_ERROR"
  | "NO_RECEIPT";

export interface WritebackStatusEntry {
  path: string;
  op: WritebackOperation;
  status?: WritebackStatusState;
  code?: WritebackStatusCode;
  outcome: WritebackOutcome;
  error?: string;
  field?: string;
  timestamp: string;
}

export interface WritebackStatusFilter {
  path?: string;
  op?: WritebackOperation;
  status?: WritebackStatusState;
  code?: WritebackStatusCode;
  outcome?: WritebackOutcome;
  field?: string;
}

const writebackStatusEntries: WritebackStatusEntry[] = [];

export function recordWritebackStatus(entry: WritebackStatusEntry): void {
  writebackStatusEntries.push({ ...entry });
}

export function listWritebackStatus(
  filter: WritebackStatusFilter = {}
): WritebackStatusEntry[] {
  return writebackStatusEntries
    .filter((entry) => {
      if (filter.path !== undefined && entry.path !== filter.path) {
        return false;
      }
      if (filter.op !== undefined && entry.op !== filter.op) {
        return false;
      }
      if (filter.status !== undefined && entry.status !== filter.status) {
        return false;
      }
      if (filter.code !== undefined && entry.code !== filter.code) {
        return false;
      }
      if (filter.outcome !== undefined && entry.outcome !== filter.outcome) {
        return false;
      }
      if (filter.field !== undefined && entry.field !== filter.field) {
        return false;
      }
      return true;
    })
    .map((entry) => ({ ...entry }));
}

export function clearWritebackStatus(): void {
  writebackStatusEntries.length = 0;
}

// Re-export for consumers who import the normalized types + error from the writeback-status barrel
// (avoids breaking imports that used to come from here before the class moved for extends compatibility).
export { WritebackError } from "../vfs-client/index.js";

/**
 * Minimal shape for high-level write results (from vfs-client WritebackResult).
 * Used so the normalizer can live with the status types without tight coupling.
 */
export interface WritebackReceiptLike {
  created?: string;
  path?: string;
  url?: string;
  id?: string | number;
  identifier?: string;
  externalId?: string;
  merged?: boolean | string;
  sha?: string;
  [key: string]: unknown;
}

export interface WritebackResultLike {
  path: string;
  absolutePath?: string;
  receipt?: WritebackReceiptLike;
}

/** Unified state enum for runtime wrappers, W6 logging, and W2 terminal taxonomy. */
export type NormalizedWritebackState =
  | "succeeded"
  | "no_receipt"
  | WritebackOutcome;

export interface NormalizedWritebackStatus {
  state: NormalizedWritebackState;
  path: string;
  op?: WritebackOperation;
  id?: string;
  error?: string;
  field?: string;
  receipt?: WritebackReceiptLike;
  timestamp?: string;
  /** Original status entry if one was supplied (for advanced filtering). */
  entry?: WritebackStatusEntry;
}

/**
 * Normalizes a high-level WritebackResult (from writeJsonFile / provider client write)
 * plus optional low-level WritebackStatusEntry into a single shape.
 *
 * - receipt absent (or explicit) -> 'no_receipt'
 * - receipt present + ok -> 'succeeded'
 * - otherwise maps the outcome
 *
 * This lets workforce runtime do:
 *   const n = normalizeWritebackStatus(result);
 *   if (n.state !== 'succeeded') { ... handle n.state ... }
 * without knowing adapter internals.
 */
export function normalizeWritebackStatus(
  result?: WritebackResultLike,
  entry?: WritebackStatusEntry
): NormalizedWritebackStatus {
  const path = result?.path ?? entry?.path ?? "";
  const receipt = result?.receipt;

  if (!receipt) {
    return {
      state: "no_receipt",
      path,
      op: entry?.op,
      error: entry?.error ?? "writeback produced no receipt (timeout, fire-and-forget, or worker did not overwrite draft)",
      field: entry?.field,
      receipt: undefined,
      timestamp: entry?.timestamp,
      ...(entry ? { entry } : {}),
    };
  }

  // Receipt present. Prefer entry outcome if present and not ok; otherwise succeeded.
  let state: NormalizedWritebackState = "succeeded";
  if (entry && entry.outcome !== "ok") {
    state = entry.outcome as NormalizedWritebackState;
  }

  const id = receipt.id != null ? String(receipt.id) :
             receipt.created ? String(receipt.created) : undefined;

  return {
    state,
    path,
    op: entry?.op,
    id,
    error: entry?.error,
    field: entry?.field,
    receipt,
    timestamp: entry?.timestamp,
    ...(entry ? { entry } : {}),
  };
}
