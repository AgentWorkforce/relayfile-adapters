/**
 * Example 01 — GitHub Webhook Ingest via @relayfile/webhook-server
 *
 * Demonstrates: receiving a signed GitHub webhook through webhook-server,
 * which handles signature verification + routing into GitHubAdapter.
 *
 * Run: npx tsx examples/01-github-webhook-ingest/index.ts
 */

import { createHmac } from "node:crypto";
import { GitHubAdapter } from "@relayfile/adapter-github";
import type { ConnectionProvider as GitHubAdapterProvider } from "@relayfile/adapter-github";
import { createWebhookServer } from "@relayfile/webhook-server";
import type {
  ConnectionProvider,
  ProxyRequest,
  ProxyResponse,
} from "@relayfile/sdk";

// ---------------------------------------------------------------------------
// 1. Shared mock provider — same contract any provider package can satisfy
// ---------------------------------------------------------------------------
const SECRET = process.env.GITHUB_WEBHOOK_SECRET ?? "dev-secret";

const mockProvider: ConnectionProvider = {
  name: "mock-github",
  async proxy(_req: ProxyRequest): Promise<ProxyResponse> {
    return { status: 200, headers: {}, data: null };
  },
  async healthCheck() {
    return true;
  },
};

// ---------------------------------------------------------------------------
// 2. Create adapter + webhook server
// ---------------------------------------------------------------------------
const adapter = new GitHubAdapter(
  mockProvider as unknown as GitHubAdapterProvider,
  { owner: "acme", repo: "api" },
);

const app = createWebhookServer({
  adapters: { github: adapter },
  secrets: { github: SECRET },
  workspaceId: "ws_demo",
});

// ---------------------------------------------------------------------------
// 3. Simulate an incoming signed "pull_request.opened" webhook
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

  const rawBody = JSON.stringify(webhookPayload);
  const signature = `sha256=${createHmac("sha256", SECRET).update(rawBody).digest("hex")}`;

  const response = await app.request("http://relayfile.local/github/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-connection-id": "conn_demo",
      "x-github-event": "pull_request",
      "x-hub-signature-256": signature,
    },
    body: rawBody,
  });

  const result = await response.json();

  // Computed path the adapter will use
  const vfsPath = adapter.computePath("pull_request", "42");
  console.log("Computed VFS path:", vfsPath);

  // Semantics derived from the payload
  const semantics = adapter.computeSemantics("pull_request", "42", webhookPayload);
  console.log("File semantics:", JSON.stringify(semantics, null, 2));

  console.log("\nWebhook server status:", response.status);
  console.log("Server result:", JSON.stringify(result, null, 2));
  console.log("Supported events:", adapter.supportedEvents());

  console.log("\nWebhook server route: POST /github/webhook");
  void app; // suppress unused warning in demo
}

main().catch(console.error);
