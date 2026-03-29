/**
 * Example 04 — Full Loop: webhook-server → VFS → Agent → WritebackHandler
 *
 * FLAGSHIP example: cleanest possible e2e using all new packages.
 *   1. @relayfile/webhook-server receives a pull_request.opened webhook
 *   2. GitHubAdapter normalizes + writes to VFS
 *   3. Agent reads PR metadata, writes a review
 *   4. GitHubWritebackHandler posts the review back to GitHub
 *
 * Run: npx tsx examples/04-full-loop-github/index.ts
 */

import { GitHubAdapter, GitHubWritebackHandler } from "@relayfile/adapter-github";
import { createWebhookServer } from "@relayfile/webhook-server";
import type { ConnectionProvider, ProxyRequest, ProxyResponse } from "@relayfile/adapter-github";

// --- In-memory VFS ---
const vfs = new Map<string, string>();
const proxyLog: Array<{ method: string; endpoint: string }> = [];

const mockProvider: ConnectionProvider = {
  name: "mock-github",
  async proxy(req: ProxyRequest): Promise<ProxyResponse> {
    proxyLog.push({ method: req.method, endpoint: req.endpoint });
    if (req.endpoint.includes("/reviews"))
      return { status: 200, headers: {}, data: { id: 77001 } };
    return { status: 200, headers: {}, data: null };
  },
};

// --- Adapter + webhook server + writeback handler ---
const adapter = new GitHubAdapter(mockProvider, {
  owner: "acme", repo: "web-app", connectionId: "conn_github_prod",
});
const server = createWebhookServer({
  adapters: { github: adapter },
  workspaceId: "ws_acme",
});
const writeback = new GitHubWritebackHandler(mockProvider, {
  defaultConnectionId: "conn_github_prod",
});

const WS = "ws_acme";

async function main() {
  console.log("=== Example 04: Full Loop — webhook-server + WritebackHandler ===\n");

  // STEP 1 — Webhook arrives
  console.log("STEP 1: Webhook → adapter.ingestWebhook()");
  const event = {
    provider: "github" as const,
    connectionId: "conn_github_prod",
    eventType: "pull_request.opened",
    objectType: "pull_request",
    objectId: "137",
    payload: {
      action: "opened", number: 137,
      pull_request: {
        number: 137, title: "fix: checkout race condition", state: "open",
        body: "Adds mutex around payment intent creation.",
        user: { login: "bob" }, head: { ref: "fix/race", sha: "a1b2c3d4" },
        base: { ref: "main" }, draft: false,
      },
      repository: { name: "web-app", owner: { login: "acme" } },
      sender: { login: "bob" },
    },
  };
  const ingest = await adapter.ingestWebhook(WS, event);
  const prPath = ingest.paths[0];
  console.log("  VFS path:", prPath);

  // STEP 2 — Store in VFS
  vfs.set(prPath, JSON.stringify(event.payload, null, 2));
  console.log("\nSTEP 2: PR metadata stored in VFS");

  // STEP 3 — Agent reads + writes review
  const prData = JSON.parse(vfs.get(prPath)!) as Record<string, unknown>;
  const pr = prData.pull_request as Record<string, unknown>;
  console.log("\nSTEP 3: Agent reads PR →", pr.title);

  const reviewPath = "/github/repos/acme/web-app/pulls/137/reviews/agent-review.json";
  const reviewContent = JSON.stringify({
    event: "COMMENT",
    body: "Nice fix! One thought on the mutex timeout.",
    comments: [{
      path: "src/checkout/payment.ts", line: 42, side: "RIGHT",
      body: "Consider adding a timeout to avoid deadlocks.",
    }],
    metadata: { commitSha: "a1b2c3d4" },
  }, null, 2);
  vfs.set(reviewPath, reviewContent);
  console.log("  Review stored at:", reviewPath);

  // STEP 4 — Writeback via GitHubWritebackHandler
  console.log("\nSTEP 4: WritebackHandler → GitHub API");
  const result = await writeback.writeBack(WS, reviewPath, reviewContent);
  console.log("  Result:", JSON.stringify(result));
  console.log("  Proxy calls:", proxyLog.map((r) => `${r.method} ${r.endpoint}`));

  // webhook-server is ready for production use
  console.log("\n=== Lifecycle Complete ===");
  console.log("Webhook server: POST /github/webhook");
  void server;
}

main().catch(console.error);
