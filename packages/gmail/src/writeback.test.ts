import assert from "node:assert/strict";
import test from "node:test";

import { providerQueries } from "./queries.js";
import { ReadOnlyFieldError, resolveWritebackRequest } from "./writeback.js";

const DRAFT_BODY = JSON.stringify({
  message: { raw: "RnJvbTogbWVAZXhhbXBsZS5jb20K" },
});

test("draft creates post to the drafts collection", () => {
  for (const path of [
    "/gmail/drafts/new.json",
    "/gmail/me@example.com/drafts/draft-subject.json",
    "/google-mail/me@example.com/drafts/draft-subject.json",
  ]) {
    const request = resolveWritebackRequest(path, DRAFT_BODY);
    assert.equal(request.resource, "drafts", path);
    assert.equal(request.action, "gmail.drafts.create", path);
    assert.equal(request.operation, "create", path);
    assert.equal(request.method, "POST", path);
    assert.equal(request.endpoint, providerQueries.actions.draftCreate, path);
    assert.deepEqual(request.body, JSON.parse(DRAFT_BODY), path);
  }
});

test("draft updates PUT the addressed draft, not the messages.modify endpoint", () => {
  const request = resolveWritebackRequest(
    "/gmail/me@example.com/drafts/r1234567890.json",
    DRAFT_BODY,
    "update",
  );
  assert.equal(request.action, "gmail.drafts.update");
  assert.equal(request.method, "PUT");
  assert.equal(request.endpoint, providerQueries.actions.draftWrite);
  assert.equal(request.resourceId, "r1234567890");
  assert.notEqual(request.endpoint, providerQueries.actions.objectWrite);
});

test("draft deletes address the draft id", () => {
  const request = resolveWritebackRequest(
    "/gmail/me@example.com/drafts/r1234567890.json",
    "",
  );
  assert.equal(request.action, "gmail.drafts.delete");
  assert.equal(request.method, "DELETE");
  assert.equal(request.endpoint, providerQueries.actions.draftWrite);
  assert.equal(request.body, null);
});

test("thread writes still resolve to messages.modify", () => {
  const request = resolveWritebackRequest(
    "/gmail/me@example.com/threads/thread-1.json",
    JSON.stringify({ labelIds: ["STARRED"] }),
    "update",
  );
  assert.equal(request.resource, "threads");
  assert.equal(request.action, "gmail.threads.update");
  assert.equal(request.method, "PATCH");
  assert.equal(request.endpoint, providerQueries.actions.objectWrite);
});

test("watch writes still resolve to the lifecycle endpoint", () => {
  const request = resolveWritebackRequest(
    "/gmail/watches/watch-1.json",
    JSON.stringify({ topicName: "projects/example/topics/gmail" }),
  );
  assert.equal(request.resource, "watches");
  assert.equal(request.endpoint, providerQueries.actions.lifecycleWrite);
});

test("read-only fields are rejected on every resource", () => {
  assert.throws(
    () =>
      resolveWritebackRequest(
        "/gmail/me@example.com/drafts/new.json",
        JSON.stringify({ id: "r-1", message: { raw: "" } }),
      ),
    ReadOnlyFieldError,
  );
});
