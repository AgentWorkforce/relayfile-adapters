import assert from "node:assert/strict";
import test from "node:test";

import type { AuxiliaryEmitterClient } from "@relayfile/adapter-core";

import { emitPostHogAuxiliaryFiles } from "./emit-auxiliary-files.js";
import { posthogDashboardByNameAliasPath } from "./path-mapper.js";

function makeClient(seed: Record<string, unknown> = {}): {
  client: AuxiliaryEmitterClient;
  files: Map<string, string>;
  deleted: string[];
} {
  const files = new Map(
    Object.entries(seed).map(([path, value]) => [
      path,
      `${JSON.stringify(value, null, 2)}\n`,
    ]),
  );
  const deleted: string[] = [];
  return {
    files,
    deleted,
    client: {
      async readFile({ path }) {
        const content = files.get(path);
        return content ? { content } : null;
      },
      async writeFile({ path, content }) {
        files.set(path, content);
      },
      async deleteFile({ path }) {
        files.delete(path);
        deleted.push(path);
      },
    },
  };
}

function readJson(
  files: Map<string, string>,
  path: string,
): Record<string, unknown>[] {
  const content = files.get(path);
  assert.ok(content, `${path} missing`);
  return JSON.parse(content) as Record<string, unknown>[];
}

test("numeric ids materialize stable indexes and named aliases", async () => {
  const { client, files } = makeClient();
  const result = await emitPostHogAuxiliaryFiles(client, {
    workspaceId: "workspace-1",
    dashboards: [
      {
        id: 73,
        project_id: 17,
        name: "Checkout funnel",
        updated_at: "2026-07-25T08:10:00.000Z",
      },
    ],
  });

  assert.deepEqual(result.errors, []);
  const rows = readJson(files, "/posthog/projects/17/dashboards/_index.json");
  assert.deepEqual(rows[0], {
    id: "73",
    title: "Checkout funnel",
    updated: "2026-07-25T08:10:00.000Z",
    canonicalPath:
      "/posthog/projects/17/dashboards/checkout-funnel__73.json",
    archived: false,
  });
  assert.ok(
    files.has(
      posthogDashboardByNameAliasPath("17", "Checkout funnel", "73"),
    ),
  );
});

test("incremental indexes retain prior rows and prior timestamps", async () => {
  const aggregatePath = "/posthog/dashboards/_index.json";
  const projectPath = "/posthog/projects/17/dashboards/_index.json";
  const previousUpdated = "2026-07-24T08:10:00.000Z";
  const { client, files } = makeClient({
    [aggregatePath]: [
      {
        id: "17__72",
        title: "Existing dashboard",
        updated: "2026-07-23T08:10:00.000Z",
        canonicalPath:
          "/posthog/projects/17/dashboards/existing-dashboard__72.json",
      },
      {
        id: "17__73",
        title: "Checkout funnel",
        updated: previousUpdated,
        canonicalPath:
          "/posthog/projects/17/dashboards/checkout-funnel__73.json",
      },
    ],
    [projectPath]: [
      {
        id: "73",
        title: "Checkout funnel",
        updated: previousUpdated,
        canonicalPath:
          "/posthog/projects/17/dashboards/checkout-funnel__73.json",
      },
    ],
  });

  await emitPostHogAuxiliaryFiles(client, {
    workspaceId: "workspace-1",
    dashboards: [{ id: 73, project_id: 17, name: "Checkout funnel" }],
  });

  const aggregateRows = readJson(files, aggregatePath);
  assert.equal(aggregateRows.length, 2);
  assert.equal(
    aggregateRows.find((row) => row.id === "17__73")?.updated,
    previousUpdated,
  );
  assert.equal(readJson(files, projectPath)[0]?.updated, previousUpdated);
});

test("unavailable prior state never overwrites incremental indexes", async () => {
  const writes: string[] = [];
  const client: AuxiliaryEmitterClient = {
    async writeFile({ path }) {
      writes.push(path);
    },
    async deleteFile() {},
  };

  await emitPostHogAuxiliaryFiles(client, {
    workspaceId: "workspace-1",
    dashboards: [{ id: 73, project_id: 17, name: "Checkout funnel" }],
  });

  assert.ok(writes.includes("/posthog/_index.json"));
  assert.equal(
    writes.some(
      (path) => path !== "/posthog/_index.json" && path.endsWith("/_index.json"),
    ),
    false,
  );
});

test("record I/O uses bounded concurrency", async () => {
  let activeReads = 0;
  let maxActiveReads = 0;
  const client: AuxiliaryEmitterClient = {
    async readFile() {
      activeReads += 1;
      maxActiveReads = Math.max(maxActiveReads, activeReads);
      await new Promise<void>((resolve) => setImmediate(resolve));
      activeReads -= 1;
      return null;
    },
    async writeFile() {},
    async deleteFile() {},
  };

  await emitPostHogAuxiliaryFiles(client, {
    workspaceId: "workspace-1",
    dashboards: Array.from({ length: 24 }, (_, index) => ({
      id: index + 1,
      project_id: 17,
      name: `Dashboard ${index + 1}`,
    })),
  });

  assert.ok(maxActiveReads > 1);
  assert.ok(maxActiveReads <= 8);
});

test("read failures are reported and do not produce replacement indexes", async () => {
  const writes: string[] = [];
  const client: AuxiliaryEmitterClient = {
    async readFile() {
      throw new Error("transport unavailable");
    },
    async writeFile({ path }) {
      writes.push(path);
    },
    async deleteFile() {},
  };

  const result = await emitPostHogAuxiliaryFiles(client, {
    workspaceId: "workspace-1",
    dashboards: [{ id: 73, project_id: 17, name: "Checkout funnel" }],
  });

  assert.ok(result.errors.length > 0);
  assert.equal(writes.includes("/posthog/dashboards/_index.json"), false);
  assert.equal(
    writes.includes("/posthog/projects/17/dashboards/_index.json"),
    false,
  );
});
