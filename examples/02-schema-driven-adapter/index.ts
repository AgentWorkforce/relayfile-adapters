/**
 * Example 02 — Schema-Driven Adapter
 *
 * Demonstrates: creating an adapter entirely from a YAML mapping spec,
 * without writing a custom adapter class. Uses adapter-core's SchemaAdapter
 * to compute paths, normalize webhooks, and match writebacks.
 *
 * This mirrors the approach used in packages/core/examples/resend/ but
 * defines the spec inline so the example is fully self-contained.
 *
 * Run: npx tsx examples/02-schema-driven-adapter/index.ts
 */

import { SchemaAdapter } from "@relayfile/adapter-core";
import type { MappingSpec } from "@relayfile/adapter-core";

// ---------------------------------------------------------------------------
// 1. Define a mapping spec inline (equivalent to a .mapping.yaml file)
//    This spec describes a fictional "Acme Tickets" API.
// ---------------------------------------------------------------------------
const spec: MappingSpec = {
  adapter: {
    name: "acme-tickets",
    version: "1.0.0",
    baseUrl: "https://api.acme-tickets.io",
    source: { docs: { url: "https://docs.acme-tickets.io" } },
  },

  // Webhook events the adapter understands
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

  // REST resources the adapter can fetch
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

  // Writeback rules: VFS path glob → API endpoint
  writebacks: {
    "add-comment": {
      match:
        "/acme-tickets/orgs/*/tickets/*/comments/*.json",
      endpoint:
        "POST /orgs/{org}/tickets/{ticket_id}/comments",
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

  // --- Webhook path computation ---
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
  // => /acme-tickets/orgs/widgetco/tickets/T-100/metadata.json

  // --- Resource path computation ---
  const resourcePath = adapter.computeResourcePath("get-ticket", {
    org: "widgetco",
    ticket_id: "T-100",
  });
  console.log("Resource VFS path:", resourcePath);
  // => /acme-tickets/orgs/widgetco/tickets/T-100/metadata.json

  // --- Webhook ingest (writes to VFS via mock client) ---
  const ingestResult = await adapter.ingestWebhook("ws_demo", {
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
  console.log("\nIngest result:", JSON.stringify(ingestResult, null, 2));

  // --- Writeback matching ---
  const commentPath =
    "/acme-tickets/orgs/widgetco/tickets/T-100/comments/agent-reply.json";
  const match = adapter.matchWriteback(commentPath);
  console.log("\nWriteback match for", commentPath);
  console.log("  Matched rule:", match?.name);
  console.log("  Method:", match?.method);
  console.log("  Resolved endpoint:", match?.endpointPath);
  console.log("  Extracted params:", match?.params);

  // --- Execute writeback (calls mock proxy) ---
  console.log("\nExecuting writeback...");
  await adapter.writeBack("ws_demo", commentPath, JSON.stringify({
    body: "Investigating — looks like a session token issue.",
    connectionId: "conn_acme_demo",
  }));
  console.log("Writeback complete.\n");
}

main().catch(console.error);
