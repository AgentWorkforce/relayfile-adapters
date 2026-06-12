import assert from "node:assert/strict";
import test from "node:test";

import {
  computeDaytonaPath,
  daytonaSandboxPath,
  daytonaSnapshotPath,
  daytonaUsagePath,
  daytonaVolumePath,
} from "./path-mapper.js";

test("Daytona path helpers produce canonical resource paths", () => {
  assert.equal(daytonaUsagePath("org-123"), "/daytona/usage/org-123.json");
  assert.equal(daytonaSandboxPath("sandbox-123"), "/daytona/sandboxes/sandbox-123.json");
  assert.equal(daytonaSnapshotPath("snapshot-123"), "/daytona/snapshots/snapshot-123.json");
  assert.equal(daytonaVolumePath("volume-123"), "/daytona/volumes/volume-123.json");
});

test("computeDaytonaPath resolves supported object types", () => {
  assert.equal(computeDaytonaPath("sandbox", "sandbox-123"), "/daytona/sandboxes/sandbox-123.json");
  assert.equal(computeDaytonaPath("snapshot", "snapshot-123"), "/daytona/snapshots/snapshot-123.json");
  assert.equal(computeDaytonaPath("volume", "volume-123"), "/daytona/volumes/volume-123.json");
});

test("computeDaytonaPath normalizes aliases and URL-encodes ids", () => {
  assert.equal(
    computeDaytonaPath("daytonasandbox", "sandbox with spaces"),
    "/daytona/sandboxes/sandbox%20with%20spaces.json",
  );
  assert.equal(
    computeDaytonaPath("daytonasnapshot", "snap/with/slashes"),
    "/daytona/snapshots/snap%2Fwith%2Fslashes.json",
  );
});

test("computeDaytonaPath rejects unsupported object types and empty ids", () => {
  assert.throws(() => computeDaytonaPath("workspace", "workspace-123"), /Unsupported Daytona object type/u);
  assert.throws(() => computeDaytonaPath("sandbox", " "), /Daytona object id must be a non-empty string/u);
});
