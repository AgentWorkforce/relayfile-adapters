import test from "node:test";
import assert from "node:assert/strict";
import { SchemaAdapter } from "../../src/runtime/schema-adapter.js";
import type { MappingSpec } from "../../src/spec/types.js";

test("SchemaAdapter ingests webhook payloads through relayfile client", async () => {
  const writes: Array<Record<string, unknown>> = [];
  const client = {
    async ingestWebhook(input: Record<string, unknown>) {
      writes.push(input);
      return { status: "queued", id: "q_123" };
    },
  } as any;
  const provider = {
    name: "provider",
    async proxy() {
      return { status: 200, headers: {}, data: { ok: true } };
    },
    async healthCheck() {
      return true;
    },
  } as any;
  const spec: MappingSpec = {
    adapter: {
      name: "github",
      version: "1.0.0",
      source: { openapi: "./openapi.yaml" },
    },
    webhooks: {
      pull_request: {
        path: "/github/repos/{{repository.owner.login}}/{{repository.name}}/pulls/{{number}}/metadata.json",
        extract: ["number", "action"],
      },
    },
  };

  const adapter = new SchemaAdapter({ client, provider, spec });
  const result = await adapter.ingestWebhook("ws_123", {
    provider: "github",
    connectionId: "conn_123",
    eventType: "pull_request.opened",
    objectType: "pull_request",
    objectId: "42",
    payload: {
      action: "opened",
      number: 42,
      repository: {
        owner: { login: "acme" },
        name: "demo",
      },
    },
  });

  assert.equal(result.paths[0], "/github/repos/acme/demo/pulls/42/metadata.json");
  assert.deepEqual(writes[0]?.data, {
    number: 42,
    action: "opened",
  });
});

test("SchemaAdapter matches writebacks and proxies them to the provider", async () => {
  const providerCalls: Array<Record<string, unknown>> = [];
  const adapter = new SchemaAdapter({
    client: {
      async ingestWebhook() {
        return { status: "queued", id: "q_123" };
      },
    } as any,
    provider: {
      name: "provider",
      async proxy(input: Record<string, unknown>) {
        providerCalls.push(input);
        return { status: 200, headers: {}, data: { id: 7 } };
      },
      async healthCheck() {
        return true;
      },
    } as any,
    spec: {
      adapter: {
        name: "github",
        version: "1.0.0",
        baseUrl: "https://api.github.com",
        source: { openapi: "./openapi.yaml" },
      },
      webhooks: {
        pull_request: {
          path: "/github/repos/{{repository.owner.login}}/{{repository.name}}/pulls/{{number}}/metadata.json",
        },
      },
      writebacks: {
        review: {
          match: "/github/repos/*/*/pulls/*/reviews/*.json",
          endpoint: "POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews",
        },
      },
    },
    defaultConnectionId: "conn_default",
  });

  await adapter.writeBack(
    "ws_123",
    "/github/repos/acme/demo/pulls/42/reviews/review.json",
    JSON.stringify({ body: "Looks good" })
  );

  assert.equal(providerCalls.length, 1);
  assert.equal(providerCalls[0]?.endpoint, "/repos/acme/demo/pulls/42/reviews");
  assert.equal(providerCalls[0]?.connectionId, "conn_default");
});
