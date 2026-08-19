import type {
  WritebackReceipt,
  WritebackResult,
} from '@relayfile/adapter-core/vfs-client';
import {
  RelayfileWritebackPendingError,
  RelayfileWritebackTerminalError,
} from '@relayfile/adapter-core/vfs-client';

/**
 * A provider receipt was observed inside the write's wait window.
 */
export interface CreatedConfirmed {
  status: 'confirmed';
  /** Provider id when supplied, otherwise the legacy draft-path fallback. */
  id: string;
  /** Provider URL when supplied. Never a Relayfile path. */
  url: string;
  /** Stable handle for the Relayfile draft regardless of receipt contents. */
  path: string;
  receipt: WritebackReceipt;
}

/**
 * The draft was accepted, but no provider receipt arrived inside the wait
 * window. This is not failure evidence and must not trigger an automatic retry.
 */
export interface CreatedPending {
  status: 'pending';
  /** Legacy-compatible draft handle; not a provider id until confirmed. */
  id: string;
  /** Empty because a Relayfile path is not a provider URL. */
  url: '';
  path: string;
  receipt?: never;
}

/** A transport positively determined that the draft will not be handled. */
export interface CreatedDropped {
  status: 'dropped';
  /** Legacy-compatible draft handle; no provider object was created. */
  id: string;
  /** Empty because no provider URL exists. */
  url: '';
  path: string;
  /** Terminal provider-operation detail when the transport supplies it. */
  reason?: string;
  /** Optional diagnostic receipt supplied by a custom transport. */
  receipt?: WritebackReceipt;
}

export type CreatedResult = CreatedConfirmed | CreatedPending | CreatedDropped;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function receiptIdentifier(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return nonEmptyString(value);
}

function hasReceiptEvidence(receipt: WritebackReceipt): boolean {
  return (
    receiptIdentifier(receipt.created) !== undefined ||
    receiptIdentifier(receipt.id) !== undefined ||
    receiptIdentifier(receipt.externalId) !== undefined ||
    receiptIdentifier(receipt.identifier) !== undefined ||
    nonEmptyString(receipt.path) !== undefined ||
    nonEmptyString(receipt.url) !== undefined ||
    receiptIdentifier(receipt.ts) !== undefined ||
    typeof receipt.merged === 'boolean' ||
    nonEmptyString(receipt.merged) !== undefined ||
    receiptIdentifier(receipt.sha) !== undefined ||
    receipt.ok === true
  );
}

function createdFromError(error: unknown): CreatedResult {
  if (error instanceof RelayfileWritebackPendingError) {
    return { status: 'pending', id: error.path, url: '', path: error.path };
  }
  if (error instanceof RelayfileWritebackTerminalError) {
    const path = nonEmptyString(error.path);
    if (!path) {
      throw error;
    }
    return {
      status: 'dropped',
      id: path,
      url: '',
      path,
      reason: error.cause instanceof Error ? error.cause.message : `writeback_${error.status}`,
    };
  }
  throw error;
}

function isPromiseLike(value: unknown): value is PromiseLike<WritebackResult> {
  return isRecord(value) && typeof value.then === 'function';
}

/**
 * Preserve a write transport's delivery knowledge for ergonomic create
 * helpers. Older transports that omit `deliveryStatus` remain compatible: receipt
 * presence means confirmed and absence means pending.
 *
 * Pending is deliberately returned, never thrown. A receipt can arrive after
 * this function returns, and retrying an unconfirmed write can duplicate the
 * provider-side effect.
 */
export function created(result: WritebackResult): CreatedResult;
export function created(result: PromiseLike<WritebackResult>): Promise<CreatedResult>;
export function created(result: WritebackResult | PromiseLike<WritebackResult>): CreatedResult | Promise<CreatedResult> {
  if (isPromiseLike(result)) {
    return Promise.resolve(result).then(created).catch(createdFromError);
  }

  if (!isRecord(result)) {
    throw new TypeError('created() expected a writeback result object');
  }

  const path = nonEmptyString(result.path);
  if (!path) {
    throw new TypeError('created() expected a non-empty writeback result path');
  }

  const receipt = result.receipt;
  if (receipt !== undefined && !isRecord(receipt)) {
    throw new TypeError('created() expected receipt to be an object when present');
  }

  const status = result.deliveryStatus ?? (receipt ? 'confirmed' : 'pending');
  if (status !== 'confirmed' && status !== 'pending' && status !== 'dropped') {
    throw new TypeError(`created() received unknown writeback status "${String(status)}"`);
  }

  if (status === 'confirmed') {
    if (!receipt) {
      throw new TypeError('created() received confirmed status without a receipt');
    }
    if (!hasReceiptEvidence(receipt)) {
      throw new TypeError('created() received a confirmed receipt without delivery evidence');
    }
    return {
      status,
      id:
        receiptIdentifier(receipt.created) ??
        receiptIdentifier(receipt.id) ??
        receiptIdentifier(receipt.externalId) ??
        receiptIdentifier(receipt.identifier) ??
        receiptIdentifier(receipt.sha) ??
        receiptIdentifier(receipt.ts) ??
        path,
      url: nonEmptyString(receipt.url) ?? '',
      path,
      receipt,
    };
  }

  if (status === 'pending') {
    if (receipt) {
      throw new TypeError('created() received pending status with a receipt');
    }
    return { status, id: path, url: '', path };
  }

  return {
    status,
    id: path,
    url: '',
    path,
    ...(receipt ? { receipt } : {}),
  };
}
