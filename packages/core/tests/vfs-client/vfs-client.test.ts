import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { RelayFileApiError } from "@relayfile/sdk";
import {
  RelayfileWritebackAdmissionTimeoutError,
  RelayfileWritebackError,
  RelayfileWritebackPendingError,
  RelayfileWritebackReceiptError,
  WritebackError,
  draftFile,
  encodeSegment,
  listJsonFiles,
  normalizeWritebackStatus,
  readJsonFile,
  resolveMountRoot,
  writeJsonFile
} from "../../src/vfs-client/index.js";

async function mount(): Promise<{ root: string; opts: { relayfileMountRoot: string; writebackTimeoutMs: number } }> {
  const root = await mkdtemp(path.join(tmpdir(), "vfs-client-"));
  return { root, opts: { relayfileMountRoot: root, writebackTimeoutMs: 0 } };
}

async function withImmediateTimeouts<T>(fn: (delays: number[]) => Promise<T>): Promise<T> {
  const delays: number[] = [];
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((
    callback: (...args: unknown[]) => void,
    delay?: number,
    ...args: unknown[]
  ) => {
    delays.push(delay ?? 0);
    queueMicrotask(() => callback(...args));
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as unknown as typeof setTimeout;
  try {
    return await fn(delays);
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
}

test("writeJsonFile drops a draft atomically under the mount path", async () => {
  const { root, opts } = await mount();
  const rel = `/linear/issues/${encodeSegment("ISS-1")}/comments/${draftFile("comment")}`;
  const result = await writeJsonFile(opts, "linear", "comment", rel, { body: "hi" });
  assert.equal(result.path, rel);
  const dir = path.join(root, "linear/issues/ISS-1/comments");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  assert.equal(files.length, 1);
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, files[0]), "utf8")), { body: "hi" });
});

test("readJsonFile / listJsonFiles read back mount content", async () => {
  const { root, opts } = await mount();
  await mkdir(path.join(root, "linear/issues"), { recursive: true });
  await writeFile(path.join(root, "linear/issues/ISS-9.json"), JSON.stringify({ id: "ISS-9" }));
  assert.deepEqual(await readJsonFile(opts, "linear", "getIssue", "/linear/issues/ISS-9.json"), { id: "ISS-9" });
  const listed = await listJsonFiles<{ id: string }>(opts, "linear", "listIssues", "/linear/issues");
  assert.deepEqual(listed.map((f) => f.value.id), ["ISS-9"]);
});

test("a path escaping the mount root throws RelayfileWritebackError", async () => {
  const { opts } = await mount();
  await assert.rejects(
    () => readJsonFile(opts, "linear", "getIssue", "/../../etc/passwd"),
    RelayfileWritebackError
  );
});

test("resolveMountRoot honors the explicit option over env/cwd", async () => {
  const oldRelayfileMountPath = process.env.RELAYFILE_MOUNT_PATH;
  try {
    process.env.RELAYFILE_MOUNT_PATH = "/tmp/env-root";
    assert.equal(resolveMountRoot({ relayfileMountRoot: "/tmp/x" }), path.resolve("/tmp/x"));
  } finally {
    if (oldRelayfileMountPath === undefined) delete process.env.RELAYFILE_MOUNT_PATH;
    else process.env.RELAYFILE_MOUNT_PATH = oldRelayfileMountPath;
  }
});

test("resolveMountRoot honors sandbox mount root env vars before cwd fallback", async () => {
  const oldRelayfileMountPath = process.env.RELAYFILE_MOUNT_PATH;
  const oldWorkspaceRoot = process.env.WORKSPACE_ROOT;
  const oldWorkforceSandboxRoot = process.env.WORKFORCE_SANDBOX_ROOT;
  const oldRelayfileMountRoot = process.env.RELAYFILE_MOUNT_ROOT;
  const oldRelayfileRoot = process.env.RELAYFILE_ROOT;
  try {
    delete process.env.RELAYFILE_MOUNT_PATH;
    delete process.env.WORKSPACE_ROOT;
    delete process.env.WORKFORCE_SANDBOX_ROOT;
    delete process.env.RELAYFILE_MOUNT_ROOT;
    delete process.env.RELAYFILE_ROOT;

    process.env.WORKSPACE_ROOT = "/tmp/workspace-root";
    process.env.RELAYFILE_MOUNT_ROOT = "/tmp/legacy-mount-root";
    process.env.RELAYFILE_ROOT = "/tmp/legacy-root";
    assert.equal(resolveMountRoot({ workspaceCwd: "/tmp/runtime-cwd" }), path.resolve("/tmp/workspace-root"));

    process.env.RELAYFILE_MOUNT_PATH = "/tmp/relayfile-mount-path";
    assert.equal(resolveMountRoot({ workspaceCwd: "/tmp/runtime-cwd" }), path.resolve("/tmp/relayfile-mount-path"));

    delete process.env.RELAYFILE_MOUNT_PATH;
    delete process.env.WORKSPACE_ROOT;
    process.env.WORKFORCE_SANDBOX_ROOT = "/tmp/workforce-sandbox-root";
    assert.equal(resolveMountRoot({ workspaceCwd: "/tmp/runtime-cwd" }), path.resolve("/tmp/workforce-sandbox-root"));
  } finally {
    if (oldRelayfileMountPath === undefined) delete process.env.RELAYFILE_MOUNT_PATH;
    else process.env.RELAYFILE_MOUNT_PATH = oldRelayfileMountPath;
    if (oldWorkspaceRoot === undefined) delete process.env.WORKSPACE_ROOT;
    else process.env.WORKSPACE_ROOT = oldWorkspaceRoot;
    if (oldWorkforceSandboxRoot === undefined) delete process.env.WORKFORCE_SANDBOX_ROOT;
    else process.env.WORKFORCE_SANDBOX_ROOT = oldWorkforceSandboxRoot;
    if (oldRelayfileMountRoot === undefined) delete process.env.RELAYFILE_MOUNT_ROOT;
    else process.env.RELAYFILE_MOUNT_ROOT = oldRelayfileMountRoot;
    if (oldRelayfileRoot === undefined) delete process.env.RELAYFILE_ROOT;
    else process.env.RELAYFILE_ROOT = oldRelayfileRoot;
  }
});

test("resolveMountRoot skips blank mount root env vars", async () => {
  const oldRelayfileMountPath = process.env.RELAYFILE_MOUNT_PATH;
  const oldWorkspaceRoot = process.env.WORKSPACE_ROOT;
  const oldWorkforceSandboxRoot = process.env.WORKFORCE_SANDBOX_ROOT;
  const oldRelayfileMountRoot = process.env.RELAYFILE_MOUNT_ROOT;
  const oldRelayfileRoot = process.env.RELAYFILE_ROOT;
  try {
    process.env.RELAYFILE_MOUNT_PATH = "";
    process.env.WORKSPACE_ROOT = "   ";
    process.env.WORKFORCE_SANDBOX_ROOT = "/tmp/workforce-sandbox-root";
    process.env.RELAYFILE_MOUNT_ROOT = "/tmp/legacy-mount-root";
    process.env.RELAYFILE_ROOT = "/tmp/legacy-root";

    assert.equal(resolveMountRoot({ workspaceCwd: "/tmp/runtime-cwd" }), path.resolve("/tmp/workforce-sandbox-root"));
    assert.equal(resolveMountRoot({ relayfileMountRoot: " ", mountRoot: "/tmp/explicit-fallback" }), path.resolve("/tmp/explicit-fallback"));
  } finally {
    if (oldRelayfileMountPath === undefined) delete process.env.RELAYFILE_MOUNT_PATH;
    else process.env.RELAYFILE_MOUNT_PATH = oldRelayfileMountPath;
    if (oldWorkspaceRoot === undefined) delete process.env.WORKSPACE_ROOT;
    else process.env.WORKSPACE_ROOT = oldWorkspaceRoot;
    if (oldWorkforceSandboxRoot === undefined) delete process.env.WORKFORCE_SANDBOX_ROOT;
    else process.env.WORKFORCE_SANDBOX_ROOT = oldWorkforceSandboxRoot;
    if (oldRelayfileMountRoot === undefined) delete process.env.RELAYFILE_MOUNT_ROOT;
    else process.env.RELAYFILE_MOUNT_ROOT = oldRelayfileMountRoot;
    if (oldRelayfileRoot === undefined) delete process.env.RELAYFILE_ROOT;
    else process.env.RELAYFILE_ROOT = oldRelayfileRoot;
  }
});

test("a draft carrying a monitored field is not mistaken for a receipt", async () => {
  const { opts } = await mount();
  // No writeback worker runs, so the file never changes from the draft. Even
  // though the draft has a top-level `id`, the poll must time out (no receipt)
  // rather than return the draft itself.
  const result = await writeJsonFile(
    { ...opts, writebackTimeoutMs: 40, writebackPollMs: 10 },
    "linear",
    "updateIssue",
    "/linear/issues/ISS-1.json",
    { id: "ISS-1", title: "still a draft" }
  );
  assert.equal(result.receipt, undefined);

  // normalize makes no-receipt first class (for W6 / RFC 2291)
  const n = normalizeWritebackStatus(result);
  assert.equal(n.state, "no_receipt");
  assert.equal(n.path, "/linear/issues/ISS-1.json");

  // compatibility: WritebackError extends RelayfileWritebackError so instanceof works
  const err = new WritebackError(n);
  assert(err instanceof WritebackError);
  assert(err instanceof RelayfileWritebackError);
  assert.equal(err.state, "no_receipt");
});

test("writeJsonFile can wait on direct Relayfile op providerResult instead of mount receipt visibility", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.includes("/fs/file")) {
      return Response.json({
        opId: "op_slack_1",
        status: "queued",
        targetRevision: "rev_1",
        writeback: { provider: "slack", state: "pending" }
      });
    }
    if (url.includes("/ops/op_slack_1")) {
      return Response.json({
        opId: "op_slack_1",
        status: "succeeded",
        attemptCount: 1,
        providerResult: {
          provider: "slack",
          externalId: "1781870464.800039",
          ts: "1781870464.800039",
          channel: "C0AF4JELP1S"
        }
      });
    }
    return Response.json({ code: "not_found", message: "unexpected request" }, { status: 404 });
  };

  const result = await writeJsonFile(
    {
      relayfileBaseUrl: "https://relayfile.example.test",
      relayfileApiToken: "token-with-fs-write-and-ops-read",
      workspaceId: "rw_7ccfea89",
      fetchImpl,
      writebackTimeoutMs: 100,
      writebackPollMs: 5
    },
    "slack",
    "post",
    "/slack/channels/C0AF4JELP1S/messages/relayfile-writeback--1.json",
    { text: "hello" }
  );

  assert.equal(result.opId, "op_slack_1");
  assert.equal(result.receipt?.externalId, "1781870464.800039");
  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /\/v1\/workspaces\/rw_7ccfea89\/fs\/file\?/);
  assert.match(requests[1].url, /\/v1\/workspaces\/rw_7ccfea89\/ops\/op_slack_1$/);
});

test("writeJsonFile direct mode honors workspace_busy Retry-After in one four-attempt SDK retry layer", async () => {
  const requests: Array<{ url: string; body: BodyInit | null | undefined }> = [];
  let attempts = 0;
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    attempts += 1;
    requests.push({ url: String(input), body: init.body });
    if (attempts < 4) {
      return Response.json(
        {
          code: "workspace_busy",
          message: "workspace write path is busy; retry after the advertised delay",
          reason: "write_admission_limit",
          retryAfterSeconds: 5
        },
        { status: 429, headers: { "Retry-After": "5" } }
      );
    }
    return Response.json({ status: "queued", targetRevision: "rev_1" });
  };

  const result = await withImmediateTimeouts(async (delays) => {
    const write = await writeJsonFile(
      {
        relayfileBaseUrl: "https://relayfile.example.test",
        relayfileApiToken: "test-token",
        workspaceId: "rw_busy",
        fetchImpl,
        writebackTimeoutMs: 0
      },
      "slack",
      "post",
      "/slack/channels/C1/messages/relayfile-writeback--busy.json",
      { text: "hello", idempotencyKey: "tick:delivery-1:1" }
    );
    assert.deepEqual(delays, [5_000, 5_000, 5_000]);
    return write;
  });

  assert.equal(result.opId, undefined);
  assert.equal(requests.length, 4, "the SDK layer must own exactly four total attempts");
  assert.equal(new Set(requests.map((request) => request.url)).size, 1);
  assert.equal(new Set(requests.map((request) => String(request.body))).size, 1);
  assert.equal(requests.some((request) => request.url.includes("/ops/")), false);
  assert.match(String(requests[0].body), /tick:delivery-1:1/);
});

test("writeJsonFile direct mode marks only exhausted workspace_busy admission as retryable", async () => {
  let attempts = 0;
  const fetchImpl: typeof fetch = async () => {
    attempts += 1;
    return Response.json(
      {
        code: "workspace_busy",
        message: "workspace write path is busy",
        reason: "write_admission_limit"
      },
      { status: 429, headers: { "Retry-After": "5" } }
    );
  };

  await withImmediateTimeouts(async (delays) => {
    await assert.rejects(
      () =>
        writeJsonFile(
          {
            relayfileBaseUrl: "https://relayfile.example.test",
            relayfileApiToken: "test-token",
            workspaceId: "rw_busy_exhausted",
            fetchImpl,
            writebackTimeoutMs: 0
          },
          "slack",
          "post",
          "/slack/channels/C1/messages/relayfile-writeback--busy-exhausted.json",
          { text: "hello" }
        ),
      (error: unknown) =>
        error instanceof RelayfileWritebackError &&
        error.retryable &&
        error.cause instanceof RelayFileApiError &&
        error.cause.status === 429 &&
        error.cause.code === "workspace_busy" &&
        error.cause.details?.reason === "write_admission_limit"
    );
    assert.deepEqual(delays, [5_000, 5_000, 5_000]);
  });
  assert.equal(attempts, 4);
});

test("writeJsonFile direct mode preserves the two-second cap for workspace_busy with another reason", async () => {
  let attempts = 0;
  const fetchImpl: typeof fetch = async () => {
    attempts += 1;
    return Response.json(
      { code: "workspace_busy", reason: "another_limit", message: "ordinary rate limit" },
      { status: 429, headers: { "Retry-After": "5" } }
    );
  };

  await withImmediateTimeouts(async (delays) => {
    await assert.rejects(
      () =>
        writeJsonFile(
          {
            relayfileBaseUrl: "https://relayfile.example.test",
            relayfileApiToken: "test-token",
            workspaceId: "rw_rate_limited",
            fetchImpl,
            writebackTimeoutMs: 0
          },
          "slack",
          "post",
          "/slack/channels/C1/messages/relayfile-writeback--rate-limited.json",
          { text: "hello" }
        ),
      RelayfileWritebackError
    );
    assert.deepEqual(delays, [2_000, 2_000, 2_000]);
  });
  assert.equal(attempts, 4);
});

test("writeJsonFile direct mode preserves the existing two-second cap for 5xx retries", async () => {
  let attempts = 0;
  const fetchImpl: typeof fetch = async () => {
    attempts += 1;
    return Response.json(
      { code: "service_unavailable", message: "try later" },
      { status: 503, headers: { "Retry-After": "5" } }
    );
  };

  await withImmediateTimeouts(async (delays) => {
    await assert.rejects(
      () =>
        writeJsonFile(
          {
            relayfileBaseUrl: "https://relayfile.example.test",
            relayfileApiToken: "test-token",
            workspaceId: "rw_unavailable",
            fetchImpl,
            writebackTimeoutMs: 0
          },
          "slack",
          "post",
          "/slack/channels/C1/messages/relayfile-writeback--unavailable.json",
          { text: "hello" }
        ),
      RelayfileWritebackError
    );
    assert.deepEqual(delays, [2_000, 2_000, 2_000]);
  });
  assert.equal(attempts, 4);
});

test("writeJsonFile direct mode preserves the SDK backoff schedule without Retry-After", async () => {
  let attempts = 0;
  const fetchImpl: typeof fetch = async () => {
    attempts += 1;
    return Response.json(
      { code: "rate_limited", message: "retry without an advertised delay" },
      { status: 429 }
    );
  };
  const realRandom = Math.random;
  Math.random = () => 0.5;
  try {
    await withImmediateTimeouts(async (delays) => {
      await assert.rejects(
        () =>
          writeJsonFile(
            {
              relayfileBaseUrl: "https://relayfile.example.test",
              relayfileApiToken: "test-token",
              workspaceId: "rw_no_retry_after",
              fetchImpl,
              writebackTimeoutMs: 0
            },
            "slack",
            "post",
            "/slack/channels/C1/messages/relayfile-writeback--no-retry-after.json",
            { text: "hello" }
          ),
        RelayfileWritebackError
      );
      assert.deepEqual(delays, [100, 200, 400]);
    });
  } finally {
    Math.random = realRandom;
  }
  assert.equal(attempts, 4);
});

test("writeJsonFile direct mode parses a digit-leading Retry-After date as a date", async () => {
  let attempts = 0;
  const fetchImpl: typeof fetch = async () => {
    attempts += 1;
    return Response.json(
      {
        code: "workspace_busy",
        message: "workspace write path is busy",
        reason: "write_admission_limit"
      },
      { status: 429, headers: { "Retry-After": "1 Jan 1970 00:00:00 GMT" } }
    );
  };

  await withImmediateTimeouts(async (delays) => {
    await assert.rejects(
      () =>
        writeJsonFile(
          {
            relayfileBaseUrl: "https://relayfile.example.test",
            relayfileApiToken: "test-token",
            workspaceId: "rw_date_retry_after",
            fetchImpl,
            writebackTimeoutMs: 0
          },
          "slack",
          "post",
          "/slack/channels/C1/messages/relayfile-writeback--date-retry-after.json",
          { text: "hello" }
        ),
      RelayfileWritebackError
    );
    assert.deepEqual(delays, []);
  });
  assert.equal(attempts, 4);
});

test("writeJsonFile direct admission deadline aborts an advertised retry without an orphan attempt", async () => {
  let attempts = 0;
  const fetchImpl: typeof fetch = async () => {
    attempts += 1;
    return Response.json(
      {
        code: "workspace_busy",
        message: "workspace write path is busy; retry after the advertised delay",
        reason: "write_admission_limit",
        retryAfterSeconds: 30
      },
      { status: 429, headers: { "Retry-After": "30" } }
    );
  };

  await assert.rejects(
    () =>
      writeJsonFile(
        {
          relayfileBaseUrl: "https://relayfile.example.test",
          relayfileApiToken: "test-token",
          workspaceId: "rw_deadline",
          fetchImpl,
          writebackTimeoutMs: 20
        },
        "slack",
        "post",
        "/slack/channels/C1/messages/relayfile-writeback--deadline.json",
        { text: "hello" }
      ),
    (error: unknown) =>
      error instanceof RelayfileWritebackAdmissionTimeoutError &&
      error.retryable &&
      /writeback_admission_timeout/.test(error.message)
  );

  assert.equal(attempts, 1);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(attempts, 1, "the SDK retry timer must be canceled when the client deadline wins");
});

test("writeJsonFile direct mode uses a 90s admission default when receipt timeout is omitted", async () => {
  let attempts = 0;
  const fetchImpl: typeof fetch = async () => {
    attempts += 1;
    if (attempts === 1) {
      return Response.json(
        {
          code: "workspace_busy",
          message: "workspace write path is busy",
          reason: "write_admission_limit"
        },
        { status: 429, headers: { "Retry-After": "5" } }
      );
    }
    return Response.json({ status: "queued", targetRevision: "rev_default_admitted" });
  };
  const delays: number[] = [];
  const deadlineHandle = 90_000 as unknown as ReturnType<typeof setTimeout>;
  let deadlineCleared = false;
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = ((
    callback: (...args: unknown[]) => void,
    delay?: number,
    ...args: unknown[]
  ) => {
    delays.push(delay ?? 0);
    if (delay === 90_000) return deadlineHandle;
    queueMicrotask(() => callback(...args));
    return 5_000 as unknown as ReturnType<typeof setTimeout>;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((handle: ReturnType<typeof setTimeout>) => {
    if (handle === deadlineHandle) deadlineCleared = true;
  }) as typeof clearTimeout;
  try {
    const result = await writeJsonFile(
      {
        relayfileBaseUrl: "https://relayfile.example.test",
        relayfileApiToken: "test-token",
        workspaceId: "rw_default_admission",
        fetchImpl
      },
      "slack",
      "post",
      "/slack/channels/C1/messages/relayfile-writeback--default-admission.json",
      { text: "hello" }
    );
    assert.equal(result.opId, undefined);
  } finally {
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
  }
  assert.equal(attempts, 2);
  assert.deepEqual(delays, [90_000, 5_000]);
  assert.equal(deadlineCleared, true);
});

test("writeJsonFile direct mode bounds repeated 30s admission delays at the 90s default", async () => {
  let attempts = 0;
  const fetchImpl: typeof fetch = async () => {
    attempts += 1;
    return Response.json(
      {
        code: "workspace_busy",
        message: "workspace write path is busy",
        reason: "write_admission_limit"
      },
      { status: 429, headers: { "Retry-After": "30" } }
    );
  };
  const delays: number[] = [];
  let deadlineCallback: (() => void) | undefined;
  let retryTimers = 0;
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = ((
    callback: (...args: unknown[]) => void,
    delay?: number,
    ...args: unknown[]
  ) => {
    delays.push(delay ?? 0);
    if (delay === 90_000) {
      deadlineCallback = () => callback(...args);
      return 90_000 as unknown as ReturnType<typeof setTimeout>;
    }
    retryTimers += 1;
    if (retryTimers < 3) {
      queueMicrotask(() => callback(...args));
    } else {
      queueMicrotask(() => deadlineCallback?.());
    }
    return retryTimers as unknown as ReturnType<typeof setTimeout>;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = (() => {}) as typeof clearTimeout;
  try {
    await assert.rejects(
      () =>
        writeJsonFile(
          {
            relayfileBaseUrl: "https://relayfile.example.test",
            relayfileApiToken: "test-token",
            workspaceId: "rw_default_admission_bound",
            fetchImpl
          },
          "slack",
          "post",
          "/slack/channels/C1/messages/relayfile-writeback--default-admission-bound.json",
          { text: "hello" }
        ),
      RelayfileWritebackAdmissionTimeoutError
    );
  } finally {
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
  }
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [90_000, 30_000, 30_000, 30_000]);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(attempts, 3, "the default admission deadline must not leave an orphan fourth attempt");
});

test("writeJsonFile direct mode reports a pending op as retryable writeback_pending", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("/fs/file")) {
      return Response.json({
        opId: "op_pending",
        status: "queued",
        targetRevision: "rev_1",
        writeback: { provider: "slack", state: "pending" }
      });
    }
    if (url.includes("/ops/op_pending")) {
      return Response.json({
        opId: "op_pending",
        status: "running",
        attemptCount: 1
      });
    }
    return Response.json({ code: "not_found", message: "unexpected request" }, { status: 404 });
  };

  await assert.rejects(
    () =>
      writeJsonFile(
        {
          relayfileBaseUrl: "https://relayfile.example.test",
          relayfileApiToken: "token-with-fs-write-and-ops-read",
          workspaceId: "rw_7ccfea89",
          fetchImpl,
          writebackTimeoutMs: 20,
          writebackPollMs: 5
        },
        "slack",
        "post",
        "/slack/channels/C0AF4JELP1S/messages/relayfile-writeback--2.json",
        { text: "hello" }
      ),
    (error: unknown) =>
      error instanceof RelayfileWritebackPendingError &&
      error.retryable &&
      error.opId === "op_pending" &&
      /writeback_pending/.test(error.message)
  );
});

test("writeJsonFile direct mode surfaces op authorization failures instead of pending", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("/fs/file")) {
      return Response.json({
        opId: "op_forbidden",
        status: "queued",
        targetRevision: "rev_1",
        writeback: { provider: "slack", state: "pending" }
      });
    }
    if (url.includes("/ops/op_forbidden")) {
      return Response.json(
        { code: "forbidden", message: "missing ops read scope", correlationId: "rf_forbidden" },
        { status: 403 }
      );
    }
    return Response.json({ code: "not_found", message: "unexpected request" }, { status: 404 });
  };

  await assert.rejects(
    () =>
      writeJsonFile(
        {
          relayfileBaseUrl: "https://relayfile.example.test",
          relayfileApiToken: "token-without-ops-read",
          workspaceId: "rw_7ccfea89",
          fetchImpl,
          writebackTimeoutMs: 20,
          writebackPollMs: 5
        },
        "slack",
        "post",
        "/slack/channels/C0AF4JELP1S/messages/relayfile-writeback--3.json",
        { text: "hello" }
      ),
    (error: unknown) =>
      error instanceof RelayfileWritebackError &&
      !(error instanceof RelayfileWritebackPendingError) &&
      error.cause instanceof Error &&
      /missing ops read scope/.test(error.cause.message)
  );
});

test("writeJsonFile direct mode rejects succeeded Slack ops without a provider ts", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("/fs/file")) {
      return Response.json({
        opId: "op_missing_ts",
        status: "queued",
        targetRevision: "rev_1",
        writeback: { provider: "slack", state: "pending" }
      });
    }
    if (url.includes("/ops/op_missing_ts")) {
      return Response.json({
        opId: "op_missing_ts",
        status: "succeeded",
        attemptCount: 1,
        providerResult: {
          provider: "slack",
          acknowledgedAt: "2026-06-19T12:01:04Z"
        }
      });
    }
    return Response.json({ code: "not_found", message: "unexpected request" }, { status: 404 });
  };

  await assert.rejects(
    () =>
      writeJsonFile(
        {
          relayfileBaseUrl: "https://relayfile.example.test",
          relayfileApiToken: "token-with-fs-write-and-ops-read",
          workspaceId: "rw_7ccfea89",
          fetchImpl,
          writebackTimeoutMs: 20,
          writebackPollMs: 5
        },
        "slack",
        "post",
        "/slack/channels/C0AF4JELP1S/messages/relayfile-writeback--4.json",
        { text: "hello" }
      ),
    (error: unknown) =>
      error instanceof RelayfileWritebackReceiptError &&
      error.cause instanceof Error &&
      /writeback_receipt_invalid/.test(error.cause.message) &&
      /externalId or providerResult\.ts/.test(error.cause.message)
  );
});

test("writeJsonFile direct mode rejects empty Slack receipt identifiers", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("/fs/file")) {
      return Response.json({
        opId: "op_empty_ts",
        status: "queued",
        targetRevision: "rev_1",
        writeback: { provider: "slack", state: "pending" }
      });
    }
    if (url.includes("/ops/op_empty_ts")) {
      return Response.json({
        opId: "op_empty_ts",
        status: "succeeded",
        attemptCount: 1,
        providerResult: {
          provider: "slack",
          externalId: "",
          ts: "   "
        }
      });
    }
    return Response.json({ code: "not_found", message: "unexpected request" }, { status: 404 });
  };

  await assert.rejects(
    () =>
      writeJsonFile(
        {
          relayfileBaseUrl: "https://relayfile.example.test",
          relayfileApiToken: "token-with-fs-write-and-ops-read",
          workspaceId: "rw_7ccfea89",
          fetchImpl,
          writebackTimeoutMs: 20,
          writebackPollMs: 5
        },
        "slack",
        "post",
        "/slack/channels/C0AF4JELP1S/messages/relayfile-writeback--5.json",
        { text: "hello" }
      ),
    (error: unknown) =>
      error instanceof RelayfileWritebackReceiptError &&
      error.cause instanceof Error &&
      /externalId or providerResult\.ts/.test(error.cause.message)
  );
});

test("writeJsonFile direct mode rejects queued writeback responses missing opId", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("/fs/file")) {
      return Response.json({
        status: "queued",
        targetRevision: "rev_1",
        writeback: { provider: "slack", state: "pending" }
      });
    }
    return Response.json({ code: "not_found", message: "unexpected request" }, { status: 404 });
  };

  await assert.rejects(
    () =>
      writeJsonFile(
        {
          relayfileBaseUrl: "https://relayfile.example.test",
          relayfileApiToken: "token-with-fs-write-and-ops-read",
          workspaceId: "rw_7ccfea89",
          fetchImpl,
          writebackTimeoutMs: 20,
          writebackPollMs: 5
        },
        "slack",
        "post",
        "/slack/channels/C0AF4JELP1S/messages/relayfile-writeback--6.json",
        { text: "hello" }
      ),
    (error: unknown) =>
      error instanceof RelayfileWritebackReceiptError &&
      error.opId === "(missing)" &&
      error.cause instanceof Error &&
      /did not include opId/.test(error.cause.message)
  );
});

test("writeJsonFile direct mode surfaces unexpected op polling failures", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("/fs/file")) {
      return Response.json({
        opId: "op_transport_failure",
        status: "queued",
        targetRevision: "rev_1",
        writeback: { provider: "slack", state: "pending" }
      });
    }
    if (url.includes("/ops/op_transport_failure")) {
      throw new TypeError("network unavailable");
    }
    return Response.json({ code: "not_found", message: "unexpected request" }, { status: 404 });
  };

  await assert.rejects(
    () =>
      writeJsonFile(
        {
          relayfileBaseUrl: "https://relayfile.example.test",
          relayfileApiToken: "token-with-fs-write-and-ops-read",
          workspaceId: "rw_7ccfea89",
          fetchImpl,
          writebackTimeoutMs: 20,
          writebackPollMs: 5
        },
        "slack",
        "post",
        "/slack/channels/C0AF4JELP1S/messages/relayfile-writeback--7.json",
        { text: "hello" }
      ),
    (error: unknown) =>
      error instanceof RelayfileWritebackError &&
      !(error instanceof RelayfileWritebackPendingError) &&
      error.cause instanceof TypeError &&
      /network unavailable/.test(error.cause.message)
  );
});

test("an in-mount name starting with '..' is allowed (not a traversal escape)", async () => {
  const { root, opts } = await mount();
  await writeJsonFile(opts, "x", "write", "/..foo/bar.json", { ok: true });
  assert.deepEqual(JSON.parse(await readFile(path.join(root, "..foo/bar.json"), "utf8")), { ok: true });
});

// --- backend selection: FS mount vs HTTP fallback (sandbox:false reply bots) ---

const MOUNT_AND_DIRECT_ENV_KEYS = [
  "RELAYFILE_MOUNT_PATH",
  "WORKSPACE_ROOT",
  "WORKFORCE_SANDBOX_ROOT",
  "RELAYFILE_MOUNT_ROOT",
  "RELAYFILE_ROOT",
  "RELAYFILE_BASE_URL",
  "RELAYFILE_URL",
  "RELAYFILE_TOKEN",
  "RELAYFILE_WORKSPACE_ID",
  "RELAYFILE_WORKSPACE",
  "RELAY_WORKSPACE_ID"
] as const;

/** Run `fn` with the listed env vars cleared, then set to `overrides`; always restored. */
async function withScrubbedEnv(
  overrides: Partial<Record<(typeof MOUNT_AND_DIRECT_ENV_KEYS)[number], string>>,
  fn: () => Promise<void>
): Promise<void> {
  const saved = new Map<string, string | undefined>();
  for (const key of MOUNT_AND_DIRECT_ENV_KEYS) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(overrides)) {
    process.env[key] = value;
  }
  try {
    await fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("writeJsonFile uses the FS mount path when a mount is configured (HTTP env present but ignored)", async () => {
  const { root, opts } = await mount();
  let fetched = false;
  const fetchImpl: typeof fetch = async () => {
    fetched = true;
    return Response.json({ code: "should_not_be_called" }, { status: 500 });
  };
  // Even with full direct HTTP env set, an explicit mount root must win → FS.
  await withScrubbedEnv(
    {
      RELAYFILE_URL: "https://relayfile.example.test",
      RELAYFILE_TOKEN: "tok",
      RELAYFILE_WORKSPACE_ID: "rw_env"
    },
    async () => {
      const rel = `/slack/channels/C1/messages/${draftFile("msg")}`;
      const result = await writeJsonFile({ ...opts, fetchImpl }, "slack", "post", rel, { text: "hi" });
      assert.equal(result.absolutePath.startsWith(root), true);
    }
  );
  assert.equal(fetched, false, "must not hit HTTP when a mount root is configured");
  const dir = path.join(root, "slack/channels/C1/messages");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  assert.equal(files.length, 1);
});

test("writeJsonFile routes over HTTP when there is no mount but RELAYFILE_URL/TOKEN/WORKSPACE_ID are set", async () => {
  const requests: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    requests.push(url);
    if (url.includes("/fs/file")) {
      return Response.json({
        opId: "op_env_http",
        status: "queued",
        targetRevision: "rev_1",
        writeback: { provider: "slack", state: "pending" }
      });
    }
    if (url.includes("/ops/op_env_http")) {
      return Response.json({
        opId: "op_env_http",
        status: "succeeded",
        attemptCount: 1,
        providerResult: { provider: "slack", externalId: "1781870464.800039", ts: "1781870464.800039", channel: "C1" }
      });
    }
    return Response.json({ code: "not_found" }, { status: 404 });
  };

  await withScrubbedEnv(
    {
      RELAYFILE_URL: "https://relayfile.example.test",
      RELAYFILE_TOKEN: "env-token",
      RELAYFILE_WORKSPACE_ID: "rw_env"
    },
    async () => {
      const result = await writeJsonFile(
        { fetchImpl, writebackTimeoutMs: 100, writebackPollMs: 5 },
        "slack",
        "post",
        "/slack/channels/C1/messages/relayfile-writeback--env.json",
        { text: "hi" }
      );
      assert.equal(result.opId, "op_env_http");
      assert.equal(result.receipt?.externalId, "1781870464.800039");
    }
  );

  assert.equal(requests.length, 2);
  assert.match(requests[0], /\/v1\/workspaces\/rw_env\/fs\/file\?/);
  assert.match(requests[0], /path=/); // same provider draft path is sent over HTTP
  assert.match(requests[1], /\/v1\/workspaces\/rw_env\/ops\/op_env_http$/);
});

test("writeJsonFile throws a clear error when there is no mount and no HTTP config (no stray cwd write)", async () => {
  let fetched = false;
  const fetchImpl: typeof fetch = async () => {
    fetched = true;
    return Response.json({}, { status: 200 });
  };
  await withScrubbedEnv({}, async () => {
    await assert.rejects(
      () =>
        writeJsonFile(
          { fetchImpl, writebackTimeoutMs: 0 },
          "slack",
          "post",
          "/slack/channels/C1/messages/relayfile-writeback--none.json",
          { text: "hi" }
        ),
      (error: unknown) =>
        error instanceof RelayfileWritebackError &&
        error.cause instanceof Error &&
        /no Relayfile mount and no direct HTTP config/.test(error.cause.message)
    );
  });
  assert.equal(fetched, false);
});

test("an explicit direct HTTP option beats a mount-root env var (intentional HTTP)", async () => {
  const requests: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    requests.push(url);
    if (url.includes("/fs/file")) {
      return Response.json({ opId: "op_explicit", status: "queued", targetRevision: "rev_1" });
    }
    return Response.json({ code: "not_found" }, { status: 404 });
  };
  // A mount env var is present, but the caller passes explicit HTTP opts → HTTP.
  await withScrubbedEnv({ WORKFORCE_SANDBOX_ROOT: "/tmp/some-sandbox-root" }, async () => {
    const result = await writeJsonFile(
      {
        relayfileBaseUrl: "https://relayfile.example.test",
        relayfileApiToken: "explicit-token",
        workspaceId: "rw_explicit",
        fetchImpl,
        writebackTimeoutMs: 0
      },
      "slack",
      "post",
      "/slack/channels/C1/messages/relayfile-writeback--explicit.json",
      { text: "hi" }
    );
    assert.equal(result.opId, "op_explicit");
  });
  assert.equal(requests.length, 1);
  assert.match(requests[0], /\/v1\/workspaces\/rw_explicit\/fs\/file\?/);
});
