import assert from "node:assert/strict";
import test from "node:test";

import {
  LIFECYCLE_RESOURCE_PATH,
  OBJECT_RESOURCE_PATH,
  parseRelayfilePath,
  RELAYFILE_ROOT,
  toObjectRelayfilePath,
} from "./path-mapper.js";

test("Gmail path constants and writes use the canonical root", () => {
  assert.equal(RELAYFILE_ROOT, "/gmail");
  assert.equal(OBJECT_RESOURCE_PATH, `${RELAYFILE_ROOT}/{account}/threads`);
  assert.equal(LIFECYCLE_RESOURCE_PATH, `${RELAYFILE_ROOT}/watches`);
  assert.equal(
    toObjectRelayfilePath({
      account: "me",
      threadId: "thread-1",
    }),
    "/gmail/me/threads/thread-1.json",
  );
});

test("Gmail parser recognizes canonical and legacy migration roots", () => {
  for (const path of [
    "/gmail/me/threads/thread-1.json",
    "/google-mail/me/threads/thread-1.json",
  ]) {
    assert.deepEqual(parseRelayfilePath(path), {
      resource: "object",
      id: "thread-1",
      segments: [
        path.startsWith("/google-mail") ? "google-mail" : "gmail",
        "me",
        "threads",
        "thread-1",
      ],
    });
  }

  assert.equal(
    parseRelayfilePath("/gmail/watches/watch-1.json").resource,
    "lifecycle",
  );
  assert.equal(
    parseRelayfilePath("/google-mail/watches/watch-legacy.json").resource,
    "lifecycle",
  );
  assert.equal(
    parseRelayfilePath("/gmailish/me/threads/thread-1.json").resource,
    "unknown",
  );
});
