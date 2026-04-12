import { createHash } from "node:crypto";
import type {
  FileReadResponse,
  FileSemantics,
  IngestWebhookInput,
  QueuedResponse,
  RelayFileClient,
  WriteFileInput,
  WriteQueuedResponse,
} from "@relayfile/sdk";

export interface StoredVfsFile {
  content: string;
  revision?: string;
  contentType?: string;
  encoding?: "utf-8" | "base64";
  semantics?: FileSemantics;
}

export interface RecordedVfsWrite {
  workspaceId: string;
  path: string;
  baseRevision: string;
  content: string;
  contentType?: string;
  encoding?: "utf-8" | "base64";
  semantics?: FileSemantics;
  correlationId?: string;
  revision: string;
}

export interface VfsSnapshotEntry {
  path: string;
  semantics: FileSemantics | null;
  recordHash: string;
}

export interface VfsSnapshotOptions {
  includePath?: (path: string, write: RecordedVfsWrite) => boolean;
  runtimeOnlyFields?: readonly string[];
}

export interface VfsSnapshotClient {
  client: RelayFileClient;
  files: Map<string, StoredVfsFile>;
  ingestedWebhooks: IngestWebhookInput[];
  writes: RecordedVfsWrite[];
  reset(): void;
  snapshotEntries(options?: VfsSnapshotOptions): VfsSnapshotEntry[];
  snapshotJsonl(options?: VfsSnapshotOptions): string;
  snapshotLines(options?: VfsSnapshotOptions): string[];
}

const DEFAULT_CONTENT_TYPE = "application/json";
const DEFAULT_RUNTIME_ONLY_FIELDS = new Set([
  "baseRevision",
  "correlationId",
  "eventId",
  "lastEditedAt",
  "opId",
  "revision",
  "signal",
  "targetRevision",
  "workspaceId",
]);
const SYNC_STATE_RUNTIME_ONLY_FIELDS = new Set(["updatedAt"]);

export function createVfsSnapshotClient(
  initialFiles: Record<string, StoredVfsFile> = {}
): VfsSnapshotClient {
  const writes: RecordedVfsWrite[] = [];
  const ingestedWebhooks: IngestWebhookInput[] = [];
  const files = new Map<string, StoredVfsFile>();
  const initialEntries = Object.entries(initialFiles).map(
    ([path, file]) => [path, cloneStoredFile(file)] as const
  );
  let nextRevision = 1;

  const seedInitialFiles = (): void => {
    files.clear();
    for (const [path, file] of initialEntries) {
      files.set(path, cloneStoredFile(file));
    }
  };

  seedInitialFiles();

  const fakeClient = {
    async readFile(
      _workspaceId: string,
      path: string,
      _correlationId?: string,
      signal?: AbortSignal
    ): Promise<FileReadResponse> {
      throwIfAborted(signal);
      const file = files.get(path);
      if (!file) {
        throw new Error(`No VFS file at ${path}`);
      }

      return {
        path,
        revision: file.revision ?? "0",
        contentType: file.contentType ?? DEFAULT_CONTENT_TYPE,
        content: file.content,
        encoding: file.encoding,
        semantics: cloneJson(file.semantics),
      };
    },

    async writeFile(input: WriteFileInput): Promise<WriteQueuedResponse> {
      throwIfAborted(input.signal);
      const revision = `rev-${nextRevision}`;
      nextRevision += 1;

      const storedFile: StoredVfsFile = {
        content: input.content,
        revision,
        contentType: input.contentType ?? DEFAULT_CONTENT_TYPE,
        encoding: input.encoding,
        semantics: cloneJson(input.semantics),
      };
      files.set(input.path, storedFile);

      writes.push({
        workspaceId: input.workspaceId,
        path: input.path,
        baseRevision: input.baseRevision,
        content: input.content,
        contentType: input.contentType,
        encoding: input.encoding,
        semantics: cloneJson(input.semantics),
        correlationId: input.correlationId,
        revision,
      });

      return {
        opId: `op-${revision}`,
        status: "queued",
        targetRevision: revision,
      };
    },

    async ingestWebhook(input: IngestWebhookInput): Promise<QueuedResponse> {
      throwIfAborted(input.signal);
      ingestedWebhooks.push(cloneJson(input) ?? input);
      return {
        id: `ingest-${ingestedWebhooks.length}`,
        status: "queued",
        correlationId: input.correlationId,
      };
    },
  };

  return {
    client: fakeClient as unknown as RelayFileClient,
    files,
    ingestedWebhooks,
    writes,
    reset() {
      writes.length = 0;
      ingestedWebhooks.length = 0;
      nextRevision = 1;
      seedInitialFiles();
    },
    snapshotEntries(options = {}) {
      return vfsSnapshotEntries(writes, options);
    },
    snapshotJsonl(options = {}) {
      return vfsSnapshotJsonl(writes, options);
    },
    snapshotLines(options = {}) {
      return vfsSnapshotLines(writes, options);
    },
  };
}

export function vfsSnapshotJsonl(
  writes: readonly RecordedVfsWrite[],
  options: VfsSnapshotOptions = {}
): string {
  const lines = vfsSnapshotLines(writes, options);
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

export function vfsSnapshotLines(
  writes: readonly RecordedVfsWrite[],
  options: VfsSnapshotOptions = {}
): string[] {
  return vfsSnapshotEntries(writes, options).map(formatSnapshotLine);
}

export function vfsSnapshotEntries(
  writes: readonly RecordedVfsWrite[],
  options: VfsSnapshotOptions = {}
): VfsSnapshotEntry[] {
  return writes
    .filter((write) => options.includePath?.(write.path, write) ?? true)
    .map((write) => ({
      path: write.path,
      semantics: normalizeSemantics(write.semantics),
      recordHash: hashVfsRecord(write, options),
    }))
    .sort(compareSnapshotEntries);
}

export function hashVfsRecord(
  write: Pick<RecordedVfsWrite, "content" | "path">,
  options: VfsSnapshotOptions = {}
): string {
  const parsed = parseJsonContent(write.content);
  const normalized = stripRuntimeOnlyFields(
    parsed,
    runtimeOnlyFieldsForPath(write.path, options)
  );

  return createHash("sha256")
    .update(stableStringify(normalized))
    .digest("hex");
}

export function stripRuntimeOnlyFields(
  value: unknown,
  runtimeOnlyFields: ReadonlySet<string>
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stripRuntimeOnlyFields(item, runtimeOnlyFields));
  }

  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !runtimeOnlyFields.has(key))
      .map(([key, item]) => [
        key,
        stripRuntimeOnlyFields(item, runtimeOnlyFields),
      ])
  );
}

function runtimeOnlyFieldsForPath(
  path: string,
  options: VfsSnapshotOptions
): ReadonlySet<string> {
  const fields = new Set(DEFAULT_RUNTIME_ONLY_FIELDS);
  for (const field of options.runtimeOnlyFields ?? []) {
    fields.add(field);
  }

  if (path.startsWith(".sync-state/") || path.startsWith("/.sync-state/")) {
    for (const field of SYNC_STATE_RUNTIME_ONLY_FIELDS) {
      fields.add(field);
    }
  }

  return fields;
}

function formatSnapshotLine(entry: VfsSnapshotEntry): string {
  return `{${[
    `"path":${JSON.stringify(entry.path)}`,
    `"semantics":${stableStringify(entry.semantics)}`,
    `"recordHash":${JSON.stringify(entry.recordHash)}`,
  ].join(",")}}`;
}

function compareSnapshotEntries(
  left: VfsSnapshotEntry,
  right: VfsSnapshotEntry
): number {
  return (
    left.path.localeCompare(right.path) ||
    left.recordHash.localeCompare(right.recordHash) ||
    stableStringify(left.semantics).localeCompare(stableStringify(right.semantics))
  );
}

function parseJsonContent(content: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch {
    return content;
  }
}

function normalizeSemantics(value: FileSemantics | undefined): FileSemantics | null {
  return cloneJson(value) ?? null;
}

function cloneStoredFile(file: StoredVfsFile): StoredVfsFile {
  return {
    content: file.content,
    revision: file.revision,
    contentType: file.contentType,
    encoding: file.encoding,
    semantics: cloneJson(file.semantics),
  };
}

function cloneJson<T>(value: T | undefined): T | undefined {
  if (value === undefined) {
    return undefined;
  }

  const text = JSON.stringify(value);
  return text === undefined ? undefined : (JSON.parse(text) as T);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (isRecord(value)) {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value) ?? "null";
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) {
    return;
  }

  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  throw error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
