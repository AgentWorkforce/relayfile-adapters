import assert from "node:assert/strict";
import test from "node:test";

import { parseRelayfilePath, toDraftRelayfilePath } from "./path-mapper.js";
import { providerQueries } from "./queries.js";
import { resources } from "./resources.js";
import { ReadOnlyFieldError, resolveWritebackRequest } from "./writeback.js";

const DRAFT_BODY = JSON.stringify({
  message: { raw: "RnJvbTogbWVAZXhhbXBsZS5jb20K" },
});

test("any non-canonical draft filename resolves to a create", () => {
  for (const path of [
    // Neutral names: no reserved prefix, no `new.json` privilege. What makes
    // these creates is failing the drafts idPattern, nothing else.
    toDraftRelayfilePath({ id: "ask-storebrand-confirmation" }),
    toDraftRelayfilePath({ account: "me@example.com", id: "ask storebrand" }),
    toDraftRelayfilePath({ account: "me@example.com", id: "draft-subject" }),
    "/google-mail/me@example.com/drafts/reply-to-karoline.json",
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

test("a canonical draft id resolves to an update without an explicit operation", () => {
  const request = resolveWritebackRequest(
    toDraftRelayfilePath({ account: "me@example.com", id: "r-4692061400304996596" }),
    DRAFT_BODY,
  );
  assert.equal(request.operation, "update");
  assert.equal(request.action, "gmail.drafts.update");
  assert.equal(request.method, "PUT");
  assert.equal(request.endpoint, providerQueries.actions.draftWrite);
});

test("draft path composition round-trips through the parser", () => {
  const collectionPath = toDraftRelayfilePath({ id: "r1234567890" });
  const accountPath = toDraftRelayfilePath({
    account: "me@example.com",
    id: "r1234567890",
  });
  assert.equal(collectionPath, "/gmail/drafts/r1234567890.json");
  assert.equal(accountPath, "/gmail/me@example.com/drafts/r1234567890.json");
  for (const path of [collectionPath, accountPath]) {
    const parsed = parseRelayfilePath(path);
    assert.equal(parsed.resource, "drafts", path);
    assert.equal(parsed.id, "r1234567890", path);
  }
  assert.throws(() => toDraftRelayfilePath({ id: "  " }));
});

test("the drafts idPattern matches Gmail draft ids and rejects prose filenames", () => {
  const drafts = resources.find((resource) => resource.name === "drafts");
  assert.ok(drafts);
  for (const id of ["r-4692061400304996596", "r1234567890"]) {
    assert.equal(drafts.idPattern.test(id), true, id);
  }
  for (const id of ["new", "draft-subject", "ask-storebrand-confirmation", "ask storebrand"]) {
    assert.equal(drafts.idPattern.test(id), false, id);
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
