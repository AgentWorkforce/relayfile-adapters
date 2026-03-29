/**
 * Example 03 — Writeback
 *
 * Demonstrates: an agent writes a PR review to the VFS, and the adapter
 * maps that file path back to a GitHub API call via the writeback handler.
 *
 * Run: npx tsx examples/03-writeback/index.ts
 */

import { GitHubAdapter } from "@relayfile/adapter-github";
import type {
  ConnectionProvider,
  ProxyRequest,
  ProxyResponse,
} from "@relayfile/adapter-github";

// ---------------------------------------------------------------------------
// 1. Mock provider — captures the outgoing proxy request
// ---------------------------------------------------------------------------
const capturedRequests: ProxyRequest[] = [];

const mockProvider: ConnectionProvider = {
  name: "mock-github",
  async proxy(req: ProxyRequest): Promise<ProxyResponse> {
    capturedRequests.push(req);
    console.log("  [proxy →]", req.method, req.endpoint);
    return {
      status: 200,
      headers: {},
      data: { id: 98765 }, // Simulated review ID from GitHub
    };
  },
};

// ---------------------------------------------------------------------------
// 2. Create the adapter with a default connection ID
// ---------------------------------------------------------------------------
const adapter = new GitHubAdapter(mockProvider, {
  owner: "acme",
  repo: "api",
  connectionId: "conn_github_prod",
});

// ---------------------------------------------------------------------------
// 3. Simulate an agent writing a review file to the VFS
// ---------------------------------------------------------------------------
const reviewPath = "/github/repos/acme/api/pulls/42/reviews/agent-review.json";

const reviewContent = JSON.stringify(
  {
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
    metadata: {
      commitSha: "abc1234def5678",
    },
  },
  null,
  2,
);

// ---------------------------------------------------------------------------
// 4. Execute the writeback
// ---------------------------------------------------------------------------
async function main() {
  console.log("--- Example 03: Writeback ---\n");

  console.log("Agent review file path:");
  console.log(" ", reviewPath);
  console.log("\nReview payload:");
  console.log(reviewContent);

  console.log("\nExecuting writeback...");
  const result = await adapter.writeBack("ws_demo", reviewPath, reviewContent);
  console.log("\nWriteback result:", JSON.stringify(result, null, 2));

  // Inspect what the adapter sent to the provider
  if (capturedRequests.length > 0) {
    const req = capturedRequests[0];
    console.log("\n--- Captured proxy request ---");
    console.log("Method:", req.method);
    console.log("Base URL:", req.baseUrl);
    console.log("Endpoint:", req.endpoint);
    console.log("Connection ID:", req.connectionId);
    console.log("Body:", JSON.stringify(req.body, null, 2));
  }
}

main().catch(console.error);
