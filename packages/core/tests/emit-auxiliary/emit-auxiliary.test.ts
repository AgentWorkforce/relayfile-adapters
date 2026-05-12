import test from "node:test";
import assert from "node:assert/strict";

import {
  EMIT_AUXILIARY_JSON_CONTENT_TYPE,
  IndexFileReconciler,
  PriorAliasReader,
  runEmitBatch,
  type AuxiliaryEmitterClient,
  type EmitDeleteInput,
  type EmitReadInput,
  type EmitReadResult,
  type EmitWriteInput,
} from "../../src/emit-auxiliary/index.js";

interface CapturingClient extends AuxiliaryEmitterClient {
  writes: EmitWriteInput[];
  deletes: EmitDeleteInput[];
  reads: EmitReadInput[];
  files: Map<string, string>;
}

function createClient(options: {
  failWriteOn?: ReadonlySet<string>;
  failDeleteOn?: ReadonlySet<string>;
  failReadOn?: ReadonlySet<string>;
  initialFiles?: Record<string, string>;
  noDelete?: boolean;
  noRead?: boolean;
} = {}): CapturingClient {
  const files = new Map<string, string>(
    Object.entries(options.initialFiles ?? {}),
  );
  const writes: EmitWriteInput[] = [];
  const deletes: EmitDeleteInput[] = [];
  const reads: EmitReadInput[] = [];
  const failWriteOn = options.failWriteOn ?? new Set<string>();
  const failDeleteOn = options.failDeleteOn ?? new Set<string>();
  const failReadOn = options.failReadOn ?? new Set<string>();

  const client: CapturingClient = {
    writes,
    deletes,
    reads,
    files,
    async writeFile(input) {
      writes.push(input);
      if (failWriteOn.has(input.path)) {
        throw new Error(`forced write failure at ${input.path}`);
      }
      files.set(input.path, input.content);
      return { created: !files.has(input.path) };
    },
  };
  if (!options.noDelete) {
    client.deleteFile = async (input) => {
      deletes.push(input);
      if (failDeleteOn.has(input.path)) {
        throw new Error(`forced delete failure at ${input.path}`);
      }
      files.delete(input.path);
    };
  }
  if (!options.noRead) {
    client.readFile = async (input): Promise<EmitReadResult | null> => {
      reads.push(input);
      if (failReadOn.has(input.path)) {
        throw new Error(`forced read failure at ${input.path}`);
      }
      const content = files.get(input.path);
      return content === undefined ? null : { content };
    };
  }
  return client;
}

test("runEmitBatch returns zero result for empty record list", async () => {
  const client = createClient();
  const result = await runEmitBatch(client, "ws-1", [], () => ({ writes: [], deletes: [] }));
  assert.deepEqual(result, { written: 0, deleted: 0, errors: [] });
  assert.equal(client.writes.length, 0);
  assert.equal(client.deletes.length, 0);
});

test("runEmitBatch fans out writes and deletes per record", async () => {
  const client = createClient();
  const records = [{ id: "a" }, { id: "b" }];
  const result = await runEmitBatch(client, "ws-1", records, (record) => ({
    writes: [{ path: `/x/${record.id}.json`, content: `{"id":"${record.id}"}` }],
    deletes: [{ path: `/x/stale/${record.id}.json` }],
  }));
  assert.equal(result.written, 2);
  assert.equal(result.deleted, 2);
  assert.deepEqual(result.errors, []);
  assert.equal(client.writes.length, 2);
  assert.equal(client.deletes.length, 2);
  // Deletes run before writes within a record so stale aliases vacate first.
  for (let i = 0; i < records.length; i += 1) {
    const writeIndex = client.writes.findIndex(
      (op) => op.path === `/x/${records[i]!.id}.json`,
    );
    const deleteIndex = client.deletes.findIndex(
      (op) => op.path === `/x/stale/${records[i]!.id}.json`,
    );
    assert.ok(writeIndex >= 0 && deleteIndex >= 0);
  }
});

test("runEmitBatch defaults content type to JSON when omitted", async () => {
  const client = createClient();
  await runEmitBatch(client, "ws-1", [{ id: "a" }], () => ({
    writes: [{ path: "/x/a.json", content: "{}" }],
  }));
  assert.equal(client.writes[0]!.contentType, EMIT_AUXILIARY_JSON_CONTENT_TYPE);
});

test("runEmitBatch surfaces per-path write failures without aborting", async () => {
  const client = createClient({ failWriteOn: new Set(["/x/b.json"]) });
  const records = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const result = await runEmitBatch(client, "ws-1", records, (record) => ({
    writes: [{ path: `/x/${record.id}.json`, content: "{}" }],
  }));
  assert.equal(result.written, 2);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0]!.path, "/x/b.json");
  assert.match(result.errors[0]!.error, /forced write failure/);
  // The third record still wrote.
  assert.ok(client.files.has("/x/c.json"));
});

test("runEmitBatch records planner exceptions and continues with remaining records", async () => {
  const client = createClient();
  const records = [{ id: "a" }, { id: "explode" }, { id: "c" }];
  const result = await runEmitBatch(client, "ws-1", records, (record) => {
    if (record.id === "explode") {
      throw new Error("planner exploded");
    }
    return { writes: [{ path: `/x/${record.id}.json`, content: "{}" }] };
  });
  assert.equal(result.written, 2);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0]!.path, "");
  assert.match(result.errors[0]!.error, /planner exploded/);
});

test("runEmitBatch surfaces queued deletes with missing deleteFile as errors", async () => {
  const client = createClient({ noDelete: true });
  const result = await runEmitBatch(client, "ws-1", [{ id: "a" }], () => ({
    deletes: [{ path: "/x/stale.json" }],
    writes: [{ path: "/x/a.json", content: "{}" }],
  }));
  assert.equal(result.written, 1);
  assert.equal(result.deleted, 0);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0]!.path, "/x/stale.json");
  assert.match(result.errors[0]!.error, /deleteFile not supported/);
});

test("IndexFileReconciler upserts new rows when no existing file", async () => {
  const client = createClient();
  const reconciler = new IndexFileReconciler<{ id: string; title: string }>({
    client,
    workspaceId: "ws-1",
    path: "/p/_index.json",
    builder: (rows) => ({
      path: "/p/_index.json",
      content: `${JSON.stringify([...rows].sort((a, b) => a.id.localeCompare(b.id)))}\n`,
    }),
  });
  reconciler.upsert({ id: "1", title: "alpha" }, { id: "2", title: "beta" });
  const result = await reconciler.flush();
  assert.equal(result.written, 1);
  assert.deepEqual(result.errors, []);
  const written = client.files.get("/p/_index.json");
  assert.ok(written);
  assert.deepEqual(JSON.parse(written!), [
    { id: "1", title: "alpha" },
    { id: "2", title: "beta" },
  ]);
});

test("IndexFileReconciler merges with existing rows on flush", async () => {
  const existing = JSON.stringify([
    { id: "1", title: "alpha-old" },
    { id: "3", title: "gamma" },
  ]);
  const client = createClient({ initialFiles: { "/p/_index.json": existing } });
  const reconciler = new IndexFileReconciler<{ id: string; title: string }>({
    client,
    workspaceId: "ws-1",
    path: "/p/_index.json",
    builder: (rows) => ({
      path: "/p/_index.json",
      content: `${JSON.stringify([...rows].sort((a, b) => a.id.localeCompare(b.id)))}\n`,
    }),
  });
  reconciler.upsert({ id: "1", title: "alpha-new" }, { id: "2", title: "beta" });
  await reconciler.flush();
  const written = JSON.parse(client.files.get("/p/_index.json")!) as Array<{
    id: string;
    title: string;
  }>;
  assert.deepEqual(written, [
    { id: "1", title: "alpha-new" },
    { id: "2", title: "beta" },
    { id: "3", title: "gamma" },
  ]);
});

test("IndexFileReconciler removes ids before upserting", async () => {
  const existing = JSON.stringify([
    { id: "1", title: "alpha" },
    { id: "2", title: "beta" },
    { id: "3", title: "gamma" },
  ]);
  const client = createClient({ initialFiles: { "/p/_index.json": existing } });
  const reconciler = new IndexFileReconciler<{ id: string; title: string }>({
    client,
    workspaceId: "ws-1",
    path: "/p/_index.json",
    builder: (rows) => ({
      path: "/p/_index.json",
      content: `${JSON.stringify([...rows].sort((a, b) => a.id.localeCompare(b.id)))}\n`,
    }),
  });
  reconciler.remove("2");
  reconciler.upsert({ id: "4", title: "delta" });
  await reconciler.flush();
  const written = JSON.parse(client.files.get("/p/_index.json")!) as Array<{
    id: string;
  }>;
  assert.deepEqual(
    written.map((row) => row.id),
    ["1", "3", "4"],
  );
});

test("IndexFileReconciler flush returns zero when no upserts/removes queued", async () => {
  const client = createClient();
  const reconciler = new IndexFileReconciler<{ id: string }>({
    client,
    workspaceId: "ws-1",
    path: "/p/_index.json",
    builder: () => ({ path: "/p/_index.json", content: "[]" }),
  });
  assert.equal(reconciler.isEmpty(), true);
  const result = await reconciler.flush();
  assert.deepEqual(result, { written: 0, errors: [] });
  assert.equal(client.writes.length, 0);
});

test("IndexFileReconciler degrades gracefully when client lacks readFile", async () => {
  const client = createClient({ noRead: true });
  const reconciler = new IndexFileReconciler<{ id: string; title: string }>({
    client,
    workspaceId: "ws-1",
    path: "/p/_index.json",
    builder: (rows) => ({
      path: "/p/_index.json",
      content: JSON.stringify(rows),
    }),
  });
  reconciler.upsert({ id: "1", title: "alpha" });
  const result = await reconciler.flush();
  assert.equal(result.written, 1);
  assert.deepEqual(result.errors, []);
});

test("IndexFileReconciler surfaces write failures in errors", async () => {
  const client = createClient({ failWriteOn: new Set(["/p/_index.json"]) });
  const reconciler = new IndexFileReconciler<{ id: string }>({
    client,
    workspaceId: "ws-1",
    path: "/p/_index.json",
    builder: () => ({ path: "/p/_index.json", content: "[]" }),
  });
  reconciler.upsert({ id: "1" });
  const result = await reconciler.flush();
  assert.equal(result.written, 0);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0]!.path, "/p/_index.json");
});

test("PriorAliasReader returns null when client has no readFile", async () => {
  const client = createClient({ noRead: true });
  const reader = new PriorAliasReader(client, "ws-1");
  assert.equal(reader.isAvailable(), false);
  const got = await reader.read("/p/by-id/1.json");
  assert.equal(got, null);
});

test("PriorAliasReader returns parsed record on success", async () => {
  const client = createClient({
    initialFiles: { "/p/by-id/1.json": JSON.stringify({ title: "alpha" }) },
  });
  const reader = new PriorAliasReader(client, "ws-1");
  const got = await reader.read<{ title?: string }>("/p/by-id/1.json", (parsed) => ({
    title: typeof parsed.title === "string" ? parsed.title : undefined,
  }));
  assert.deepEqual(got, { title: "alpha" });
});

test("PriorAliasReader returns null on missing file, read error, parse error, or non-object", async () => {
  const client = createClient({
    initialFiles: {
      "/p/bad.json": "{ not json",
      "/p/array.json": "[1,2,3]",
    },
    failReadOn: new Set(["/p/boom.json"]),
  });
  const reader = new PriorAliasReader(client, "ws-1");
  assert.equal(await reader.read("/p/missing.json"), null);
  assert.equal(await reader.read("/p/boom.json"), null);
  assert.equal(await reader.read("/p/bad.json"), null);
  assert.equal(await reader.read("/p/array.json"), null);
});

test("PriorAliasReader returns null when extractor throws", async () => {
  const client = createClient({
    initialFiles: { "/p/by-id/1.json": JSON.stringify({ title: "alpha" }) },
  });
  const reader = new PriorAliasReader(client, "ws-1");
  const got = await reader.read("/p/by-id/1.json", () => {
    throw new Error("extractor exploded");
  });
  assert.equal(got, null);
});
