import test from "node:test";
import assert from "node:assert/strict";
import { SchemaAdapter } from "../../src/runtime/schema-adapter.js";
import type { MappingSpec } from "../../src/spec/types.js";

type StoredFile = {
  content: string;
  revision: string;
};

type WriteInput = {
  workspaceId: string;
  path: string;
  baseRevision: string;
  content: string;
  contentType?: string;
  encoding?: string;
  semantics?: unknown;
  signal?: AbortSignal;
};

type ProxyCall = {
  method: string;
  baseUrl: string;
  endpoint: string;
  connectionId: string;
  query?: Record<string, string>;
  signal?: AbortSignal;
};

type ProxyResponseFixture = {
  status: number;
  headers: Record<string, string>;
  data: unknown;
};

const issueCheckpointPath =
  ".sync-state/github/issues/issues-by-repo-buk3ld.json";

function createCursorSpec(): MappingSpec {
  return {
    adapter: {
      name: "github",
      version: "1.0.0",
      baseUrl: "https://api.github.com",
      source: { openapi: "./openapi.yaml" },
    },
    webhooks: {},
    resources: {
      issues: {
        endpoint: "GET /repos/{owner}/{repo}/issues",
        path: "/github/repos/{{owner}}/{{repo}}/issues/{{id}}.json",
        iterate: true,
        extract: ["id", "title", "status", "updated_at"],
        pagination: {
          strategy: "cursor",
          cursorPath: "paging.next",
          paramName: "after",
        },
        sync: {
          modelName: "issue",
          cursorField: "updated_at",
          checkpointKey: "issues-by-repo",
        },
      },
    },
  };
}

function createMemoryClient(
  initialFiles: Record<string, StoredFile> = {},
  onWrite?: (input: WriteInput) => void
): {
  client: any;
  writes: WriteInput[];
  files: Map<string, StoredFile>;
} {
  const files = new Map<string, StoredFile>(Object.entries(initialFiles));
  const writes: WriteInput[] = [];
  let nextRevision = 1;

  return {
    files,
    writes,
    client: {
      async ingestWebhook() {
        return { status: "queued", id: "q_123" };
      },
      async readFile(
        _workspaceId: string,
        path: string,
        _correlationId?: string,
        signal?: AbortSignal
      ) {
        throwIfAborted(signal);
        const file = files.get(path);
        if (!file) {
          throw new Error(`No stored file for ${path}`);
        }
        return file;
      },
      async writeFile(input: WriteInput) {
        throwIfAborted(input.signal);
        writes.push(input);
        onWrite?.(input);
        throwIfAborted(input.signal);

        const revision = `rev-${nextRevision}`;
        nextRevision += 1;
        files.set(input.path, {
          content: input.content,
          revision,
        });

        return { revision };
      },
    },
  };
}

function createProvider(responses: ProxyResponseFixture[]): {
  provider: any;
  calls: ProxyCall[];
} {
  const calls: ProxyCall[] = [];

  return {
    calls,
    provider: {
      name: "provider",
      async proxy(input: ProxyCall) {
        calls.push({
          ...input,
          query: input.query ? { ...input.query } : undefined,
        });

        const response = responses[calls.length - 1];
        if (!response) {
          throw new Error(`Unexpected proxy call ${calls.length}`);
        }
        return response;
      },
      async healthCheck() {
        return true;
      },
    },
  };
}

function recordWrites(writes: WriteInput[]): WriteInput[] {
  return writes.filter((write) => !write.path.startsWith(".sync-state/"));
}

function checkpointWrites(writes: WriteInput[]): WriteInput[] {
  return writes.filter((write) => write.path.startsWith(".sync-state/"));
}

function parseJson(content: string): Record<string, unknown> {
  return JSON.parse(content) as Record<string, unknown>;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) {
    return;
  }

  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  throw error;
}

test("SchemaAdapter sync paginates provider.proxy responses into workspace files and checkpoints", async () => {
  const { client, writes } = createMemoryClient();
  const { provider, calls } = createProvider([
    {
      status: 200,
      headers: {},
      data: {
        data: [
          {
            id: "1",
            title: "First",
            status: "open",
            updated_at: "2026-01-01T00:00:01.000Z",
            ignored: true,
          },
          {
            id: "2",
            title: "Second",
            status: "triaged",
            updated_at: "2026-01-01T00:00:02.000Z",
          },
        ],
        paging: { next: "cursor-2" },
      },
    },
    {
      status: 200,
      headers: {},
      data: {
        data: [
          {
            id: "3",
            title: "Third",
            status: "closed",
            updated_at: "2026-01-01T00:00:03.000Z",
          },
        ],
        paging: { next: null },
      },
    },
  ]);
  const adapter = new SchemaAdapter({
    client,
    provider,
    spec: createCursorSpec(),
    defaultConnectionId: "conn_default",
  });

  const result = await adapter.sync("ws_123", "issues", {
    input: { owner: "acme", repo: "demo" },
    query: { state: "all" },
    watermark: "2026-01-01T00:00:00.000Z",
    watermarkParamName: "updated_since",
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((call) => call.query), [
    {
      state: "all",
      updated_since: "2026-01-01T00:00:00.000Z",
    },
    {
      state: "all",
      updated_since: "2026-01-01T00:00:00.000Z",
      after: "cursor-2",
    },
  ]);
  assert.deepEqual(
    calls.map((call) => ({
      method: call.method,
      baseUrl: call.baseUrl,
      endpoint: call.endpoint,
      connectionId: call.connectionId,
    })),
    [
      {
        method: "GET",
        baseUrl: "https://api.github.com",
        endpoint: "/repos/acme/demo/issues",
        connectionId: "conn_default",
      },
      {
        method: "GET",
        baseUrl: "https://api.github.com",
        endpoint: "/repos/acme/demo/issues",
        connectionId: "conn_default",
      },
    ]
  );

  const syncedFiles = recordWrites(writes);
  assert.deepEqual(
    syncedFiles.map((write) => ({
      workspaceId: write.workspaceId,
      path: write.path,
      baseRevision: write.baseRevision,
      contentType: write.contentType,
      encoding: write.encoding,
    })),
    [
      {
        workspaceId: "ws_123",
        path: "/github/repos/acme/demo/issues/1.json",
        baseRevision: "0",
        contentType: "application/json",
        encoding: "utf-8",
      },
      {
        workspaceId: "ws_123",
        path: "/github/repos/acme/demo/issues/2.json",
        baseRevision: "0",
        contentType: "application/json",
        encoding: "utf-8",
      },
      {
        workspaceId: "ws_123",
        path: "/github/repos/acme/demo/issues/3.json",
        baseRevision: "0",
        contentType: "application/json",
        encoding: "utf-8",
      },
    ]
  );
  assert.equal(
    syncedFiles[0]?.content,
    `${JSON.stringify(
      {
        id: "1",
        title: "First",
        status: "open",
        updated_at: "2026-01-01T00:00:01.000Z",
      },
      null,
      2
    )}\n`
  );
  assert.deepEqual(syncedFiles[0]?.semantics, {
    properties: {
      provider: "github",
      "provider.object_type": "issue",
      "provider.object_id": "1",
      "provider.status": "open",
    },
  });

  const checkpoints = checkpointWrites(writes).map((write) =>
    parseJson(write.content)
  );
  assert.equal(checkpoints.length, 2);
  assert.deepEqual(
    {
      adapter: checkpoints[0]?.adapter,
      resourceName: checkpoints[0]?.resourceName,
      checkpointKey: checkpoints[0]?.checkpointKey,
      cursor: checkpoints[0]?.cursor,
      nextCursor: checkpoints[0]?.nextCursor,
      watermark: checkpoints[0]?.watermark,
      pagesSynced: checkpoints[0]?.pagesSynced,
      recordsSynced: checkpoints[0]?.recordsSynced,
    },
    {
      adapter: "github",
      resourceName: "issues",
      checkpointKey: "issues-by-repo",
      cursor: "cursor-2",
      nextCursor: "cursor-2",
      watermark: "2026-01-01T00:00:02.000Z",
      pagesSynced: 1,
      recordsSynced: 2,
    }
  );
  assert.deepEqual(
    {
      adapter: checkpoints[1]?.adapter,
      resourceName: checkpoints[1]?.resourceName,
      checkpointKey: checkpoints[1]?.checkpointKey,
      nextCursor: checkpoints[1]?.nextCursor,
      watermark: checkpoints[1]?.watermark,
      pagesSynced: checkpoints[1]?.pagesSynced,
      recordsSynced: checkpoints[1]?.recordsSynced,
    },
    {
      adapter: "github",
      resourceName: "issues",
      checkpointKey: "issues-by-repo",
      nextCursor: null,
      watermark: "2026-01-01T00:00:03.000Z",
      pagesSynced: 2,
      recordsSynced: 3,
    }
  );
  assert.equal(Object.hasOwn(checkpoints[1] ?? {}, "cursor"), false);

  assert.deepEqual(result, {
    filesWritten: 3,
    filesUpdated: 0,
    filesDeleted: 0,
    paths: [
      "/github/repos/acme/demo/issues/1.json",
      "/github/repos/acme/demo/issues/2.json",
      "/github/repos/acme/demo/issues/3.json",
    ],
    cursor: undefined,
    nextCursor: null,
    syncedObjectTypes: ["issue"],
    errors: [],
  });
});

test("SchemaAdapter sync resumes from a stored checkpoint and rewrites it with the stored revision", async () => {
  const { client, writes } = createMemoryClient({
    [issueCheckpointPath]: {
      revision: "rev-checkpoint-existing",
      content: `${JSON.stringify(
        {
          adapter: "github",
          resourceName: "issues",
          checkpointKey: "issues-by-repo",
          cursor: "cursor-resume",
          nextCursor: "cursor-resume",
          watermark: "2026-02-01T00:00:00.000Z",
          pagesSynced: 7,
          recordsSynced: 14,
        },
        null,
        2
      )}\n`,
    },
  });
  const { provider, calls } = createProvider([
    {
      status: 200,
      headers: {},
      data: {
        data: [
          {
            id: "9",
            title: "Resumed",
            status: "closed",
            updated_at: "2026-02-01T00:00:05.000Z",
          },
        ],
        paging: { next: null },
      },
    },
  ]);
  const adapter = new SchemaAdapter({
    client,
    provider,
    spec: createCursorSpec(),
    defaultConnectionId: "conn_default",
  });

  const result = await adapter.sync("issues", {
    workspaceId: "ws_123",
    input: { owner: "acme", repo: "demo" },
    connectionId: "conn_resume",
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.query, {
    since: "2026-02-01T00:00:00.000Z",
    after: "cursor-resume",
  });
  assert.equal(calls[0]?.connectionId, "conn_resume");

  const checkpoints = checkpointWrites(writes);
  assert.equal(checkpoints.length, 1);
  assert.equal(checkpoints[0]?.path, issueCheckpointPath);
  assert.equal(checkpoints[0]?.baseRevision, "rev-checkpoint-existing");
  assert.deepEqual(
    {
      nextCursor: parseJson(checkpoints[0]?.content ?? "{}").nextCursor,
      watermark: parseJson(checkpoints[0]?.content ?? "{}").watermark,
      pagesSynced: parseJson(checkpoints[0]?.content ?? "{}").pagesSynced,
      recordsSynced: parseJson(checkpoints[0]?.content ?? "{}").recordsSynced,
    },
    {
      nextCursor: null,
      watermark: "2026-02-01T00:00:05.000Z",
      pagesSynced: 8,
      recordsSynced: 15,
    }
  );
  assert.deepEqual(result, {
    filesWritten: 1,
    filesUpdated: 0,
    filesDeleted: 0,
    paths: ["/github/repos/acme/demo/issues/9.json"],
    cursor: "cursor-resume",
    nextCursor: null,
    syncedObjectTypes: ["issue"],
    errors: [],
  });
});

test("SchemaAdapter sync stops deterministically at maxPages while preserving the next cursor", async () => {
  const { client, writes } = createMemoryClient();
  const { provider, calls } = createProvider([
    {
      status: 200,
      headers: {},
      data: {
        items: [
          { id: "lin_1", title: "One", updatedAt: 10 },
          { id: "lin_2", title: "Two", updatedAt: 20 },
        ],
      },
    },
    {
      status: 200,
      headers: {},
      data: {
        items: [{ id: "lin_3", title: "Three", updatedAt: 30 }],
      },
    },
  ]);
  const adapter = new SchemaAdapter({
    client,
    provider,
    spec: {
      adapter: {
        name: "linear",
        version: "1.0.0",
        baseUrl: "https://api.linear.app",
        source: { openapi: "./openapi.yaml" },
      },
      webhooks: {},
      resources: {
        tickets: {
          endpoint: "GET /teams/{teamId}/issues",
          path: "/linear/teams/{{teamId}}/issues/{{id}}.json",
          iterate: true,
          extract: ["id", "title", "updatedAt"],
          pagination: {
            strategy: "page",
            paramName: "page",
            limitParamName: "per_page",
            pageSize: 2,
          },
          sync: {
            modelName: "ticket",
            cursorField: "updatedAt",
          },
        },
      },
    },
    defaultConnectionId: "conn_linear",
  });

  const result = await adapter.sync("ws_123", "tickets", {
    input: { teamId: "eng" },
    maxPages: 1,
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.query, {
    page: "1",
    per_page: "2",
  });
  assert.deepEqual(
    recordWrites(writes).map((write) => write.path),
    [
      "/linear/teams/eng/issues/lin_1.json",
      "/linear/teams/eng/issues/lin_2.json",
    ]
  );

  const checkpoint = parseJson(checkpointWrites(writes)[0]?.content ?? "{}");
  assert.deepEqual(
    {
      cursor: checkpoint.cursor,
      nextCursor: checkpoint.nextCursor,
      watermark: checkpoint.watermark,
      pagesSynced: checkpoint.pagesSynced,
      recordsSynced: checkpoint.recordsSynced,
    },
    {
      cursor: "2",
      nextCursor: "2",
      watermark: "20",
      pagesSynced: 1,
      recordsSynced: 2,
    }
  );
  assert.deepEqual(result, {
    filesWritten: 2,
    filesUpdated: 0,
    filesDeleted: 0,
    paths: [
      "/linear/teams/eng/issues/lin_1.json",
      "/linear/teams/eng/issues/lin_2.json",
    ],
    cursor: undefined,
    nextCursor: "2",
    syncedObjectTypes: ["ticket"],
    errors: [],
  });
});

test("SchemaAdapter sync scopes checkpoints by resource input", async () => {
  const { client, writes } = createMemoryClient();
  const { provider } = createProvider([
    {
      status: 200,
      headers: {},
      data: { data: [{ id: "1", title: "First", updated_at: "2026-01-01" }] },
    },
    {
      status: 200,
      headers: {},
      data: { data: [{ id: "2", title: "Second", updated_at: "2026-01-02" }] },
    },
  ]);
  const adapter = new SchemaAdapter({
    client,
    provider,
    spec: createCursorSpec(),
    defaultConnectionId: "conn_default",
  });

  await adapter.sync("ws_123", "issues", {
    input: { owner: "acme", repo: "demo" },
  });
  await adapter.sync("ws_123", "issues", {
    input: { owner: "octo", repo: "demo" },
  });

  const paths = checkpointWrites(writes).map((write) => write.path);
  assert.equal(paths.length, 2);
  assert.equal(new Set(paths).size, 2);
  assert.ok(
    paths.every((path) =>
      path.startsWith(".sync-state/github/issues/issues-by-repo-")
    )
  );
});

test("SchemaAdapter sync withholds checkpoint advancement when a record write fails", async () => {
  const { client, writes } = createMemoryClient({}, (input) => {
    if (input.path === "/github/repos/acme/demo/issues/2.json") {
      throw new Error("write failed");
    }
  });
  const { provider } = createProvider([
    {
      status: 200,
      headers: {},
      data: {
        data: [
          {
            id: "1",
            title: "First",
            status: "open",
            updated_at: "2026-01-01T00:00:01.000Z",
          },
          {
            id: "2",
            title: "Second",
            status: "open",
            updated_at: "2026-01-01T00:00:02.000Z",
          },
        ],
        paging: { next: "cursor-2" },
      },
    },
  ]);
  const adapter = new SchemaAdapter({
    client,
    provider,
    spec: createCursorSpec(),
    defaultConnectionId: "conn_default",
  });

  const result = await adapter.sync("ws_123", "issues", {
    input: { owner: "acme", repo: "demo" },
  });

  assert.equal(result.filesWritten, 1);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0]?.path, "/github/repos/acme/demo/issues/2.json");
  assert.equal(checkpointWrites(writes).length, 0);
});

test("SchemaAdapter sync stops link-header pagination on repeated next links", async () => {
  const repeatedTarget = "https://api.example.com/items?page=2";
  const repeatedNext = `<${repeatedTarget}>; rel="next"`;
  const { client, writes } = createMemoryClient();
  const { provider, calls } = createProvider([
    {
      status: 200,
      headers: { link: repeatedNext },
      data: { items: [{ id: "1", updatedAt: 1 }] },
    },
    {
      status: 200,
      headers: { link: repeatedNext },
      data: { items: [{ id: "2", updatedAt: 2 }] },
    },
  ]);
  const adapter = new SchemaAdapter({
    client,
    provider,
    spec: {
      adapter: {
        name: "example",
        version: "1.0.0",
        baseUrl: "https://api.example.com",
        source: { openapi: "./openapi.yaml" },
      },
      webhooks: {},
      resources: {
        items: {
          endpoint: "GET /items",
          path: "/example/items/{{id}}.json",
          iterate: true,
          pagination: { strategy: "link-header" },
          sync: { modelName: "item", cursorField: "updatedAt" },
        },
      },
    },
    defaultConnectionId: "conn_default",
  });

  const result = await adapter.sync("ws_123", "items");

  assert.equal(calls.length, 2);
  assert.deepEqual(
    calls.map((call) => ({ endpoint: call.endpoint, query: call.query })),
    [
      { endpoint: "/items", query: undefined },
      { endpoint: "/items", query: { page: "2" } },
    ]
  );
  assert.equal(result.filesWritten, 1);
  assert.equal(result.nextCursor, repeatedTarget);
  const syncedFiles = recordWrites(writes);
  assert.deepEqual(
    syncedFiles.map((write) => write.path),
    ["/example/items/1.json"]
  );
  assert.equal(
    syncedFiles.some((write) => write.path === "/example/items/2.json"),
    false
  );
  const checkpoints = checkpointWrites(writes);
  assert.equal(checkpoints.length, 1);
  assert.deepEqual(
    {
      nextCursor: parseJson(checkpoints[0]?.content ?? "{}").nextCursor,
      watermark: parseJson(checkpoints[0]?.content ?? "{}").watermark,
      pagesSynced: parseJson(checkpoints[0]?.content ?? "{}").pagesSynced,
      recordsSynced: parseJson(checkpoints[0]?.content ?? "{}").recordsSynced,
    },
    {
      nextCursor: repeatedTarget,
      watermark: "1",
      pagesSynced: 1,
      recordsSynced: 1,
    }
  );
  assert.deepEqual(result.errors, [
    {
      objectType: "item",
      error:
        `Pagination stalled for items: repeated link-header target ${repeatedTarget}.`,
    },
  ]);
});

test("SchemaAdapter sync stops page pagination without an effective page size", async () => {
  const { client } = createMemoryClient();
  const { provider, calls } = createProvider([
    {
      status: 200,
      headers: {},
      data: { items: [{ id: "1", updatedAt: 1 }, { id: "2", updatedAt: 2 }] },
    },
    {
      status: 200,
      headers: {},
      data: { items: [{ id: "3", updatedAt: 3 }, { id: "4", updatedAt: 4 }] },
    },
  ]);
  const adapter = new SchemaAdapter({
    client,
    provider,
    spec: {
      adapter: {
        name: "linear",
        version: "1.0.0",
        baseUrl: "https://api.linear.app",
        source: { openapi: "./openapi.yaml" },
      },
      webhooks: {},
      resources: {
        tickets: {
          endpoint: "GET /teams/{teamId}/issues",
          path: "/linear/teams/{{teamId}}/issues/{{id}}.json",
          iterate: true,
          pagination: {
            strategy: "page",
            paramName: "page",
          },
          sync: { modelName: "ticket", cursorField: "updatedAt" },
        },
      },
    },
    defaultConnectionId: "conn_linear",
  });

  const result = await adapter.sync("ws_123", "tickets", {
    input: { teamId: "eng" },
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.query, { page: "1" });
  assert.equal(result.filesWritten, 2);
  assert.equal(result.nextCursor, null);
});

test("SchemaAdapter sync rejects before provider calls when already aborted", async () => {
  const controller = new AbortController();
  controller.abort();
  const { client } = createMemoryClient();
  const { provider, calls } = createProvider([
    { status: 200, headers: {}, data: { data: [] } },
  ]);
  const adapter = new SchemaAdapter({
    client,
    provider,
    spec: createCursorSpec(),
    defaultConnectionId: "conn_default",
  });

  await assert.rejects(
    () =>
      adapter.sync("ws_123", "issues", {
        input: { owner: "acme", repo: "demo" },
        signal: controller.signal,
      }),
    (error) => error instanceof Error && error.name === "AbortError"
  );
  assert.equal(calls.length, 0);
});

test("SchemaAdapter sync passes AbortSignal to provider.proxy and propagates provider aborts", async () => {
  const controller = new AbortController();
  const { client } = createMemoryClient();
  const calls: ProxyCall[] = [];
  const abortError = new Error("provider aborted");
  abortError.name = "AbortError";
  const adapter = new SchemaAdapter({
    client,
    provider: {
      name: "provider",
      async proxy(input: ProxyCall) {
        calls.push(input);
        throw abortError;
      },
      async healthCheck() {
        return true;
      },
    } as any,
    spec: createCursorSpec(),
    defaultConnectionId: "conn_default",
  });

  await assert.rejects(
    () =>
      adapter.sync("ws_123", "issues", {
        input: { owner: "acme", repo: "demo" },
        signal: controller.signal,
      }),
    (error) => error === abortError
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.signal, controller.signal);
});

test("SchemaAdapter sync propagates AbortSignal during checkpoint writes", async () => {
  const controller = new AbortController();
  const { client, writes } = createMemoryClient({}, (input) => {
    if (input.path.startsWith(".sync-state/")) {
      controller.abort();
    }
  });
  const { provider } = createProvider([
    {
      status: 200,
      headers: {},
      data: {
        data: [
          {
            id: "1",
            title: "Before checkpoint abort",
            updated_at: "2026-04-01T00:00:01.000Z",
          },
        ],
        paging: { next: null },
      },
    },
  ]);
  const adapter = new SchemaAdapter({
    client,
    provider,
    spec: createCursorSpec(),
    defaultConnectionId: "conn_default",
  });

  await assert.rejects(
    () =>
      adapter.sync("ws_123", "issues", {
        input: { owner: "acme", repo: "demo" },
        signal: controller.signal,
      }),
    (error) => error instanceof Error && error.name === "AbortError"
  );
  assert.equal(recordWrites(writes).length, 1);
  assert.equal(checkpointWrites(writes).length, 1);
});

test("SchemaAdapter sync honors AbortSignal before writing a later checkpoint", async () => {
  const controller = new AbortController();
  const { client, writes } = createMemoryClient({}, (input) => {
    if (input.path === "/github/repos/acme/demo/issues/2.json") {
      controller.abort();
    }
  });
  const { provider, calls } = createProvider([
    {
      status: 200,
      headers: {},
      data: {
        data: [
          {
            id: "1",
            title: "Before abort",
            status: "open",
            updated_at: "2026-03-01T00:00:01.000Z",
          },
        ],
        paging: { next: "cursor-2" },
      },
    },
    {
      status: 200,
      headers: {},
      data: {
        data: [
          {
            id: "2",
            title: "Abort after write",
            status: "open",
            updated_at: "2026-03-01T00:00:02.000Z",
          },
        ],
        paging: { next: null },
      },
    },
  ]);
  const adapter = new SchemaAdapter({
    client,
    provider,
    spec: createCursorSpec(),
    defaultConnectionId: "conn_default",
  });

  await assert.rejects(
    () =>
      adapter.sync("ws_123", "issues", {
        input: { owner: "acme", repo: "demo" },
        signal: controller.signal,
      }),
    (error) => error instanceof Error && error.name === "AbortError"
  );

  assert.equal(calls.length, 2);
  assert.deepEqual(
    recordWrites(writes).map((write) => write.path),
    [
      "/github/repos/acme/demo/issues/1.json",
      "/github/repos/acme/demo/issues/2.json",
    ]
  );

  const checkpoints = checkpointWrites(writes);
  assert.equal(checkpoints.length, 1);
  assert.deepEqual(
    {
      path: checkpoints[0]?.path,
      nextCursor: parseJson(checkpoints[0]?.content ?? "{}").nextCursor,
      watermark: parseJson(checkpoints[0]?.content ?? "{}").watermark,
    },
    {
      path: issueCheckpointPath,
      nextCursor: "cursor-2",
      watermark: "2026-03-01T00:00:01.000Z",
    }
  );
});

test("SchemaAdapter sync stops offset pagination when provider repeats full page data", async () => {
  const { client, writes } = createMemoryClient();
  const { provider, calls } = createProvider([
    {
      status: 200,
      headers: {},
      data: {
        items: [
          { id: "offset_1", title: "One", updatedAt: 10 },
          { id: "offset_2", title: "Two", updatedAt: 20 },
        ],
      },
    },
    {
      status: 200,
      headers: {},
      data: {
        items: [
          { id: "offset_1", title: "One", updatedAt: 10 },
          { id: "offset_2", title: "Two", updatedAt: 20 },
        ],
      },
    },
  ]);
  const adapter = new SchemaAdapter({
    client,
    provider,
    spec: {
      adapter: {
        name: "linear",
        version: "1.0.0",
        baseUrl: "https://api.linear.app",
        source: { openapi: "./openapi.yaml" },
      },
      webhooks: {},
      resources: {
        tickets: {
          endpoint: "GET /teams/{teamId}/issues",
          path: "/linear/teams/{{teamId}}/issues/{{id}}.json",
          iterate: true,
          pagination: {
            strategy: "offset",
            paramName: "offset",
            limitParamName: "limit",
            pageSize: 2,
          },
          sync: { modelName: "ticket", cursorField: "updatedAt" },
        },
      },
    },
    defaultConnectionId: "conn_linear",
  });

  const result = await adapter.sync("ws_123", "tickets", {
    input: { teamId: "eng" },
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((call) => call.query), [
    { offset: "0", limit: "2" },
    { offset: "2", limit: "2" },
  ]);
  assert.deepEqual(
    recordWrites(writes).map((write) => write.path),
    [
      "/linear/teams/eng/issues/offset_1.json",
      "/linear/teams/eng/issues/offset_2.json",
    ]
  );
  assert.equal(checkpointWrites(writes).length, 1);
  assert.deepEqual(
    {
      filesWritten: result.filesWritten,
      nextCursor: result.nextCursor,
      errors: result.errors,
    },
    {
      filesWritten: 2,
      nextCursor: "2",
      errors: [
        {
          objectType: "ticket",
          error: "Pagination stalled for tickets: repeated page data.",
        },
      ],
    }
  );
});

test("SchemaAdapter sync stops page pagination when provider repeats full page data", async () => {
  const { client, writes } = createMemoryClient();
  const { provider, calls } = createProvider([
    {
      status: 200,
      headers: {},
      data: {
        items: [
          { id: "page_1", title: "One", updatedAt: 10 },
          { id: "page_2", title: "Two", updatedAt: 20 },
        ],
      },
    },
    {
      status: 200,
      headers: {},
      data: {
        items: [
          { id: "page_1", title: "One", updatedAt: 10 },
          { id: "page_2", title: "Two", updatedAt: 20 },
        ],
      },
    },
  ]);
  const adapter = new SchemaAdapter({
    client,
    provider,
    spec: {
      adapter: {
        name: "linear",
        version: "1.0.0",
        baseUrl: "https://api.linear.app",
        source: { openapi: "./openapi.yaml" },
      },
      webhooks: {},
      resources: {
        tickets: {
          endpoint: "GET /teams/{teamId}/issues",
          path: "/linear/teams/{{teamId}}/issues/{{id}}.json",
          iterate: true,
          pagination: {
            strategy: "page",
            paramName: "page",
            limitParamName: "per_page",
            pageSize: 2,
          },
          sync: { modelName: "ticket", cursorField: "updatedAt" },
        },
      },
    },
    defaultConnectionId: "conn_linear",
  });

  const result = await adapter.sync("ws_123", "tickets", {
    input: { teamId: "eng" },
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((call) => call.query), [
    { page: "1", per_page: "2" },
    { page: "2", per_page: "2" },
  ]);
  assert.deepEqual(
    recordWrites(writes).map((write) => write.path),
    [
      "/linear/teams/eng/issues/page_1.json",
      "/linear/teams/eng/issues/page_2.json",
    ]
  );
  assert.equal(checkpointWrites(writes).length, 1);
  assert.deepEqual(
    {
      filesWritten: result.filesWritten,
      nextCursor: result.nextCursor,
      errors: result.errors,
    },
    {
      filesWritten: 2,
      nextCursor: "2",
      errors: [
        {
          objectType: "ticket",
          error: "Pagination stalled for tickets: repeated page data.",
        },
      ],
    }
  );
});
