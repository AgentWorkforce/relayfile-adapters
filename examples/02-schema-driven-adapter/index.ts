/**
 * Example 02 — Schema-Driven Adapter
 *
 * Demonstrates: creating an adapter entirely from a YAML mapping spec,
 * without writing a custom adapter class. Uses adapter-core's SchemaAdapter
 * to compute paths, normalize webhooks, and match writebacks.
 *
 * Mapping spec format: see docs/MAPPING_YAML_SPEC.md
 *
 * Run: npx tsx examples/02-schema-driven-adapter/index.ts
 */

import { SchemaAdapter } from "@relayfile/adapter-core";
import type { MappingSpec } from "@relayfile/adapter-core";

// ---------------------------------------------------------------------------
// 1. Define a mapping spec inline (equivalent to a .mapping.yaml file)
//    Full spec reference: docs/MAPPING_YAML_SPEC.md
// ---------------------------------------------------------------------------
const spec: MappingSpec = {
  adapter: {
    name: "acme-tickets",
    version: "1.0.0",
    baseUrl: "https://api.acme-tickets.io",
    source: { docs: { url: "https://docs.acme-tickets.io" } },
  },

  webhooks: {
    "ticket.created": {
      path: "/acme-tickets/orgs/{{organization.slug}}/tickets/{{ticket.id}}/metadata.json",
      extract: ["ticket.id", "ticket.title", "ticket.priority", "action"],
    },
    "ticket.updated": {
      path: "/acme-tickets/orgs/{{organization.slug}}/tickets/{{ticket.id}}/metadata.json",
      extract: ["ticket.id", "ticket.status", "action"],
    },
  },

  resources: {
    "get-ticket": {
      endpoint: "GET /orgs/{org}/tickets/{ticket_id}",
      path: "/acme-tickets/orgs/{{org}}/tickets/{{ticket_id}}/metadata.json",
    },
    "list-comments": {
      endpoint: "GET /orgs/{org}/tickets/{ticket_id}/comments",
      path: "/acme-tickets/orgs/{{org}}/tickets/{{ticket_id}}/comments/index.json",
      iterate: true,
    },
  },

  writebacks: {
    "add-comment": {
      match: "/acme-tickets/orgs/*/tickets/*/comments/*.json",
      endpoint: "POST /orgs/{org}/tickets/{ticket_id}/comments",
    },
  },
};

// ---------------------------------------------------------------------------
// 2. Create the SchemaAdapter with mock client + provider
// ---------------------------------------------------------------------------
const adapter = new SchemaAdapter({
  client: {
    async ingestWebhook() {
      return { status: "queued", id: "q_demo" };
    },
  },
  provider: {
    name: "acme-tickets",
    async proxy(req) {
      console.log("  [mock proxy]", req.method, req.endpoint);
      return { status: 200, headers: {}, data: { ok: true } };
    },
  },
  spec,
  defaultConnectionId: "conn_acme_demo",
});

// ---------------------------------------------------------------------------
// 3. Exercise every capability
// ---------------------------------------------------------------------------
async function main() {
  console.log("--- Example 02: Schema-Driven Adapter ---\n");
  console.log(`Adapter: ${adapter.name} v${adapter.version}`);
  console.log("Supported webhook events:", adapter.supportedEvents());

  const webhookPath = adapter.computeWebhookPath({
    provider: "acme-tickets",
    connectionId: "conn_acme_demo",
    eventType: "ticket.created",
    objectType: "ticket",
    objectId: "T-100",
    payload: {
      action: "created",
      organization: { slug: "widgetco" },
      ticket: { id: "T-100", title: "Login broken", priority: "high" },
    },
  });
  console.log("\nWebhook VFS path:", webhookPath);

  const resourcePath = adapter.computeResourcePath("get-ticket", {
    org: "widgetco",
    ticket_id: "T-100",
  });
  console.log("Resource VFS path:", resourcePath);

  const commentPath =
    "/acme-tickets/orgs/widgetco/tickets/T-100/comments/agent-reply.json";
  const match = adapter.matchWriteback(commentPath);
  console.log("\nWriteback match for", commentPath);
  console.log("  Rule:", match?.name, "→", match?.method, match?.endpointPath);

  console.log("\nExecuting writeback...");
  await adapter.writeBack("ws_demo", commentPath, JSON.stringify({
    body: "Investigating — looks like a session token issue.",
    connectionId: "conn_acme_demo",
  }));
  console.log("Writeback complete.\n");
}

main().catch(console.error);
