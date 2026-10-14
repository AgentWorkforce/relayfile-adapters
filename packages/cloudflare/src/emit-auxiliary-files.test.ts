import assert from "node:assert/strict";
import test from "node:test";

import type {
  AuxiliaryEmitterClient,
  EmitReadInput,
  EmitReadResult,
  EmitWriteInput,
} from "@relayfile/adapter-core";

import {
  CLOUDFLARE_WORKER_ERROR_ROLLUP_INDEX_LIMIT,
  emitCloudflareAuxiliaryFiles,
} from "./emit-auxiliary-files.js";
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

  const apiRows = JSON.parse(client.files.get("/cloudflare/workers/errors/api-proxy/_index.json") ?? "[]") as Array<Record<string, unknown>>;
  assert.deepEqual(apiRows.map((row) => row.id), ["2026-10-14T07:00:00.000Z", "2026-10-14T06:00:00.000Z"]);
  assert.equal(apiRows[0]?.canonicalPath, "/cloudflare/workers/errors/api-proxy/2026-10-14/07.json");
  assert.equal(apiRows[0]?.top_error, "TypeError: x is undefined");
  assert.equal(apiRows[0]?.status_5xx, 40);

  const rootRows = JSON.parse(client.files.get("/cloudflare/workers/errors/_index.json") ?? "[]") as Array<Record<string, unknown>>;
  assert.deepEqual(rootRows.map((row) => row.id), ["api-proxy", "auth"]);
  assert.equal(rootRows[0]?.canonicalPath, "/cloudflare/workers/errors/api-proxy/2026-10-14/07.json");
  assert.equal(rootRows[0]?.severity, "critical");
  assert.equal(rootRows[0]?.scriptIndexPath, "/cloudflare/workers/errors/api-proxy/_index.json");
  assert.equal(rootRows[1]?.top_error, undefined);
  for (const row of [...apiRows, ...rootRows]) {
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

test("worker error rollup indexes merge with existing rows, stay bounded, and honour deletes", async () => {
  const existing = Array.from({ length: CLOUDFLARE_WORKER_ERROR_ROLLUP_INDEX_LIMIT }, (_, index) => {
    const hourStart = new Date(Date.UTC(2026, 9, 1) + index * 3_600_000).toISOString();
    return { id: hourStart, title: hourStart, updated: hourStart, canonicalPath: `/x/${index}` };
  });
  const client = createClient({
    "/cloudflare/workers/errors/api-proxy/_index.json": JSON.stringify(existing),
    "/cloudflare/workers/errors/_index.json": JSON.stringify([
      { id: "older-script", title: "older-script", updated: "2026-09-01T00:00:00.000Z", canonicalPath: "/y" },
    ]),
  });

  const newest = "2026-10-14T07:00:00.000Z";
  await emitCloudflareAuxiliaryFiles(client, {
    workspaceId: "ws-1",
    workerErrorRollups: [
      rollup("api-proxy", newest),
      { ...rollup("api-proxy", existing[existing.length - 1]!.id), _deleted: true as const },
    ],
  });

  const rows = JSON.parse(client.files.get("/cloudflare/workers/errors/api-proxy/_index.json") ?? "[]") as Array<{ id: string }>;
  assert.equal(rows.length, CLOUDFLARE_WORKER_ERROR_ROLLUP_INDEX_LIMIT);
  assert.equal(rows[0]?.id, newest);
  assert.equal(rows.some((row) => row.id === existing[existing.length - 1]!.id), false);

  const rootRows = JSON.parse(client.files.get("/cloudflare/workers/errors/_index.json") ?? "[]") as Array<{ id: string }>;
  assert.deepEqual(rootRows.map((row) => row.id), ["api-proxy", "older-script"]);
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
