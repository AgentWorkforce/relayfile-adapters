/**
 * Example 03 — Writeback with GitHubWritebackHandler
 *
 * Demonstrates: an agent writes a PR review to the VFS, and the
 * GitHubWritebackHandler maps that file path back to a GitHub API call.
 *
 * Run: npx tsx examples/03-writeback/index.ts
 */

import {
  GitHubWritebackHandler,
  type GitHubProxyProvider,
  type ProxyRequest,
  type ProxyResponse,
} from "@relayfile/adapter-github";

// ---------------------------------------------------------------------------
// 1. Mock provider — captures the outgoing proxy request
// ---------------------------------------------------------------------------
const capturedRequests: ProxyRequest[] = [];

const mockProvider: GitHubProxyProvider = {
  name: "mock-github",
  async proxy(req: ProxyRequest): Promise<ProxyResponse> {
    capturedRequests.push(req);
    console.log("  [proxy →]", req.method, req.endpoint);
    return { status: 200, headers: {}, data: { id: 98765 } };
  },
};

// ---------------------------------------------------------------------------
// 2. Create the writeback handler directly
// ---------------------------------------------------------------------------
const writeback = new GitHubWritebackHandler(mockProvider, {
  defaultConnectionId: "conn_github_prod",
});

// ---------------------------------------------------------------------------
// 3. Simulate an agent writing a review file to the VFS
// ---------------------------------------------------------------------------
const reviewPath = "/github/repos/acme/api/pulls/42/reviews/agent-review.json";

const reviewContent = JSON.stringify({
  event: "COMMENT",
  body: "Looks good overall! A couple of suggestions below.",
  comments: [
    {
      path: "src/cache.ts",
      line: 14,
      side: "RIGHT",
      body: "Consider using a TTL here to avoid stale entries.",
    },
    {
      path: "src/cache.ts",
      line: 28,
      side: "RIGHT",
      body: "This could be simplified.",
      suggestion: "return cache.get(key) ?? fallback();",
    },
  ],
  metadata: { commitSha: "abc1234def5678" },
}, null, 2);

// ---------------------------------------------------------------------------
// 4. Execute the writeback
// ---------------------------------------------------------------------------
async function main() {
  console.log("--- Example 03: Writeback via GitHubWritebackHandler ---\n");
  console.log("Review path:", reviewPath);

  const result = await writeback.writeBack("ws_demo", reviewPath, reviewContent);
  console.log("\nWriteback result:", JSON.stringify(result, null, 2));

  if (capturedRequests.length > 0) {
    const req = capturedRequests[0];
    console.log("\n--- Captured proxy request ---");
    console.log("Endpoint:", req.method, req.endpoint);
    console.log("Connection:", req.connectionId);
    console.log("Body:", JSON.stringify(req.body, null, 2));
  }
}

main().catch(console.error);
