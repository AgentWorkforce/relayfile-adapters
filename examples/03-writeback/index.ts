/**
 * Example 03 — WritebackConsumer + GitHubWritebackHandler
 *
 * Demonstrates: an agent writes a PR review to relayfile, a writeback item is
 * queued, WritebackConsumer polls once, reads the file, then delegates the
 * GitHub path to GitHubWritebackHandler.
 *
 * Run: npx tsx examples/03-writeback/index.ts
 */

import {
  GitHubWritebackHandler,
  type ConnectionProvider as GitHubAdapterProvider,
} from "@relayfile/adapter-github";
import {
  WritebackConsumer,
  type AckWritebackInput,
  type ConnectionProvider,
  type ProxyRequest,
  type ProxyResponse,
  type RelayFileClient,
  type WritebackItem,
} from "@relayfile/sdk";

// ---------------------------------------------------------------------------
// 1. Mock relayfile state + pending writeback item
// ---------------------------------------------------------------------------
const WS = "ws_demo";
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
  metadata: { commitSha: "abc1234def5678", connectionId: "conn_github_prod" },
}, null, 2);

const vfs = new Map([[reviewPath, reviewContent]]);
const pendingWritebacks: WritebackItem[] = [
  {
    id: "wb_42",
    workspaceId: WS,
    path: reviewPath,
    revision: "rev_review_1",
    correlationId: "corr_review_42",
  },
];
const ackLog: AckWritebackInput[] = [];

// ---------------------------------------------------------------------------
// 2. Shared mock provider — captures the outgoing proxy request
// ---------------------------------------------------------------------------
const capturedRequests: ProxyRequest[] = [];

const mockProvider: ConnectionProvider = {
  name: "mock-github",
  async proxy(req: ProxyRequest): Promise<ProxyResponse> {
    capturedRequests.push(req);
    return { status: 200, headers: {}, data: { id: 98765 } };
  },
  async healthCheck() {
    return true;
  },
};

// ---------------------------------------------------------------------------
// 3. Bridge the queued writeback item back into the GitHub handler
// ---------------------------------------------------------------------------
const writeback = new GitHubWritebackHandler(
  mockProvider as unknown as GitHubAdapterProvider,
  {
    defaultConnectionId: "conn_github_prod",
  },
);

class GitHubReviewConsumerHandler {
  constructor(
    private readonly client: Pick<RelayFileClient, "readFile">,
    private readonly inner: GitHubWritebackHandler,
  ) {}

  canHandle(path: string): boolean {
    return this.inner.canHandle(path);
  }

  async execute(item: WritebackItem, _provider: ConnectionProvider): Promise<void> {
    const file = await this.client.readFile(item.workspaceId, item.path);
    const result = await this.inner.writeBack(item.workspaceId, item.path, file.content);

    if (!result.success) {
      throw new Error(result.error ?? "GitHub writeback failed");
    }
  }
}

const relayfileClient = {
  async listPendingWritebacks() {
    return pendingWritebacks.splice(0, pendingWritebacks.length);
  },
  async readFile(_workspaceId: string, path: string) {
    const content = vfs.get(path);
    if (!content) {
      throw new Error(`Missing VFS file: ${path}`);
    }
    return {
      path,
      revision: "rev_review_1",
      contentType: "application/json",
      content,
    };
  },
  async ackWriteback(input: AckWritebackInput) {
    ackLog.push(input);
    return {
      status: "acknowledged" as const,
      id: input.itemId,
      correlationId: input.correlationId,
      success: input.success,
    };
  },
} as unknown as RelayFileClient;

// ---------------------------------------------------------------------------
// 4. Poll once and process the queued writeback
// ---------------------------------------------------------------------------
async function main() {
  console.log("--- Example 03: WritebackConsumer + GitHubWritebackHandler ---\n");
  console.log("Review path:", reviewPath);

  const consumer = new WritebackConsumer({
    client: relayfileClient,
    workspaceId: WS,
    handlers: [new GitHubReviewConsumerHandler(relayfileClient, writeback)],
    provider: mockProvider,
    pollIntervalMs: 0,
  });

  await consumer.pollOnce();
  console.log("\nPending queue drained:", pendingWritebacks.length === 0);

  if (capturedRequests.length > 0) {
    const req = capturedRequests[0];
    console.log("\n--- Captured proxy request ---");
    console.log("Endpoint:", req.method, req.endpoint);
    console.log("Connection:", req.connectionId);
    console.log("Body:", JSON.stringify(req.body, null, 2));
  }

  console.log("\nAck log:", JSON.stringify(ackLog, null, 2));
}

main().catch(console.error);
