/**
 * Shared orchestration primitives for adapter-owned auxiliary-file emission.
 *
 * Phase 1 of the three-phase refactor that pushes per-provider aux-file
 * logic out of cloud's `record-writer.ts` (which ballooned to ~800 lines
 * after cloud#546) and into each adapter. Adapters compose these primitives
 * to expose a single `emitAuxiliaryFiles(client, input)` entry point that
 * cloud will eventually call as a 10-line dispatcher (Phase 3).
 *
 * What this module deliberately does *not* know:
 * - Anything provider-specific (no Slack/Jira/Notion/Confluence switches).
 * - How to render index rows or build LAYOUT.md — those live in each
 *   adapter so the canonical shape is owned by the adapter that also owns
 *   the underlying record schema.
 * - Schema validation. Records arrive cleaned (post-stripNangoMetadata);
 *   the caller is responsible for filtering deleted tombstones into the
 *   delete branch.
 *
 * What it does own:
 * - `runEmitBatch` — resilient fan-out for write/delete operations. Each
 *   path succeeds or fails independently, with errors accumulated into
 *   the returned `EmitAuxiliaryFilesResult.errors` array (mirrors the
 *   adapter-confluence#69 b2440df pattern for in-webhook fan-out).
 * - `IndexFileReconciler` — read existing `_index.json` rows, queue
 *   upserts and removes, flush once via an adapter-supplied builder.
 * - `PriorAliasReader` — read the stable by-id alias on a prior write
 *   so adapters can compute stale alias paths and delete them on
 *   rename / status-change / parent-move.
 *
 * Back-compat: every primitive degrades gracefully when the client lacks
 * `readFile`. Reconciliation becomes a no-op (matches pre-#69 behavior,
 * stale aliases accumulate but functional state stays correct), and the
 * canonical write fan-out still proceeds.
 */

/** Content type for JSON-encoded aux files. Adapters pass this through. */
export const EMIT_AUXILIARY_JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

/** A single write operation queued by an adapter's emit logic. */
export interface EmitWrite {
  path: string;
  content: string;
  contentType?: string;
  /** Adapter-specific properties/relations/permissions/comments. */
  semantics?: EmitFileSemantics;
}

/** A single delete operation queued by an adapter's emit logic. */
export interface EmitDelete {
  path: string;
}

/**
 * Semantics block the adapter attaches to each write. Kept structurally
 * compatible with the per-adapter `FileSemantics` type so adapters can
 * pass theirs through without remapping.
 */
export interface EmitFileSemantics {
  properties?: Record<string, string>;
  relations?: readonly string[];
  permissions?: readonly string[];
  comments?: readonly string[];
}

/**
 * Aggregate result returned by every `emitAuxiliaryFiles` call. Per-path
 * failures land in `errors` keyed by the path that threw; the rest of the
 * batch is unaffected. Callers retrying transient failures can target only
 * the paths in `errors` instead of re-deriving the full alias set.
 */
export interface EmitAuxiliaryFilesResult {
  written: number;
  deleted: number;
  errors: EmitError[];
}

export interface EmitError {
  path: string;
  error: string;
}

/** Optional revision result some VFS backends return. We ignore it here. */
export interface EmitWriteResult {
  created?: boolean;
  updated?: boolean;
  status?: 'created' | 'updated' | 'queued' | 'pending';
}

export interface EmitWriteInput {
  workspaceId: string;
  path: string;
  content: string;
  contentType?: string;
  semantics?: EmitFileSemantics;
}

export interface EmitDeleteInput {
  workspaceId: string;
  path: string;
}

export interface EmitReadInput {
  workspaceId: string;
  path: string;
}

export interface EmitReadResult {
  content: string;
}

/**
 * The client contract every adapter's `emitAuxiliaryFiles` consumes.
 *
 * Structurally compatible with each adapter's existing `RelayFileClientLike`
 * (single-input shape) — adapters can forward the client they were
 * constructed with directly. Cloud's variadic `RelayfileWriteClient` shape
 * adapts via a thin shim that cloud will introduce in Phase 3 (not in this
 * PR's scope).
 *
 * `readFile` is optional: reconciliation degrades to a no-op when absent.
 * `deleteFile` is optional: when absent, queued deletes surface as errors
 * (`"deleteFile not supported by client"`) and the rest of the batch still
 * proceeds.
 */
export interface AuxiliaryEmitterClient {
  writeFile(input: EmitWriteInput): Promise<EmitWriteResult | void>;
  deleteFile?(input: EmitDeleteInput): Promise<void> | void;
  readFile?(input: EmitReadInput): Promise<EmitReadResult | null | undefined>;
}

/**
 * Generic shape every adapter's `emitAuxiliaryFiles` accepts. Adapters
 * narrow `records` to their own concrete record type; the shared
 * primitives never look inside `records` themselves — they're only here
 * for the surface-level contract.
 */
export interface EmitAuxiliaryFilesInput<TRecord> {
  workspaceId: string;
  records: readonly TRecord[];
  /**
   * Free-form per-job context. Adapters may carry sync model, provider
   * config key, connection id, etc. The shared primitives ignore it.
   */
  options?: Record<string, unknown>;
}

/**
 * The contract every adapter implements. Cloud's Phase 3 dispatcher will
 * be a switch over `provider` that calls `adapter.emitAuxiliaryFiles(...)`
 * and propagates the result.
 */
export interface AdapterAuxiliaryEmitter<TRecord> {
  emitAuxiliaryFiles(
    client: AuxiliaryEmitterClient,
    input: EmitAuxiliaryFilesInput<TRecord>,
  ): Promise<EmitAuxiliaryFilesResult>;
}

// -- runEmitBatch -----------------------------------------------------------

/**
 * Per-record planner the adapter passes to `runEmitBatch`. Returns the
 * set of writes and deletes to queue for a single record. The planner runs
 * synchronously or asynchronously per record; the runner serializes them
 * to preserve write-after-delete ordering inside a single record (stale
 * alias delete must complete before the canonical write would race past).
 */
export type PerRecordPlanner<TRecord> = (
  record: TRecord,
  index: number,
) => Promise<EmitPlan> | EmitPlan;

/** What a planner returns per record. */
export interface EmitPlan {
  writes?: readonly EmitWrite[];
  deletes?: readonly EmitDelete[];
}

export interface RunEmitBatchOptions {
  /** Defaults to `EMIT_AUXILIARY_JSON_CONTENT_TYPE` if absent on a write. */
  defaultContentType?: string;
}

/**
 * Execute writes and deletes with per-path try/catch. Deletes run before
 * writes within a single record's plan (stale alias cleanup must precede
 * the new canonical write so a transient failure doesn't leave the old
 * alias resolving to fresh bytes). Errors are accumulated, never thrown.
 *
 * The runner is intentionally serial within a record and across records:
 * cloud already parallelizes at the record-write layer, and aux-file
 * emission is bursty (one batch per Nango chunk). A future enhancement
 * can layer Promise.allSettled on top, but doing so here would force
 * every adapter to reason about partial-failure visibility on the same
 * index file — the current contract gives callers one observable
 * "errors[]" view.
 */
export async function runEmitBatch<TRecord>(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  records: readonly TRecord[],
  planner: PerRecordPlanner<TRecord>,
  options: RunEmitBatchOptions = {},
): Promise<EmitAuxiliaryFilesResult> {
  const result: EmitAuxiliaryFilesResult = { written: 0, deleted: 0, errors: [] };
  const defaultContentType = options.defaultContentType ?? EMIT_AUXILIARY_JSON_CONTENT_TYPE;

  for (let i = 0; i < records.length; i += 1) {
    let plan: EmitPlan;
    try {
      plan = await planner(records[i] as TRecord, i);
    } catch (error) {
      result.errors.push({ path: '', error: stringifyError(error) });
      continue;
    }

    if (plan.deletes && plan.deletes.length > 0) {
      for (const op of plan.deletes) {
        if (!client.deleteFile) {
          result.errors.push({ path: op.path, error: 'deleteFile not supported by client' });
          continue;
        }
        try {
          await client.deleteFile({ workspaceId, path: op.path });
          result.deleted += 1;
        } catch (error) {
          result.errors.push({ path: op.path, error: stringifyError(error) });
        }
      }
    }

    if (plan.writes && plan.writes.length > 0) {
      for (const op of plan.writes) {
        try {
          await client.writeFile({
            workspaceId,
            path: op.path,
            content: op.content,
            contentType: op.contentType ?? defaultContentType,
            ...(op.semantics ? { semantics: op.semantics } : {}),
          });
          result.written += 1;
        } catch (error) {
          result.errors.push({ path: op.path, error: stringifyError(error) });
        }
      }
    }
  }

  return result;
}

// -- IndexFileReconciler ----------------------------------------------------

/** Minimum shape every adapter index row exposes. */
export interface IndexRowLike {
  id: string;
}

/**
 * Builder the adapter passes to `IndexFileReconciler.flush`. Receives the
 * merged row set (existing minus removed plus upserted) and returns the
 * serialized file body the adapter wants to write. Adapters own sort
 * order, field shape, and trailing newline behavior — the primitive only
 * orchestrates read-merge-write.
 */
export type IndexFileBuilder<TRow extends IndexRowLike> = (
  rows: readonly TRow[],
) => { path: string; content: string; contentType?: string };

export interface IndexFileReconcilerOptions<TRow extends IndexRowLike> {
  client: AuxiliaryEmitterClient;
  workspaceId: string;
  path: string;
  builder: IndexFileBuilder<TRow>;
}

/**
 * Read-modify-write helper for `_index.json` files. The adapter accumulates
 * rows to upsert and ids to remove, then calls `flush()` once per batch:
 * one read, one write. Concurrent ingestions of the same index path race
 * here exactly like they do in cloud's current `writeIndexFile` — Phase 2
 * may layer the existing `upsertIndexAtomic` primitive on top to add CAS
 * retries, but the contract is the same.
 *
 * Failures during flush are returned in the caller's error array; the
 * reconciler does not throw.
 */
export class IndexFileReconciler<TRow extends IndexRowLike> {
  private readonly client: AuxiliaryEmitterClient;
  private readonly workspaceId: string;
  private readonly path: string;
  private readonly builder: IndexFileBuilder<TRow>;
  private readonly upserts: TRow[] = [];
  private readonly removes: Set<string> = new Set();

  constructor(options: IndexFileReconcilerOptions<TRow>) {
    this.client = options.client;
    this.workspaceId = options.workspaceId;
    this.path = options.path;
    this.builder = options.builder;
  }

  /** Queue a row for upsert. Last write wins on duplicate ids within the batch. */
  upsert(...rows: readonly TRow[]): this {
    for (const row of rows) {
      this.upserts.push(row);
    }
    return this;
  }

  /** Queue an id for removal. Wins over a same-id upsert queued later? No —
   * upserts within the same flush take precedence (matches cloud's current
   * `writeIndexFile` semantics: removes apply first, then upserts merge in). */
  remove(...ids: readonly string[]): this {
    for (const id of ids) {
      this.removes.add(id);
    }
    return this;
  }

  /** True when no upserts or removes have been queued. */
  isEmpty(): boolean {
    return this.upserts.length === 0 && this.removes.size === 0;
  }

  /**
   * Flush queued mutations. Reads existing rows once, applies removes, then
   * applies upserts (last-write-wins on id collisions). Returns either a
   * successful `{ written: 1 }` plan or an `errors` entry on failure.
   */
  async flush(): Promise<{ written: number; errors: EmitError[] }> {
    if (this.isEmpty()) {
      return { written: 0, errors: [] };
    }

    let existing: TRow[];
    try {
      existing = await readJsonArrayRows<TRow>(this.client, this.workspaceId, this.path);
    } catch (error) {
      // Read failure is non-fatal — proceed with empty baseline. Matches
      // cloud's `readJsonArray` swallowing parse/read errors.
      existing = [];
      // We still record the read error so callers can surface it. Callers
      // can choose to ignore index errors if they're non-critical.
      // (Empty baseline can stomp peers, which is the documented behavior
      // for non-CAS index writes.)
      void error;
    }

    const retained = this.removes.size > 0
      ? existing.filter((row) => !this.removes.has(row.id))
      : existing;
    const byId = new Map<string, TRow>(retained.map((row) => [row.id, row]));
    for (const row of this.upserts) {
      byId.set(row.id, row);
    }
    const merged = [...byId.values()];

    const built = this.builder(merged);
    try {
      await this.client.writeFile({
        workspaceId: this.workspaceId,
        path: built.path,
        content: built.content,
        contentType: built.contentType ?? EMIT_AUXILIARY_JSON_CONTENT_TYPE,
      });
      return { written: 1, errors: [] };
    } catch (error) {
      return {
        written: 0,
        errors: [{ path: built.path, error: stringifyError(error) }],
      };
    }
  }
}

// -- PriorAliasReader -------------------------------------------------------

/**
 * Read a single prior `by-id` alias and parse it through a caller-supplied
 * extractor. Used by adapters to compute stale alias paths on rename /
 * status-change / parent-move: the by-id alias is keyed only on objectId
 * so it survives every other field change and is the right anchor for
 * "was this record materialized before, and if so what did its alias
 * fields look like?".
 *
 * Generic over the prior state shape — adapters parse what they need
 * (title, status, spaceId, parentId, key, ...) and return a structured
 * object. Read failures and parse failures both resolve to `null`; the
 * caller treats absence as "no reconciliation possible, leave any stale
 * aliases in place" rather than failing the canonical write.
 */
export class PriorAliasReader {
  private readonly client: AuxiliaryEmitterClient;
  private readonly workspaceId: string;

  constructor(client: AuxiliaryEmitterClient, workspaceId: string) {
    this.client = client;
    this.workspaceId = workspaceId;
  }

  /** True when the client exposes `readFile` (reconciliation possible). */
  isAvailable(): boolean {
    return typeof this.client.readFile === 'function';
  }

  /**
   * Read and parse the file at `path`. Returns `null` on missing file,
   * read error, or parse failure. Returns the parsed JSON object (or
   * the result of `extract` if supplied) on success.
   */
  async read<TState = Record<string, unknown>>(
    path: string,
    extract?: (parsed: Record<string, unknown>) => TState | null,
  ): Promise<TState | null> {
    if (!this.client.readFile) {
      return null;
    }
    let raw: EmitReadResult | null | undefined;
    try {
      raw = await this.client.readFile({ workspaceId: this.workspaceId, path });
    } catch {
      return null;
    }
    if (!raw || typeof raw.content !== 'string' || raw.content.length === 0) {
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.content);
    } catch {
      return null;
    }
    if (!isPlainRecord(parsed)) {
      return null;
    }
    if (extract) {
      try {
        return extract(parsed);
      } catch {
        return null;
      }
    }
    return parsed as unknown as TState;
  }
}

// -- internal helpers -------------------------------------------------------

async function readJsonArrayRows<TRow extends IndexRowLike>(
  client: AuxiliaryEmitterClient,
  workspaceId: string,
  path: string,
): Promise<TRow[]> {
  if (!client.readFile) {
    return [];
  }
  let raw: EmitReadResult | null | undefined;
  try {
    raw = await client.readFile({ workspaceId, path });
  } catch {
    return [];
  }
  if (!raw || typeof raw.content !== 'string' || raw.content.length === 0) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.content);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  const rows: TRow[] = [];
  for (const item of parsed) {
    if (isPlainRecord(item) && typeof (item as { id?: unknown }).id === 'string') {
      rows.push(item as unknown as TRow);
    }
  }
  return rows;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
