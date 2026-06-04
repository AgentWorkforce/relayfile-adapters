import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  RelayfileWritebackError,
  draftFile,
  encodeSegment,
  listJsonFiles,
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
});

test("an in-mount name starting with '..' is allowed (not a traversal escape)", async () => {
  const { root, opts } = await mount();
  await writeJsonFile(opts, "x", "write", "/..foo/bar.json", { ok: true });
  assert.deepEqual(JSON.parse(await readFile(path.join(root, "..foo/bar.json"), "utf8")), { ok: true });
});
