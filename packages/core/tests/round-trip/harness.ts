import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { loadServiceSpecFromMapping } from "../../src/ingest/index.js";
import {
  SchemaAdapter,
  type SchemaSyncOptions,
} from "../../src/runtime/schema-adapter.js";
import {
  loadMappingSpec,
  validateMappingSpec,
} from "../../src/spec/parser.js";
import type {
  MappingSpec,
  ValidationIssue,
} from "../../src/spec/types.js";
import {
  createFakeConnection,
  type HttpReplayFixture,
  type HttpReplayInteraction,
  type HttpReplayRequest,
} from "./fake-connection.js";
import {
  createVfsSnapshotClient,
  type StoredVfsFile,
  type VfsSnapshotClient,
  type VfsSnapshotOptions,
} from "./vfs-snapshot.js";

export interface RoundTripManifest {
  schemaVersion: 1;
  name: string;
  description?: string;
  adapter?: string;
  mapping: string;
  openapi?: string;
  fixture: string;
  expectedSnapshot: string;
  sync: RoundTripSyncManifest;
  replay?: RoundTripReplayManifest;
  initialFiles?: Record<string, StoredVfsFile>;
  snapshot?: RoundTripSnapshotManifest;
}

export interface RoundTripSyncManifest {
  resourceName: string;
  workspaceId: string;
  connectionId?: string;
  input?: Record<string, unknown>;
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  options?: Record<string, unknown>;
}

export interface RoundTripReplayManifest {
  baseUrl?: string;
  requests?: readonly RoundTripReplayRequest[];
}

export interface RoundTripReplayRequest {
  method: HttpReplayRequest["method"];
  endpoint: string;
  baseUrl?: string;
  connectionId?: string;
  headers?: HttpReplayRequest["headers"];
  body?: unknown;
  query?: HttpReplayRequest["query"];
  sourceFixture?: string;
}

export interface RoundTripSnapshotManifest {
  includeSyncState?: boolean;
  runtimeOnlyFields?: readonly string[];
}

export interface LoadedRoundTripManifest {
  manifestPath: string;
  manifestDir: string;
  manifest: RoundTripManifest;
}

export interface RoundTripRunOptions {
  cwd?: string;
  snapshot?: VfsSnapshotOptions;
}

export interface RoundTripRunResult {
  manifest: RoundTripManifest;
  mappingSpec: MappingSpec;
  validationIssues: ValidationIssue[];
  syncResult: Awaited<ReturnType<SchemaAdapter["sync"]>>;
  actualSnapshot: string;
  expectedSnapshot: string;
  vfs: VfsSnapshotClient;
}

export function describeRoundTripFixture(
  manifestPath: string,
  options: RoundTripRunOptions = {}
): void {
  describe(`round-trip fixture ${manifestPath}`, () => {
    test("syncs into the expected VFS snapshot", async () => {
      await expectRoundTripFixture(manifestPath, options);
    });
  });
}

export async function expectRoundTripFixture(
  manifestPath: string,
  options: RoundTripRunOptions = {}
): Promise<RoundTripRunResult> {
  const result = await runRoundTripFixture(manifestPath, options);

  expect(
    result.validationIssues.filter((issue) => issue.level === "error"),
    formatValidationIssues(result.validationIssues)
  ).toEqual([]);
  expect(result.syncResult.errors).toEqual([]);
  expect(result.actualSnapshot).toBe(result.expectedSnapshot);

  return result;
}

export async function runRoundTripFixture(
  manifestPath: string,
  options: RoundTripRunOptions = {}
): Promise<RoundTripRunResult> {
  const { manifest, manifestDir } = await loadRoundTripManifest(
    manifestPath,
    options.cwd
  );
  const mappingSpec = await loadMappingSpec(manifest.mapping, manifestDir);
  const serviceSpec = await loadServiceSpecFromMapping(
    mappingWithManifestSource(mappingSpec, manifest),
    manifestDir
  );
  const validation = validateMappingSpec(mappingSpec, serviceSpec);
  const httpFixture = await loadHttpFixture(manifest, manifestDir);
  const replayFixture = materializeReplayFixture(
    manifest,
    httpFixture,
    mappingSpec
  );
  const provider = createFakeConnection(replayFixture, {
    name: manifest.adapter ?? mappingSpec.adapter.name,
  });
  const vfs = createVfsSnapshotClient(manifest.initialFiles ?? {});
  const adapter = new SchemaAdapter({
    client: vfs.client,
    provider,
    spec: mappingSpec,
    defaultConnectionId: manifest.sync.connectionId,
  });

  const syncResult = await adapter.sync(
    manifest.sync.workspaceId,
    manifest.sync.resourceName,
    buildSyncOptions(manifest)
  );
  provider.assertExhausted();

  const actualSnapshot = normalizeSnapshotText(
    vfs.snapshotJsonl(buildSnapshotOptions(manifest, options.snapshot))
  );
  const expectedSnapshot = normalizeSnapshotText(
    await readFile(resolve(manifestDir, manifest.expectedSnapshot), "utf8")
  );

  return {
    manifest,
    mappingSpec,
    validationIssues: validation.issues,
    syncResult,
    actualSnapshot,
    expectedSnapshot,
    vfs,
  };
}

export async function loadRoundTripManifest(
  manifestPath: string,
  cwd = process.cwd()
): Promise<LoadedRoundTripManifest> {
  const manifestPathAbsolute = resolve(cwd, manifestPath);
  const manifest = parseRoundTripManifest(
    await readJson(manifestPathAbsolute),
    manifestPathAbsolute
  );

  return {
    manifestPath: manifestPathAbsolute,
    manifestDir: dirname(manifestPathAbsolute),
    manifest,
  };
}

function mappingWithManifestSource(
  mappingSpec: MappingSpec,
  manifest: RoundTripManifest
): MappingSpec {
  if (!manifest.openapi) {
    return mappingSpec;
  }

  return {
    ...mappingSpec,
    adapter: {
      ...mappingSpec.adapter,
      source: {
        openapi: manifest.openapi,
      },
    },
  };
}

async function loadHttpFixture(
  manifest: RoundTripManifest,
  manifestDir: string
): Promise<HttpReplayFixture> {
  return readJson(resolve(manifestDir, manifest.fixture)) as Promise<HttpReplayFixture>;
}

function materializeReplayFixture(
  manifest: RoundTripManifest,
  httpFixture: HttpReplayFixture,
  mappingSpec: MappingSpec
): HttpReplayFixture {
  if (!manifest.replay?.requests?.length) {
    return httpFixture;
  }

  const fixtureInteractions = readFixtureInteractions(httpFixture);

  return {
    interactions: manifest.replay.requests.map((request, index) => {
      const fallback = fixtureInteractions[index];

      return {
        request: buildReplayRequest(
          manifest,
          mappingSpec,
          request,
          fallback?.request
        ),
        response: {
          status: fallback?.response.status ?? 200,
          headers: fallback?.response.headers ?? {},
          data: readReplayResponseData(request, fallback),
        },
      };
    }),
  };
}

function buildReplayRequest(
  manifest: RoundTripManifest,
  mappingSpec: MappingSpec,
  request: RoundTripReplayRequest,
  fallback: HttpReplayRequest | undefined
): HttpReplayRequest {
  return stripUndefined({
    method: request.method,
    baseUrl:
      request.baseUrl ??
      manifest.replay?.baseUrl ??
      fallback?.baseUrl ??
      mappingSpec.adapter.baseUrl ??
      "",
    endpoint: request.endpoint,
    connectionId:
      request.connectionId ??
      manifest.sync.connectionId ??
      fallback?.connectionId ??
      "",
    headers: request.headers,
    body: cloneJson(request.body),
    query: request.query,
  });
}

function readReplayResponseData(
  request: RoundTripReplayRequest,
  fallback: HttpReplayInteraction | undefined
): unknown {
  const data = fallback?.response.data;
  if (request.sourceFixture && Array.isArray(data) && data.length === 1) {
    return cloneJson(data[0]);
  }

  return cloneJson(data);
}

function readFixtureInteractions(
  fixture: HttpReplayFixture
): readonly HttpReplayInteraction[] {
  if (Array.isArray(fixture)) {
    return fixture;
  }

  return fixture.interactions ?? fixture.requests ?? fixture.http ?? [];
}

function buildSyncOptions(manifest: RoundTripManifest): SchemaSyncOptions {
  return stripUndefined({
    ...(manifest.sync.options ?? {}),
    connectionId: manifest.sync.connectionId,
    input: manifest.sync.input,
    params: manifest.sync.params,
    query: manifest.sync.query,
  }) as SchemaSyncOptions;
}

function buildSnapshotOptions(
  manifest: RoundTripManifest,
  overrides: VfsSnapshotOptions | undefined
): VfsSnapshotOptions {
  const includeSyncState = manifest.snapshot?.includeSyncState ?? true;

  return {
    ...overrides,
    runtimeOnlyFields:
      overrides?.runtimeOnlyFields ?? manifest.snapshot?.runtimeOnlyFields,
    includePath:
      overrides?.includePath ??
      (includeSyncState
        ? undefined
        : (path) =>
            !path.startsWith(".sync-state/") &&
            !path.startsWith("/.sync-state/")),
  };
}

function parseRoundTripManifest(
  value: unknown,
  location: string
): RoundTripManifest {
  const manifest = readRecord(value, location);
  const schemaVersion = readNumber(manifest.schemaVersion, "schemaVersion");
  if (schemaVersion !== 1) {
    throw new Error("schemaVersion must be 1");
  }

  const sync = readRecord(manifest.sync, "sync");

  return {
    schemaVersion: 1,
    name: readRequiredString(manifest.name, "name"),
    description: readString(manifest.description),
    adapter: readString(manifest.adapter),
    mapping: readRequiredString(manifest.mapping, "mapping"),
    openapi: readString(manifest.openapi),
    fixture: readRequiredString(manifest.fixture, "fixture"),
    expectedSnapshot: readRequiredString(
      manifest.expectedSnapshot,
      "expectedSnapshot"
    ),
    sync: {
      resourceName: readRequiredString(sync.resourceName, "sync.resourceName"),
      workspaceId: readRequiredString(sync.workspaceId, "sync.workspaceId"),
      connectionId: readString(sync.connectionId),
      input: readOptionalRecord(sync.input, "sync.input"),
      params: readOptionalRecord(sync.params, "sync.params"),
      query: readOptionalRecord(sync.query, "sync.query"),
      options: readOptionalRecord(sync.options, "sync.options"),
    },
    replay:
      manifest.replay === undefined
        ? undefined
        : parseReplayManifest(readRecord(manifest.replay, "replay")),
    initialFiles:
      manifest.initialFiles === undefined
        ? undefined
        : (readRecord(manifest.initialFiles, "initialFiles") as Record<
            string,
            StoredVfsFile
          >),
    snapshot:
      manifest.snapshot === undefined
        ? undefined
        : parseSnapshotManifest(readRecord(manifest.snapshot, "snapshot")),
  };
}

function parseReplayManifest(
  value: Record<string, unknown>
): RoundTripReplayManifest {
  return {
    baseUrl: readString(value.baseUrl),
    requests: Array.isArray(value.requests)
      ? value.requests.map((item, index) =>
          parseReplayRequest(readRecord(item, `replay.requests[${index}]`))
        )
      : undefined,
  };
}

function parseReplayRequest(
  value: Record<string, unknown>
): RoundTripReplayRequest {
  return {
    method: readHttpMethod(value.method, "replay.requests.method"),
    endpoint: readRequiredString(value.endpoint, "replay.requests.endpoint"),
    baseUrl: readString(value.baseUrl),
    connectionId: readString(value.connectionId),
    headers: readOptionalStringRecord(value.headers, "replay.requests.headers"),
    body: cloneJson(value.body),
    query: readOptionalStringRecord(value.query, "replay.requests.query"),
    sourceFixture: readString(value.sourceFixture),
  };
}

function parseSnapshotManifest(
  value: Record<string, unknown>
): RoundTripSnapshotManifest {
  return {
    includeSyncState:
      typeof value.includeSyncState === "boolean"
        ? value.includeSyncState
        : undefined,
    runtimeOnlyFields: Array.isArray(value.runtimeOnlyFields)
      ? value.runtimeOnlyFields.filter(
          (item): item is string => typeof item === "string"
        )
      : undefined,
  };
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

function normalizeSnapshotText(value: string): string {
  const trimmed = value.trimEnd();
  return trimmed.length > 0 ? `${trimmed}\n` : "";
}

function formatValidationIssues(issues: readonly ValidationIssue[]): string {
  if (issues.length === 0) {
    return "Mapping validation produced no issues.";
  }

  return issues
    .map((issue) => `${issue.level}: ${issue.path}: ${issue.message}`)
    .join("\n");
}

function readHttpMethod(
  value: unknown,
  field: string
): HttpReplayRequest["method"] {
  if (
    value === "DELETE" ||
    value === "GET" ||
    value === "PATCH" ||
    value === "POST" ||
    value === "PUT"
  ) {
    return value;
  }

  throw new Error(`${field} must be one of DELETE, GET, PATCH, POST, PUT`);
}

function readRequiredString(value: unknown, field: string): string {
  const stringValue = readString(value);
  if (!stringValue) {
    throw new Error(`${field} must be a non-empty string`);
  }

  return stringValue;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function readNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${field} must be a number`);
  }

  return value;
}

function readOptionalRecord(
  value: unknown,
  field: string
): Record<string, unknown> | undefined {
  return value === undefined ? undefined : readRecord(value, field);
}

function readRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }

  return value as Record<string, unknown>;
}

function readOptionalStringRecord(
  value: unknown,
  field: string
): Record<string, string> | undefined {
  if (value === undefined) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(readRecord(value, field)).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string"
    )
  );
}

function stripUndefined<TValue extends Record<string, unknown>>(
  value: TValue
): TValue {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined)
  ) as TValue;
}

function cloneJson<TValue>(value: TValue): TValue {
  if (value === undefined || value === null || typeof value !== "object") {
    return value;
  }

  return JSON.parse(JSON.stringify(value)) as TValue;
}
