import assert from "node:assert/strict";
import test from "node:test";

import type {
  AuxiliaryEmitterClient,
  EmitReadInput,
  EmitReadResult,
  EmitWriteInput,
} from "@relayfile/adapter-core";

import { emitCloudflareAuxiliaryFiles } from "./emit-auxiliary-files.js";
import { cloudflareCollectionIndexPath } from "./path-mapper.js";

interface CapturingClient extends AuxiliaryEmitterClient {
  writes: EmitWriteInput[];
  reads: EmitReadInput[];
  deletes: string[];
  files: Map<string, string>;
}

function createClient(initialFiles: Record<string, string> = {}): CapturingClient {
  const files = new Map<string, string>(Object.entries(initialFiles));
  const writes: EmitWriteInput[] = [];
  const reads: EmitReadInput[] = [];
  const deletes: string[] = [];

  return {
    writes,
    reads,
    deletes,
    files,
    async writeFile(input) {
      writes.push(input);
      files.set(input.path, input.content);
      return { created: true };
    },
    async readFile(input): Promise<EmitReadResult | null> {
      reads.push(input);
      const content = files.get(input.path);
      return content === undefined ? null : { content };
    },
    async deleteFile(input) {
      deletes.push(input.path);
      files.delete(input.path);
    },
  };
}

function readRows(client: CapturingClient, path: string): Array<Record<string, unknown>> {
  return JSON.parse(client.files.get(path) ?? "null") as Array<Record<string, unknown>>;
}

function rollup(scriptName: string, hourStart: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `${scriptName}/${hourStart}`,
    script_name: scriptName,
    hour_start: hourStart,
    events: 120,
    exceptions: 3,
    failures: 4,
    status_5xx: 5,
    severity: "high",
    top_errors: [{ message: "TypeError: x is undefined", count: 3 }],
    ...overrides,
  };
}

test("emitCloudflareAuxiliaryFiles indexes worker error rollups per script and at the root", async () => {
  const client = createClient();

  const result = await emitCloudflareAuxiliaryFiles(client, {
    workspaceId: "ws-1",
    workerErrorRollups: [
      rollup("api-proxy", "2026-10-14T06:00:00.000Z"),
      rollup("api-proxy", "2026-10-14T07:00:00.000Z", { severity: "critical", status_5xx: 40 }),
      rollup("auth", "2026-10-14T05:00:00.000Z", { top_errors: [] }),
      { id: "broken", events: 1 },
    ],
  });

  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0]?.error ?? "", /missing script_name or hour_start/u);

  const hourRows = readRows(client, "/cloudflare/workers/errors/api-proxy/2026-10-14/_index.json");
  assert.deepEqual(hourRows.map((row) => row.id), ["2026-10-14T07:00:00.000Z", "2026-10-14T06:00:00.000Z"]);
  assert.equal(hourRows[0]?.canonicalPath, "/cloudflare/workers/errors/api-proxy/2026-10-14/07.json");
  assert.equal(hourRows[0]?.top_error, "TypeError: x is undefined");
  assert.equal(hourRows[0]?.status_5xx, 40);

  const dayRows = readRows(client, "/cloudflare/workers/errors/api-proxy/_index.json");
  assert.deepEqual(dayRows.map((row) => row.id), ["2026-10-14"]);
  assert.equal(dayRows[0]?.dayIndexPath, "/cloudflare/workers/errors/api-proxy/2026-10-14/_index.json");
  assert.equal(dayRows[0]?.canonicalPath, "/cloudflare/workers/errors/api-proxy/2026-10-14/07.json");
  assert.equal(dayRows[0]?.hours, 2);
  assert.equal(dayRows[0]?.day_status_5xx, 45);
  assert.equal(dayRows[0]?.severity, "critical");

  const rootRows = readRows(client, "/cloudflare/workers/errors/_index.json");
  assert.deepEqual(rootRows.map((row) => row.id), ["api-proxy", "auth"]);
  assert.equal(rootRows[0]?.canonicalPath, "/cloudflare/workers/errors/api-proxy/2026-10-14/07.json");
  assert.equal(rootRows[0]?.severity, "critical");
  assert.equal(rootRows[0]?.status_5xx, 40);
  assert.equal(rootRows[0]?.latestDate, "2026-10-14");
  assert.equal(rootRows[0]?.scriptIndexPath, "/cloudflare/workers/errors/api-proxy/_index.json");
  assert.equal(rootRows[1]?.top_error, undefined);
  for (const row of [...hourRows, ...dayRows, ...rootRows]) {
    assert.equal(typeof row.title, "string");
    assert.equal(typeof row.updated, "string");
  }

  // No by-id aliases for rollups.
  assert.equal(
    client.writes.some((write) => write.path.startsWith("/cloudflare/workers/errors/") && write.path.includes("/by-id/")),
    false,
  );
  const rootIndex = JSON.parse(client.files.get("/cloudflare/_index.json") ?? "[]") as Array<{ id: string }>;
  assert.ok(rootIndex.some((row) => row.id === "workers-errors"));
});

test("worker error rollup indexes stay complete across batches and honour deletes", async () => {
  const client = createClient({
    "/cloudflare/workers/errors/_index.json": JSON.stringify([
      { id: "older-script", title: "older-script", updated: "2026-09-01T00:00:00.000Z", canonicalPath: "/y" },
    ]),
  });

  // A week of error hours arrives in separate batches; nothing is ever dropped from the indexes.
  const hours = Array.from({ length: 24 * 8 }, (_, index) => new Date(Date.UTC(2026, 9, 1) + index * 3_600_000).toISOString());
  for (const hourStart of hours) {
    await emitCloudflareAuxiliaryFiles(client, { workspaceId: "ws-1", workerErrorRollups: [rollup("api-proxy", hourStart)] });
  }
  const dayRows = readRows(client, "/cloudflare/workers/errors/api-proxy/_index.json");
  assert.equal(dayRows.length, 8);
  assert.equal(dayRows.reduce((total, row) => total + Number(row.hours), 0), hours.length);
  assert.equal(readRows(client, "/cloudflare/workers/errors/api-proxy/2026-10-01/_index.json").length, 24);

  // Deleting the only hour of the newest day removes that day and rolls the root back to the prior day.
  const lastHour = hours.at(-1)!;
  await emitCloudflareAuxiliaryFiles(client, {
    workspaceId: "ws-1",
    workerErrorRollups: [{ ...rollup("api-proxy", "2026-10-09T00:00:00.000Z"), _deleted: true as const }],
  });
  assert.equal(readRows(client, "/cloudflare/workers/errors/api-proxy/_index.json").length, 8);
  await emitCloudflareAuxiliaryFiles(client, {
    workspaceId: "ws-1",
    workerErrorRollups: [rollup("api-proxy", "2026-10-09T03:00:00.000Z")],
  });
  await emitCloudflareAuxiliaryFiles(client, {
    workspaceId: "ws-1",
    workerErrorRollups: [{ ...rollup("api-proxy", "2026-10-09T03:00:00.000Z"), _deleted: true as const }],
  });
  const afterDelete = readRows(client, "/cloudflare/workers/errors/api-proxy/_index.json");
  assert.equal(afterDelete.some((row) => row.id === "2026-10-09"), false);
  assert.deepEqual(readRows(client, "/cloudflare/workers/errors/api-proxy/2026-10-09/_index.json"), []);

  const rootRows = readRows(client, "/cloudflare/workers/errors/_index.json");
  assert.deepEqual(rootRows.map((row) => row.id), ["api-proxy", "older-script"]);
  assert.equal(rootRows[0]?.latestHourStart, lastHour);
});

test("bare { id, _deleted } rollup tombstones are located from the composite id", async () => {
  const client = createClient();
  await emitCloudflareAuxiliaryFiles(client, {
    workspaceId: "ws-1",
    workerErrorRollups: [rollup("api-proxy", "2026-10-14T06:00:00.000Z"), rollup("api-proxy", "2026-10-14T07:00:00.000Z")],
  });
  const result = await emitCloudflareAuxiliaryFiles(client, {
    workspaceId: "ws-1",
    workerErrorRollups: [{ id: "api-proxy/2026-10-14T07:00:00.000Z", _deleted: true as const }],
  });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(
    readRows(client, "/cloudflare/workers/errors/api-proxy/2026-10-14/_index.json").map((row) => row.id),
    ["2026-10-14T06:00:00.000Z"],
  );
  assert.equal(readRows(client, "/cloudflare/workers/errors/_index.json")[0]?.latestHourStart, "2026-10-14T06:00:00.000Z");
});

test("a failed index read never truncates the existing index", async () => {
  const rootContent = JSON.stringify([{ id: "other", title: "other", updated: "2026-10-01T00:00:00.000Z", canonicalPath: "/z" }]);
  const client = createClient({ "/cloudflare/workers/errors/_index.json": rootContent });
  const readFile = client.readFile!.bind(client);
  client.readFile = async (input) => {
    if (input.path === "/cloudflare/workers/errors/_index.json") {
      throw new Error("transient read failure");
    }
    return readFile(input);
  };

  const result = await emitCloudflareAuxiliaryFiles(client, {
    workspaceId: "ws-1",
    workerErrorRollups: [rollup("api-proxy", "2026-10-14T07:00:00.000Z")],
  });

  assert.ok(result.errors.some((error) => /failed read/u.test(error.error)));
  assert.equal(client.files.get("/cloudflare/workers/errors/_index.json"), rootContent);
  // Lower levels whose reads succeeded are still maintained.
  assert.equal(readRows(client, "/cloudflare/workers/errors/api-proxy/_index.json").length, 1);
});

test("worker error rollup root index exists before any errors and is never clobbered without reads", async () => {
  const client = createClient();
  await emitCloudflareAuxiliaryFiles(client, { workspaceId: "ws-1", workerScripts: [{ script_name: "api-proxy" }] });
  assert.equal(client.files.get("/cloudflare/workers/errors/_index.json"), "[]\n");

  const seeded = createClient({ "/cloudflare/workers/errors/_index.json": '[{"id":"a"}]' });
  await emitCloudflareAuxiliaryFiles(seeded, { workspaceId: "ws-1" });
  assert.equal(seeded.files.get("/cloudflare/workers/errors/_index.json"), '[{"id":"a"}]');

  const writeOnly = createClient();
  delete (writeOnly as Partial<CapturingClient>).readFile;
  const result = await emitCloudflareAuxiliaryFiles(writeOnly, {
    workspaceId: "ws-1",
    workerErrorRollups: [rollup("api-proxy", "2026-10-14T07:00:00.000Z")],
  });
  assert.ok(result.errors.some((error) => /cannot read existing indexes/u.test(error.error)));
  assert.equal(writeOnly.writes.some((write) => write.path.startsWith("/cloudflare/workers/errors/")), false);
});

test("emitCloudflareAuxiliaryFiles skips malformed dns records without aborting the batch", async () => {
  const client = createClient();

  const result = await emitCloudflareAuxiliaryFiles(client, {
    workspaceId: "ws-1",
    dnsRecords: [
      {
        id: "dns-1",
        zone_id: "zone-1",
        name: "relayfile.dev",
        modified_on: "2026-06-18T00:00:00.000Z",
      },
      {
        id: "dns-2",
        name: "missing-zone",
        modified_on: "2026-06-18T01:00:00.000Z",
      },
    ],
  });

  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0]?.error ?? "", /missing zone_id/u);

  const zoneIndexPath = cloudflareCollectionIndexPath("dns-record", { zoneId: "zone-1" });
  const rows = JSON.parse(client.files.get(zoneIndexPath) ?? "[]") as Array<{ id: string }>;
  assert.deepEqual(rows.map((row) => row.id), ["dns-1"]);
});
