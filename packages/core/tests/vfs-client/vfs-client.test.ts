import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  RelayfileWritebackError,
  RelayfileWritebackPendingError,
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

test("an in-mount name starting with '..' is allowed (not a traversal escape)", async () => {
  const { root, opts } = await mount();
  await writeJsonFile(opts, "x", "write", "/..foo/bar.json", { ok: true });
  assert.deepEqual(JSON.parse(await readFile(path.join(root, "..foo/bar.json"), "utf8")), { ok: true });
});
