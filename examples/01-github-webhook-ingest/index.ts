/**
 * Example 01 — GitHub Webhook Ingest via @relayfile/webhook-server
 *
 * Demonstrates: receiving a GitHub webhook through the webhook-server,
 * which handles signature verification + routing to GitHubAdapter.
 *
 * Run: npx tsx examples/01-github-webhook-ingest/index.ts
 */

import { GitHubAdapter } from "@relayfile/adapter-github";
import { createWebhookServer } from "@relayfile/webhook-server";
import type { ConnectionProvider, ProxyRequest, ProxyResponse } from "@relayfile/adapter-github";

// ---------------------------------------------------------------------------
// 1. Mock provider — no real HTTP calls
// ---------------------------------------------------------------------------
const mockProvider: ConnectionProvider = {
  name: "mock-github",
  async proxy(_req: ProxyRequest): Promise<ProxyResponse> {
    return { status: 200, headers: {}, data: null };
  },
};

// ---------------------------------------------------------------------------
// 2. Create adapter + webhook server
// ---------------------------------------------------------------------------
const adapter = new GitHubAdapter(mockProvider, { owner: "acme", repo: "api" });

const app = createWebhookServer({
  adapters: { github: adapter },
  secrets: { github: process.env.GITHUB_WEBHOOK_SECRET ?? "dev-secret" },
  workspaceId: "ws_demo",
});

// ---------------------------------------------------------------------------
// 3. Simulate an incoming "pull_request.opened" webhook
// ---------------------------------------------------------------------------
const webhookPayload = {
  action: "opened",
  number: 42,
  pull_request: {
    number: 42,
    title: "feat: add caching layer",
    state: "open",
    body: "Adds Redis-backed caching to the /users endpoint.",
    user: { login: "alice", id: 1001 },
    head: { ref: "feat/caching", sha: "abc1234" },
    base: { ref: "main", sha: "def5678" },
    draft: false,
  },
  repository: { name: "api", owner: { login: "acme" }, full_name: "acme/api" },
  sender: { login: "alice", id: 1001 },
};

async function main() {
  console.log("--- Example 01: GitHub Webhook Ingest ---\n");

  // Computed path the adapter will use
  const vfsPath = adapter.computePath("pull_request", "42");
  console.log("Computed VFS path:", vfsPath);

  // Semantics derived from the payload
  const semantics = adapter.computeSemantics("pull_request", "42", webhookPayload);
  console.log("File semantics:", JSON.stringify(semantics, null, 2));

  // Direct ingest (what webhook-server calls internally)
  const result = await adapter.ingestWebhook("ws_demo", {
    provider: "github",
    connectionId: "conn_demo",
    eventType: "pull_request.opened",
    objectType: "pull_request",
    objectId: "42",
    payload: webhookPayload,
  });
  console.log("\nIngest result:", JSON.stringify(result, null, 2));
  console.log("Supported events:", adapter.supportedEvents());

  // In production: app.fetch() or serve(app, { port: 3000 })
  console.log("\nWebhook server ready — POST /github/webhook");
  void app; // suppress unused warning in demo
}

main().catch(console.error);
