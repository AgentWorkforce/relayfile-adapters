import assert from "node:assert/strict";
import test from "node:test";

import type {
  AuxiliaryEmitterClient,
  EmitReadInput,
  EmitReadResult,
  EmitWriteInput,
} from "@relayfile/adapter-core";

import { emitGcpAuxiliaryFiles } from "./emit-auxiliary-files.js";
import {
  gcpBillingIndexPath,
  gcpCloudRunServiceByIdAliasPath,
  gcpCloudRunServiceByRegionAliasPath,
  gcpCloudRunServiceByStatusAliasPath,
  gcpCloudRunServicesIndexPath,
  gcpCloudRunServicePath,
  gcpErrorGroupByIdAliasPath,
  gcpErrorGroupByServiceAliasPath,
  gcpErrorGroupsIndexPath,
  gcpMonitoringAlertByIdAliasPath,
  gcpMonitoringAlertByStateAliasPath,
  gcpMonitoringAlertByTitleAliasPath,
  gcpMonitoringAlertsIndexPath,
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

test("emitGcpAuxiliaryFiles writes aliases and sorts indexes by updated descending", async () => {
  const client = createClient();

  await emitGcpAuxiliaryFiles(client, {
    workspaceId: "ws-1",
    cloudRunServices: [
      {
        serviceName: "older",
        region: "us-central1",
        ready: false,
        lastModified: "2026-01-01T00:00:00.000Z",
      },
      {
        serviceName: "newer",
        region: "europe-west1",
        ready: true,
        lastModified: "2026-01-02T00:00:00.000Z",
      },
    ],
  });

  const alias = JSON.parse(client.files.get(gcpCloudRunServiceByIdAliasPath("newer"))!) as {
    canonicalPath: string;
  };
  assert.equal(alias.canonicalPath, gcpCloudRunServicePath("newer"));
  assert.equal(
    JSON.parse(client.files.get(gcpCloudRunServiceByRegionAliasPath("europe-west1", "newer"))!)
      .canonicalPath,
    gcpCloudRunServicePath("newer"),
  );
  assert.equal(
    JSON.parse(client.files.get(gcpCloudRunServiceByStatusAliasPath("ready", "newer"))!)
      .canonicalPath,
    gcpCloudRunServicePath("newer"),
  );

  const rows = JSON.parse(client.files.get(gcpCloudRunServicesIndexPath())!) as Array<{
    id: string;
    region?: string;
    status?: string;
  }>;
  assert.deepEqual(rows.map((row) => row.id), ["newer", "older"]);
  assert.deepEqual(rows[0], {
    id: "newer",
    title: "newer",
    updated: "2026-01-02T00:00:00.000Z",
    canonicalPath: gcpCloudRunServicePath("newer"),
    region: "europe-west1",
    status: "ready",
    ready: true,
  });
});

test("emitGcpAuxiliaryFiles preserves an existing updated value when a record lacks timestamps", async () => {
  const client = createClient({
    [gcpCloudRunServicesIndexPath()]: JSON.stringify([
      {
        id: "api",
        title: "api",
        updated: "2026-01-03T00:00:00.000Z",
        canonicalPath: gcpCloudRunServicePath("api"),
      },
    ]),
  });

  await emitGcpAuxiliaryFiles(client, {
    workspaceId: "ws-1",
    cloudRunServices: [{ serviceName: "api", ready: true }],
  });

  const rows = JSON.parse(client.files.get(gcpCloudRunServicesIndexPath())!) as Array<{
    id: string;
    updated: string;
  }>;
  assert.deepEqual(rows, [
    {
      id: "api",
      title: "api",
      updated: "2026-01-03T00:00:00.000Z",
      canonicalPath: gcpCloudRunServicePath("api"),
      status: "ready",
      ready: true,
    },
  ]);
});

test("emitGcpAuxiliaryFiles writes monitoring natural aliases with collision-safe title paths", async () => {
  const client = createClient();

  await emitGcpAuxiliaryFiles(client, {
    workspaceId: "ws-1",
    monitoringAlerts: [
      {
        policyId: "policy-a",
        displayName: "Same alert",
        enabled: true,
        firing: true,
        lastIncidentTs: "2026-01-05T00:00:00.000Z",
      },
      {
        policyId: "policy-b",
        displayName: "Same alert",
        enabled: false,
        firing: false,
        lastIncidentTs: "2026-01-04T00:00:00.000Z",
      },
    ],
  });

  const firstTitleAlias = gcpMonitoringAlertByTitleAliasPath("Same alert", "policy-a");
  const secondTitleAlias = gcpMonitoringAlertByTitleAliasPath("Same alert", "policy-b");
  assert.notEqual(firstTitleAlias, secondTitleAlias);
  assert.equal(
    JSON.parse(client.files.get(firstTitleAlias)!).canonicalPath,
    "/gcp/monitoring/alerts/policy-a.json",
  );
  assert.equal(
    JSON.parse(client.files.get(gcpMonitoringAlertByStateAliasPath("open", "policy-a"))!)
      .canonicalPath,
    "/gcp/monitoring/alerts/policy-a.json",
  );
  assert.equal(
    JSON.parse(client.files.get(gcpMonitoringAlertByIdAliasPath("policy-a"))!).canonicalPath,
    "/gcp/monitoring/alerts/policy-a.json",
  );

  const rows = JSON.parse(client.files.get(gcpMonitoringAlertsIndexPath())!) as Array<{
    id: string;
    state?: string;
    firing?: boolean;
  }>;
  assert.deepEqual(rows.map((row) => row.id), ["policy-a", "policy-b"]);
  assert.equal(rows[0]?.state, "open");
  assert.equal(rows[1]?.state, "closed");
});

test("emitGcpAuxiliaryFiles removes stale natural aliases when alias fields change", async () => {
  const priorAliasPath = gcpCloudRunServiceByIdAliasPath("api");
  const staleRegionPath = gcpCloudRunServiceByRegionAliasPath("us-central1", "api");
  const client = createClient({
    [priorAliasPath]: JSON.stringify({
      canonicalPath: gcpCloudRunServicePath("api"),
      payload: { serviceName: "api", region: "us-central1", ready: true },
    }),
    [staleRegionPath]: JSON.stringify({
      canonicalPath: gcpCloudRunServicePath("api"),
      payload: { serviceName: "api", region: "us-central1", ready: true },
    }),
  });

  await emitGcpAuxiliaryFiles(client, {
    workspaceId: "ws-1",
    cloudRunServices: [{ serviceName: "api", region: "europe-west1", ready: true }],
  });

  assert.ok(client.deletes.includes(staleRegionPath));
  assert.equal(client.files.has(staleRegionPath), false);
  assert.equal(client.files.has(gcpCloudRunServiceByRegionAliasPath("europe-west1", "api")), true);
});

test("emitGcpAuxiliaryFiles indexes billing current state by billingAccountId", async () => {
  const client = createClient();

  await emitGcpAuxiliaryFiles(client, {
    workspaceId: "ws-1",
    billing: [
      {
        billingAccountId: "ABC-DEF",
        open: true,
        capturedAt: "2026-01-04T00:00:00.000Z",
      },
    ],
  });

  const rows = JSON.parse(client.files.get(gcpBillingIndexPath())!) as Array<{
    id: string;
    canonicalPath: string;
  }>;
  assert.deepEqual(rows, [
    {
      id: "ABC-DEF",
      title: "Billing current state",
      updated: "2026-01-04T00:00:00.000Z",
      canonicalPath: "/gcp/billing/current.json",
    },
  ]);
});

test("emitGcpAuxiliaryFiles writes Error Reporting aliases and indexes", async () => {
  const client = createClient();

  await emitGcpAuxiliaryFiles(client, {
    workspaceId: "ws-1",
    errorGroups: [
      {
        groupId: "group-1",
        service: "nightcto-production-api",
        resolutionStatus: "OPEN",
        exceptionType: "TypeError",
        lastSeenTime: "2026-01-06T00:00:00.000Z",
      },
    ],
  });

  assert.equal(
    JSON.parse(client.files.get(gcpErrorGroupByIdAliasPath("group-1"))!).canonicalPath,
    "/gcp/error-reporting/groups/group-1.json",
  );
  assert.equal(
    JSON.parse(client.files.get(gcpErrorGroupByServiceAliasPath("nightcto-production-api", "group-1"))!)
      .canonicalPath,
    "/gcp/error-reporting/groups/group-1.json",
  );

  const rows = JSON.parse(client.files.get(gcpErrorGroupsIndexPath())!) as Array<{
    id: string;
    service?: string;
    resolutionStatus?: string;
  }>;
  assert.deepEqual(rows, [
      {
        id: "group-1",
        title: "TypeError",
        updated: "2026-01-06T00:00:00.000Z",
      canonicalPath: "/gcp/error-reporting/groups/group-1.json",
      service: "nightcto-production-api",
      resolutionStatus: "OPEN",
    },
  ]);
});
