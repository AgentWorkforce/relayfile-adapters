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
