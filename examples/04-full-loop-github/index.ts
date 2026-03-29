/**
 * Example 04 — Full Loop: GitHub PR → VFS → Agent → Writeback → GitHub
 *
 * FLAGSHIP example showing the complete lifecycle:
 *   1. GitHub sends a pull_request.opened webhook
 *   2. GitHubAdapter normalizes it and writes to the VFS
 *   3. An agent reads the PR metadata from the VFS
 *   4. The agent writes a review file to the VFS
 *   5. The adapter's writeback handler posts the review to GitHub
 *
 * Everything is mocked — no external calls, fully runnable.
 *
 * Run: npx tsx examples/04-full-loop-github/index.ts
 */

import { GitHubAdapter } from "@relayfile/adapter-github";
import type {
  ConnectionProvider,
  NormalizedWebhook,
  ProxyRequest,
  ProxyResponse,
} from "@relayfile/adapter-github";

// ---------------------------------------------------------------------------
// In-memory VFS — simulates the RelayFile filesystem
// ---------------------------------------------------------------------------
const vfs = new Map<string, string>();

const relayFileClient = {
  async putFile(_ws: string, path: string, opts: { content: string }) {
    vfs.set(path, opts.content);
    return { ok: true };
  },
  async getFile(_ws: string, path: string) {
    const content = vfs.get(path);
    if (!content) throw new Error(`File not found: ${path}`);
    return { content };
  },
};

// ---------------------------------------------------------------------------
// Mock provider — logs requests and returns realistic responses
// ---------------------------------------------------------------------------
const proxyLog: Array<{ method: string; endpoint: string }> = [];

const mockProvider: ConnectionProvider = {
  name: "mock-github",
  async proxy(req: ProxyRequest): Promise<ProxyResponse> {
    proxyLog.push({ method: req.method, endpoint: req.endpoint });

    // Simulate GitHub's "create review" response
    if (req.endpoint.includes("/reviews")) {
      return {
        status: 200,
        headers: {},
        data: { id: 77001, node_id: "PRR_kwDOTest" },
      };
    }

    return { status: 200, headers: {}, data: null };
  },
};

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------
const adapter = new GitHubAdapter(mockProvider, {
  owner: "acme",
  repo: "web-app",
  connectionId: "conn_github_prod",
});

const WORKSPACE = "ws_acme_web";

// ---------------------------------------------------------------------------
// Realistic GitHub webhook payload
// ---------------------------------------------------------------------------
const prWebhookPayload: Record<string, unknown> = {
  action: "opened",
  number: 137,
  pull_request: {
    number: 137,
    title: "fix: resolve race condition in checkout flow",
    state: "open",
    body: [
      "## Problem",
      "Users occasionally see a blank page during checkout when two",
      "requests fire concurrently.",
      "",
      "## Solution",
      "Added a mutex lock around the payment intent creation step.",
    ].join("\n"),
    user: { login: "bob", id: 2002 },
    head: { ref: "fix/checkout-race", sha: "a1b2c3d4e5f6" },
    base: { ref: "main", sha: "f6e5d4c3b2a1" },
    draft: false,
    merged: false,
    labels: [{ name: "bug", color: "d73a4a" }],
    html_url: "https://github.com/acme/web-app/pull/137",
  },
  repository: {
    name: "web-app",
    owner: { login: "acme" },
    full_name: "acme/web-app",
  },
  sender: { login: "bob", id: 2002 },
};

// ---------------------------------------------------------------------------
// Main: walk through the full loop
// ---------------------------------------------------------------------------
async function main() {
  console.log("=== Example 04: Full Loop — GitHub PR Lifecycle ===\n");

  // -----------------------------------------------------------------------
  // STEP 1 — Webhook arrives, adapter normalizes it
  // -----------------------------------------------------------------------
  console.log("STEP 1: Webhook received — pull_request.opened #137");

  const event: NormalizedWebhook = {
    provider: "github",
    connectionId: "conn_github_prod",
    eventType: "pull_request.opened",
    objectType: "pull_request",
    objectId: "137",
    payload: prWebhookPayload,
  };

  const ingestResult = await adapter.ingestWebhook(WORKSPACE, event);
  const prPath = ingestResult.paths[0];
  console.log("  Files written:", ingestResult.filesWritten);
  console.log("  VFS path:", prPath);

  // -----------------------------------------------------------------------
  // STEP 2 — Write PR data into the VFS (simulating what the server does)
  // -----------------------------------------------------------------------
  console.log("\nSTEP 2: PR metadata written to VFS");

  await relayFileClient.putFile(WORKSPACE, prPath, {
    content: JSON.stringify(prWebhookPayload, null, 2),
  });
  console.log("  Stored at:", prPath);
  console.log("  VFS files:", [...vfs.keys()]);

  // -----------------------------------------------------------------------
  // STEP 3 — Agent reads the PR from the VFS
  // -----------------------------------------------------------------------
  console.log("\nSTEP 3: Agent reads PR metadata from VFS");

  const prFile = await relayFileClient.getFile(WORKSPACE, prPath);
  const prData = JSON.parse(prFile.content) as Record<string, unknown>;
  const pr = prData.pull_request as Record<string, unknown>;
  console.log("  PR title:", pr.title);
  console.log("  PR body preview:", (pr.body as string).slice(0, 60) + "...");
  console.log("  Author:", (pr.user as Record<string, unknown>).login);

  // -----------------------------------------------------------------------
  // STEP 4 — Agent writes a review to the VFS
  // -----------------------------------------------------------------------
  console.log("\nSTEP 4: Agent writes review to VFS");

  const reviewPath =
    "/github/repos/acme/web-app/pulls/137/reviews/agent-review.json";

  const agentReview = {
    event: "COMMENT" as const,
    body: "Nice fix! The mutex approach is solid. One thought below.",
    comments: [
      {
        path: "src/checkout/payment.ts",
        line: 42,
        side: "RIGHT" as const,
        body: "Consider adding a timeout to the mutex to avoid potential deadlocks.",
      },
    ],
    metadata: {
      commitSha: "a1b2c3d4e5f6",
    },
  };

  const reviewContent = JSON.stringify(agentReview, null, 2);
  await relayFileClient.putFile(WORKSPACE, reviewPath, {
    content: reviewContent,
  });
  console.log("  Review stored at:", reviewPath);

  // -----------------------------------------------------------------------
  // STEP 5 — Writeback: adapter posts the review to GitHub
  // -----------------------------------------------------------------------
  console.log("\nSTEP 5: Writeback — posting review to GitHub API");

  const writebackResult = await adapter.writeBack(
    WORKSPACE,
    reviewPath,
    reviewContent,
  );
  console.log("  Writeback result:", JSON.stringify(writebackResult, null, 2));

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------
  console.log("\n=== Lifecycle Complete ===");
  console.log("VFS files:", [...vfs.keys()]);
  console.log(
    "Proxy calls made:",
    proxyLog.map((r) => `${r.method} ${r.endpoint}`),
  );
}

main().catch(console.error);
