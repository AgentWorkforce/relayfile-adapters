/**
 * Example 01 — GitHub Webhook Ingest
 *
 * Demonstrates: receiving a GitHub webhook, normalizing it with
 * GitHubAdapter, and computing the VFS path where the payload lands.
 *
 * Run: npx tsx examples/01-github-webhook-ingest/index.ts
 */

import { GitHubAdapter } from "@relayfile/adapter-github";
import type {
  ConnectionProvider,
  NormalizedWebhook,
  ProxyRequest,
  ProxyResponse,
} from "@relayfile/adapter-github";

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
// 2. Create the GitHub adapter
// ---------------------------------------------------------------------------
const adapter = new GitHubAdapter(mockProvider, {
  owner: "acme",
  repo: "api",
});

// ---------------------------------------------------------------------------
// 3. Simulate an incoming "pull_request.opened" webhook
// ---------------------------------------------------------------------------
const webhookPayload: Record<string, unknown> = {
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
  repository: {
    name: "api",
    owner: { login: "acme" },
    full_name: "acme/api",
  },
  sender: { login: "alice", id: 1001 },
};

const normalizedEvent: NormalizedWebhook = {
  provider: "github",
  connectionId: "conn_demo",
  eventType: "pull_request.opened",
  objectType: "pull_request",
  objectId: "42",
  payload: webhookPayload,
};

// ---------------------------------------------------------------------------
// 4. Ingest and inspect the result
// ---------------------------------------------------------------------------
async function main() {
  console.log("--- Example 01: GitHub Webhook Ingest ---\n");

  // Path the adapter computes for this PR
  const vfsPath = adapter.computePath("pull_request", "42");
  console.log("Computed VFS path:", vfsPath);
  // => /github/repos/acme/api/pulls/42/metadata.json

  // Semantics the adapter derives from the payload
  const semantics = adapter.computeSemantics(
    "pull_request",
    "42",
    webhookPayload,
  );
  console.log("File semantics:", JSON.stringify(semantics, null, 2));

  // Full ingest flow — returns what files would be written
  const result = await adapter.ingestWebhook("ws_demo", normalizedEvent);
  console.log("\nIngest result:", JSON.stringify(result, null, 2));

  // Supported events
  console.log("\nSupported events:", adapter.supportedEvents());
}

main().catch(console.error);
