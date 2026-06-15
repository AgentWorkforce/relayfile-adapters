import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  AuxiliaryEmitterClient,
  EmitReadInput,
  EmitReadResult,
  EmitWriteInput,
  EmitDeleteInput,
} from "@relayfile/adapter-core";

import { emitDaytonaAuxiliaryFiles } from "./emit-auxiliary-files.js";
import {
  daytonaRootIndexPath,
  daytonaUsageByIdAliasPath,
  daytonaUsageIndexPath,
  daytonaUsagePath,
} from "./path-mapper.js";

interface CapturingClient extends AuxiliaryEmitterClient {
  writes: EmitWriteInput[];
  deletes: EmitDeleteInput[];
  reads: EmitReadInput[];
  files: Map<string, string>;
}

function createClient(
  options: {
    initialFiles?: Record<string, string>;
    noRead?: boolean;
  } = {},
): CapturingClient {
  const files = new Map<string, string>(Object.entries(options.initialFiles ?? {}));
  const writes: EmitWriteInput[] = [];
  const deletes: EmitDeleteInput[] = [];
  const reads: EmitReadInput[] = [];

  const client: CapturingClient = {
    writes,
    deletes,
    reads,
    files,
    async writeFile(input) {
      writes.push(input);
      files.set(input.path, input.content);
      return { created: true };
    },
    async deleteFile(input) {
      deletes.push(input);
      files.delete(input.path);
    },
  };

  if (!options.noRead) {
    client.readFile = async (input): Promise<EmitReadResult | null> => {
      reads.push(input);
      const content = files.get(input.path);
      return content === undefined ? null : { content };
    };
  }

  return client;
}

describe("emitDaytonaAuxiliaryFiles", () => {
  it("always writes /daytona/_index.json root index on empty input", async () => {
    const client = createClient();
    const result = await emitDaytonaAuxiliaryFiles(client, { workspaceId: "ws-1" });

    assert.deepEqual(result.errors, []);
    assert.equal(result.deleted, 0);
    // root index + empty usage index
    assert.equal(result.written, 2);

    const rootIndexPath = daytonaRootIndexPath();
    assert.ok(
      client.writes.some((w) => w.path === rootIndexPath),
      "expected /daytona/_index.json root index write",
    );

    const rootRows = JSON.parse(client.files.get(rootIndexPath)!);
    assert.deepEqual(rootRows, [
      { id: "usage", title: "Usage", canonicalPath: daytonaUsageIndexPath() },
    ]);
  });

  it("writes by-id alias + index row for a usage record", async () => {
    const client = createClient();
    const usageRecord = {
      id: "org-abc",
      organizationId: "org-abc",
      name: "Acme Corp",
      totalSnapshotQuota: 100,
      currentSnapshotUsage: 42,
      totalVolumeQuota: 50,
      currentVolumeUsage: 10,
      updatedAt: "2026-01-01T00:00:00Z",
    };

    const result = await emitDaytonaAuxiliaryFiles(client, {
      workspaceId: "ws-1",
      usage: [usageRecord],
    });

    assert.deepEqual(result.errors, []);

    const canonicalPath = daytonaUsagePath("org-abc");
    const aliasPath = daytonaUsageByIdAliasPath("org-abc");
    const indexPath = daytonaUsageIndexPath();

    const writtenPaths = client.writes.map((w) => w.path);
    assert.ok(writtenPaths.includes(aliasPath), `missing by-id alias path ${aliasPath}`);
    assert.ok(writtenPaths.includes(indexPath), `missing usage index path ${indexPath}`);

    // Alias file has a canonicalPath pointing to the canonical record.
    const aliasContent = JSON.parse(client.files.get(aliasPath)!) as Record<string, unknown>;
    assert.equal(aliasContent.canonicalPath, canonicalPath);
    assert.equal(aliasContent.objectId, "org-abc");
    assert.equal(aliasContent.provider, "daytona");
    assert.equal(aliasContent.objectType, "usage");

    // Index row has the expected shape.
    const indexRows = JSON.parse(client.files.get(indexPath)!) as Array<{
      id: string;
      title: string;
      updated: string;
      canonicalPath: string;
      organizationId: string;
    }>;
    assert.equal(indexRows.length, 1);
    assert.equal(indexRows[0]!.id, "org-abc");
    assert.equal(indexRows[0]!.title, "Acme Corp");
    assert.equal(indexRows[0]!.canonicalPath, canonicalPath);
    assert.equal(indexRows[0]!.organizationId, "org-abc");
  });

  it("resolves id from organizationId field when id is absent", async () => {
    const client = createClient();
    const result = await emitDaytonaAuxiliaryFiles(client, {
      workspaceId: "ws-1",
      usage: [
        {
          organizationId: "org-xyz",
          name: "XYZ Org",
          totalSnapshotQuota: 10,
          currentSnapshotUsage: 0,
          totalVolumeQuota: 5,
          currentVolumeUsage: 0,
          capturedAt: "2026-02-01T00:00:00Z",
        },
      ],
    });

    assert.deepEqual(result.errors, []);
    const writtenPaths = client.writes.map((w) => w.path);
    // by-id alias is written even when the record uses organizationId rather than id.
    assert.ok(writtenPaths.includes(daytonaUsageByIdAliasPath("org-xyz")));

    // The alias canonicalPath resolves to the canonical usage path.
    const aliasContent = JSON.parse(client.files.get(daytonaUsageByIdAliasPath("org-xyz"))!) as Record<string, unknown>;
    assert.equal(aliasContent.canonicalPath, daytonaUsagePath("org-xyz"));
  });

  it("skips records with no resolvable id", async () => {
    const client = createClient();
    const result = await emitDaytonaAuxiliaryFiles(client, {
      workspaceId: "ws-1",
      usage: [
        {
          // No id, organizationId, or organization_id
          name: "Ghost",
          totalSnapshotQuota: 5,
          currentSnapshotUsage: 0,
          totalVolumeQuota: 2,
          currentVolumeUsage: 0,
        } as never,
      ],
    });

    assert.deepEqual(result.errors, []);
    // Should still write root index + empty usage index, but no per-record files.
    const writtenPaths = client.writes.map((w) => w.path);
    const usagePaths = writtenPaths.filter((p) => p.includes("/usage/") && !p.includes("_index"));
    assert.equal(usagePaths.length, 0);
  });

  it("handles a delete tombstone: removes by-id alias and drops the index row", async () => {
    const priorAlias = JSON.stringify({
      provider: "daytona",
      objectType: "usage",
      objectId: "org-del",
      canonicalPath: daytonaUsagePath("org-del"),
      payload: { id: "org-del", organizationId: "org-del", name: "To Delete" },
    });
    const priorIndex = JSON.stringify([
      {
        id: "org-del",
        title: "To Delete",
        updated: "2026-01-01T00:00:00Z",
        canonicalPath: daytonaUsagePath("org-del"),
        organizationId: "org-del",
      },
      {
        id: "org-keep",
        title: "Keep",
        updated: "2026-01-01T00:00:00Z",
        canonicalPath: daytonaUsagePath("org-keep"),
        organizationId: "org-keep",
      },
    ]);

    const client = createClient({
      initialFiles: {
        [daytonaUsageByIdAliasPath("org-del")]: priorAlias,
        [daytonaUsageIndexPath()]: priorIndex,
      },
    });

    const result = await emitDaytonaAuxiliaryFiles(client, {
      workspaceId: "ws-1",
      usage: [{ id: "org-del", _deleted: true }],
    });

    assert.deepEqual(result.errors, []);
    assert.ok(result.deleted >= 1, "expected at least one delete");

    const deletedPaths = client.deletes.map((d) => d.path);
    assert.ok(
      deletedPaths.includes(daytonaUsageByIdAliasPath("org-del")),
      "expected by-id alias to be deleted",
    );

    // Index row for org-del should be pruned.
    const indexWrite = client.writes.find((w) => w.path === daytonaUsageIndexPath());
    assert.ok(indexWrite, "expected usage index to be rewritten after delete");
    const writtenRows = JSON.parse(indexWrite!.content) as Array<{ id: string }>;
    const ids = writtenRows.map((r) => r.id);
    assert.ok(!ids.includes("org-del"), "deleted id should not appear in index");
    assert.ok(ids.includes("org-keep"), "surviving id should still appear in index");
  });

  it("includes connectionId in alias payload when provided", async () => {
    const client = createClient();
    await emitDaytonaAuxiliaryFiles(client, {
      workspaceId: "ws-1",
      usage: [
        {
          id: "org-conn",
          organizationId: "org-conn",
          name: "Connected",
          totalSnapshotQuota: 10,
          currentSnapshotUsage: 0,
          totalVolumeQuota: 5,
          currentVolumeUsage: 0,
          updatedAt: "2026-03-01T00:00:00Z",
        },
      ],
      connectionId: "conn-42",
    });

    const aliasPath = daytonaUsageByIdAliasPath("org-conn");
    const aliasContent = JSON.parse(client.files.get(aliasPath)!) as Record<string, unknown>;
    assert.equal(aliasContent.connectionId, "conn-42");
  });
});
