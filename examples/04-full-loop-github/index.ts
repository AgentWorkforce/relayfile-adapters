/**
 * Example 04 — Full Loop: webhook-server → VFS → agent → WritebackConsumer
 *
 * FLAGSHIP example using the new shared pieces together:
 *   1. @relayfile/webhook-server receives a signed pull_request.opened webhook
 *   2. GitHubAdapter computes the relayfile path for the PR payload
 *   3. The demo stores that payload in an in-memory VFS
 *   4. An agent writes a review file back into the VFS
 *   5. WritebackConsumer polls the pending queue and delegates to GitHubWritebackHandler
 *
 * Run: npx tsx examples/04-full-loop-github/index.ts
 */

import { createHmac } from "node:crypto";
import {
  GitHubAdapter,
  GitHubWritebackHandler,
  type ConnectionProvider as GitHubAdapterProvider,
} from "@relayfile/adapter-github";
import { createWebhookServer } from "@relayfile/webhook-server";
import {
  WritebackConsumer,
  type AckWritebackInput,
  type ConnectionProvider,
  type ProxyRequest,
  type ProxyResponse,
  type RelayFileClient,
  type WritebackItem,
} from "@relayfile/sdk";

const WS = "ws_acme";
const SECRET = process.env.GITHUB_WEBHOOK_SECRET ?? "dev-secret";

// --- In-memory relayfile state ---
const vfs = new Map<string, string>();
const pendingWritebacks: WritebackItem[] = [];
const ackLog: AckWritebackInput[] = [];
const proxyLog: Array<{ method: string; endpoint: string; body: unknown }> = [];

const mockProvider: ConnectionProvider = {
  name: "mock-github",
  async proxy(req: ProxyRequest): Promise<ProxyResponse> {
    proxyLog.push({ method: req.method, endpoint: req.endpoint, body: req.body });
    if (req.endpoint.includes("/reviews")) {
      return { status: 200, headers: {}, data: { id: 77001 } };
    }
    return { status: 200, headers: {}, data: null };
  },
  async healthCheck() {
    return true;
  },
};

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
      revision: "rev_demo",
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

// --- Adapter + webhook server + writeback handler ---
const adapter = new GitHubAdapter(
  mockProvider as unknown as GitHubAdapterProvider,
  {
    owner: "acme",
    repo: "web-app",
    connectionId: "conn_github_prod",
  },
);
const webhookServer = createWebhookServer({
  adapters: { github: adapter },
  secrets: { github: SECRET },
  workspaceId: WS,
});
const writeback = new GitHubWritebackHandler(
  mockProvider as unknown as GitHubAdapterProvider,
  {
    defaultConnectionId: "conn_github_prod",
  },
);

async function main() {
  console.log("=== Example 04: Full Loop — webhook-server + WritebackConsumer ===\n");

  const webhookPayload = {
    action: "opened",
    number: 137,
    pull_request: {
      number: 137,
      title: "fix: checkout race condition",
      state: "open",
      body: "Adds mutex around payment intent creation.",
      user: { login: "bob" },
      head: { ref: "fix/race", sha: "a1b2c3d4" },
      base: { ref: "main" },
      draft: false,
    },
    repository: { name: "web-app", owner: { login: "acme" } },
    sender: { login: "bob" },
  };
  const rawBody = JSON.stringify(webhookPayload);
  const signature = `sha256=${createHmac("sha256", SECRET).update(rawBody).digest("hex")}`;

  console.log("STEP 1: Signed webhook hits POST /github/webhook");
  const response = await webhookServer.request("http://relayfile.local/github/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-connection-id": "conn_github_prod",
      "x-github-event": "pull_request",
      "x-hub-signature-256": signature,
    },
    body: rawBody,
  });
  const ingest = await response.json() as {
    paths: string[];
    filesWritten: number;
  };
  const prPath = ingest.paths[0] ?? adapter.computePath("pull_request", "137");
  console.log("  HTTP status:", response.status);
  console.log("  Computed VFS path:", prPath);

  console.log("\nSTEP 2: Demo persists the PR metadata in the in-memory VFS");
  vfs.set(prPath, JSON.stringify(webhookPayload, null, 2));

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
    metadata: {
      commitSha: "a1b2c3d4",
      connectionId: "conn_github_prod",
    },
  }, null, 2);
  vfs.set(reviewPath, reviewContent);
  console.log("  Review stored at:", reviewPath);

  console.log("\nSTEP 4: Relayfile queues the writeback item");
  pendingWritebacks.push({
    id: "wb_137",
    workspaceId: WS,
    path: reviewPath,
    revision: "rev_review_137",
    correlationId: "corr_137",
  });
  console.log("  Pending items:", pendingWritebacks.length);

  console.log("\nSTEP 5: WritebackConsumer dispatches to GitHubWritebackHandler");
  const consumer = new WritebackConsumer({
    client: relayfileClient,
    workspaceId: WS,
    handlers: [new GitHubReviewConsumerHandler(relayfileClient, writeback)],
    provider: mockProvider,
    pollIntervalMs: 0,
  });
  await consumer.pollOnce();

  console.log("\n=== Lifecycle Complete ===");
  console.log("Proxy calls:", proxyLog.map((r) => `${r.method} ${r.endpoint}`));
  console.log("Last proxy body:", JSON.stringify(proxyLog.at(-1)?.body ?? null, null, 2));
  console.log("Ack log:", JSON.stringify(ackLog, null, 2));
  console.log("Webhook server route: POST /github/webhook");
  void webhookServer;
}

main().catch(console.error);
