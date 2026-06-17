import assert from "node:assert/strict";
import test from "node:test";

import type {
  AuxiliaryEmitterClient,
  EmitReadInput,
  EmitReadResult,
  EmitWriteInput,
} from "@relayfile/adapter-core";

import { emitNeonAuxiliaryFiles } from "./emit-auxiliary-files.js";
import {
  neonOperationsIndexPath,
  neonOperationByIdAliasPath,
  neonOperationByStatusAliasPath,
  neonOperationPath,
  neonProjectConsumptionByMetricAliasPath,
  neonProjectConsumptionIndexPath,
  neonProjectConsumptionPath,
  neonProjectsIndexPath,
  neonProjectByOrgAliasPath,
  neonProjectPath,
  neonSpendingLimitByIdAliasPath,
  neonSpendingLimitsIndexPath,
  neonSpendingLimitPath,
} from "./path-mapper.js";

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

test("emitNeonAuxiliaryFiles writes project, operation, consumption, and spending-limit aliases", async () => {
  const client = createClient();

  await emitNeonAuxiliaryFiles(client, {
    workspaceId: "ws-1",
    projects: [
      {
        id: "proj-1",
        orgId: "org-1",
        name: "nightcto-prod",
        updatedAt: "2026-06-17T09:00:00.000Z",
      },
    ],
    operations: [
      {
        id: "op-1",
        projectId: "proj-1",
        branchId: "br-1",
        status: "failed",
        title: "start_compute failed",
        occurredAt: "2026-06-17T09:15:00.000Z",
      },
    ],
    projectConsumption: [
      {
        id: "proj-1__compute_unit_seconds__2026-06-17T00:00:00Z",
        projectId: "proj-1",
        metric: "compute_unit_seconds",
        title: "nightcto-prod compute_unit_seconds",
        occurredAt: "2026-06-17T23:59:59.000Z",
      },
    ],
    spendingLimits: [
      {
        id: "org-1",
        orgId: "org-1",
        title: "NightCTO spending limit",
        spending_limit_cents: null,
        capturedAt: "2026-06-17T10:00:00.000Z",
      },
    ],
  });

  assert.equal(
    JSON.parse(client.files.get(neonProjectByOrgAliasPath("org-1", "proj-1"))!).canonicalPath,
    neonProjectPath("proj-1"),
  );
  assert.equal(
    JSON.parse(client.files.get(neonOperationByIdAliasPath("op-1"))!).canonicalPath,
    neonOperationPath("op-1"),
  );
  assert.equal(
    JSON.parse(client.files.get(neonOperationByStatusAliasPath("failed", "op-1"))!).canonicalPath,
    neonOperationPath("op-1"),
  );
  assert.equal(
    JSON.parse(
      client.files.get(
        neonProjectConsumptionByMetricAliasPath(
          "compute_unit_seconds",
          "proj-1__compute_unit_seconds__2026-06-17T00:00:00Z",
        ),
      )!,
    ).canonicalPath,
    neonProjectConsumptionPath("proj-1__compute_unit_seconds__2026-06-17T00:00:00Z"),
  );
  assert.equal(
    JSON.parse(client.files.get(neonSpendingLimitByIdAliasPath("org-1"))!).canonicalPath,
    neonSpendingLimitPath("org-1"),
  );

  const projectRows = JSON.parse(client.files.get(neonProjectsIndexPath())!) as Array<{ id: string }>;
  const operationRows = JSON.parse(client.files.get(neonOperationsIndexPath())!) as Array<{ id: string }>;
  const consumptionRows = JSON.parse(client.files.get(neonProjectConsumptionIndexPath())!) as Array<{ id: string }>;
  const spendingRows = JSON.parse(client.files.get(neonSpendingLimitsIndexPath())!) as Array<{ id: string }>;

  assert.deepEqual(projectRows.map((row) => row.id), ["proj-1"]);
  assert.deepEqual(operationRows.map((row) => row.id), ["op-1"]);
  assert.deepEqual(consumptionRows.map((row) => row.id), ["proj-1__compute_unit_seconds__2026-06-17T00:00:00Z"]);
  assert.deepEqual(spendingRows.map((row) => row.id), ["org-1"]);
});

test("emitNeonAuxiliaryFiles removes stale operation status aliases when state changes", async () => {
  const statusAlias = neonOperationByStatusAliasPath("failed", "op-1");
  const client = createClient({
    [neonOperationByIdAliasPath("op-1")]: JSON.stringify({
      canonicalPath: neonOperationPath("op-1"),
      payload: { id: "op-1", projectId: "proj-1", status: "failed" },
    }),
    [statusAlias]: JSON.stringify({
      canonicalPath: neonOperationPath("op-1"),
      payload: { id: "op-1", projectId: "proj-1", status: "failed" },
    }),
  });

  await emitNeonAuxiliaryFiles(client, {
    workspaceId: "ws-1",
    operations: [
      {
        id: "op-1",
        projectId: "proj-1",
        status: "finished",
        title: "start_compute finished",
        occurredAt: "2026-06-17T11:00:00.000Z",
      },
    ],
  });

  assert.ok(client.deletes.includes(statusAlias));
  assert.equal(client.files.has(statusAlias), false);
  assert.equal(client.files.has(neonOperationByStatusAliasPath("finished", "op-1")), true);
});
