import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyWrite,
  executeFileNativeWriteback,
  validatePayload,
  type AdapterResourceConfig,
  type JsonSchema,
} from "./file-native-router.js";
import {
  clearWritebackStatus,
  listWritebackStatus,
  recordWritebackStatus,
} from "./writeback-status.js";

const resources: readonly AdapterResourceConfig[] = [
  {
    name: "issues",
    path: "/linear/issues",
    pathPattern: /^\/linear\/issues(?:\/[^/]+(?:\.json)?)?$/,
    idPattern:
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    schema: "discovery/linear/issues/.schema.json",
    createExample: "discovery/linear/issues/.create.example.json",
  },
  {
    name: "comments",
    path: "/linear/issues/{issueId}/comments",
    pathPattern: /^\/linear\/issues\/[^/]+\/comments(?:\/[^/]+(?:\.json)?)?$/,
    idPattern:
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    schema: "discovery/linear/issues/{issueId}/comments/.schema.json",
    createExample:
      "discovery/linear/issues/{issueId}/comments/.create.example.json",
  },
];

const issueId = "11111111-1111-1111-1111-111111111111";

test("classifyWrite maps canonical ids to patch and drafts to create", () => {
  const patch = classifyWrite(`/linear/issues/${issueId}.json`, resources);
  assert.equal(patch?.kind, "patch");
  assert.equal(patch?.canonical, true);
  assert.equal(patch?.id, issueId);
  assert.equal(patch?.resource.name, "issues");

  const create = classifyWrite("/linear/issues/draft-title.json", resources);
  assert.equal(create?.kind, "create");
  assert.equal(create?.canonical, false);
  assert.equal(create?.id, "draft-title");
  assert.equal(classifyWrite("/linear/issues", resources), null);
});

test("classifyWrite maps canonical delete events to delete", () => {
  const deleted = classifyWrite(`/linear/issues/${issueId}.json`, resources, {
    fsEvent: "delete",
  });
  assert.equal(deleted?.kind, "delete");
  assert.equal(deleted?.canonical, true);
  assert.equal(deleted?.id, issueId);

  assert.equal(
    classifyWrite("/linear/issues/draft-title.json", resources, {
      fsEvent: "delete",
    }),
    null
  );
});

test("classifyWrite chooses the most specific matching resource", () => {
  const route = classifyWrite(
    `/linear/issues/${issueId}/comments/draft-comment.json`,
    resources
  );
  assert.equal(route?.kind, "create");
  assert.equal(route?.resource.name, "comments");
});

test("validatePayload enforces create required fields", () => {
  const schema = issueSchema();
  const result = validatePayload({ priority: 2 }, schema, "create");

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.deepEqual(
      result.errors.map((error) => [error.field, error.reason]),
      [["title", "required"]]
    );
  }

  assert.deepEqual(validatePayload({ priority: 2 }, schema, "patch"), {
    ok: true,
  });
});

test("validatePayload enforces additionalProperties false", () => {
  const result = validatePayload(
    { title: "Issue", unexpected: true },
    issueSchema(),
    "create"
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.errors[0]?.field, "unexpected");
    assert.equal(result.errors[0]?.reason, "additionalProperties");
  }
});

test("validatePayload rejects read-only fields", () => {
  const result = validatePayload(
    { title: "Issue", id: issueId },
    issueSchema(),
    "create"
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.errors[0]?.field, "id");
    assert.equal(result.errors[0]?.reason, "readOnly");
  }
});

test("validatePayload enforces field types and enums", () => {
  const result = validatePayload(
    { title: 123, priority: 9 },
    issueSchema(),
    "create"
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.deepEqual(
      result.errors.map((error) => [error.field, error.reason]),
      [
        ["title", "type"],
        ["priority", "enum"],
      ]
    );
  }
});

test("writeback status sink records and filters entries", () => {
  clearWritebackStatus();
  recordWritebackStatus({
    path: "/linear/issues/draft.json",
    op: "create",
    outcome: "validation_failed",
    error: "Missing required field \"title\"",
    field: "title",
    timestamp: "2026-05-09T09:00:00.000Z",
  });
  recordWritebackStatus({
    path: `/linear/issues/${issueId}.json`,
    op: "patch",
    outcome: "ok",
    timestamp: "2026-05-09T09:01:00.000Z",
  });

  assert.equal(listWritebackStatus().length, 2);
  assert.deepEqual(listWritebackStatus({ outcome: "validation_failed" }), [
    {
      path: "/linear/issues/draft.json",
      op: "create",
      outcome: "validation_failed",
      error: "Missing required field \"title\"",
      field: "title",
      timestamp: "2026-05-09T09:00:00.000Z",
    },
  ]);
});

test("executeFileNativeWriteback validates, resolves create, records ok, and returns receipt", async () => {
  clearWritebackStatus();

  const result = await executeFileNativeWriteback({
    path: "/linear/issues/draft-title.json",
    content: JSON.stringify({ title: "Issue" }),
    resources,
    loadSchema: issueSchema,
    now: () => new Date("2026-05-09T09:02:00.000Z"),
    resolveWritebackRequest(path, content) {
      assert.equal(path, "/linear/issues/draft-title.json");
      assert.equal(JSON.parse(content).title, "Issue");
      return {
        action: "create_issue",
        method: "POST",
        endpoint: "/graphql",
      };
    },
    applyWriteback(request, route) {
      assert.equal(route.kind, "create");
      assert.equal(request.action, "create_issue");
      return { externalId: issueId };
    },
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.route.kind, "create");
    assert.deepEqual(result.createReceipt, {
      draftPath: "/linear/issues/draft-title.json",
      canonicalPath: `/linear/issues/${issueId}.json`,
      id: issueId,
      resource: "issues",
      createdAt: "2026-05-09T09:02:00.000Z",
    });
    assert.equal(result.status.outcome, "ok");
  }
  assert.deepEqual(listWritebackStatus({ path: "/linear/issues/draft-title.json" }), [
    {
      path: "/linear/issues/draft-title.json",
      op: "create",
      status: "accepted",
      code: "OK",
      outcome: "ok",
      timestamp: "2026-05-09T09:02:00.000Z",
    },
  ]);
});

test("executeFileNativeWriteback records validation and read-only failures", async () => {
  clearWritebackStatus();

  const missingRequired = await executeFileNativeWriteback({
    path: "/linear/issues/draft-title.json",
    content: JSON.stringify({ priority: 2 }),
    resources,
    loadSchema: issueSchema,
    now: () => new Date("2026-05-09T09:03:00.000Z"),
    resolveWritebackRequest() {
      throw new Error("resolver should not run after validation failure");
    },
  });
  assert.equal(missingRequired.ok, false);
  assert.equal(missingRequired.status?.status, "rejected");
  assert.equal(missingRequired.status?.code, "VALIDATION_FAILED");
  assert.equal(missingRequired.status?.outcome, "validation_failed");
  assert.equal(missingRequired.status?.field, "title");

  const readonly = await executeFileNativeWriteback({
    path: `/linear/issues/${issueId}.json`,
    content: JSON.stringify({ id: issueId }),
    resources,
    loadSchema: issueSchema,
    now: () => new Date("2026-05-09T09:04:00.000Z"),
    resolveWritebackRequest() {
      throw new Error("resolver should not run after read-only failure");
    },
  });
  assert.equal(readonly.ok, false);
  assert.equal(readonly.status?.status, "rejected");
  assert.equal(readonly.status?.code, "READ_ONLY_FIELD");
  assert.equal(readonly.status?.outcome, "readonly_rejected");
  assert.equal(readonly.status?.field, "id");

  assert.deepEqual(
    listWritebackStatus().map((entry) => [
      entry.op,
      entry.status,
      entry.code,
      entry.outcome,
      entry.field,
    ]),
    [
      ["create", "rejected", "VALIDATION_FAILED", "validation_failed", "title"],
      ["patch", "rejected", "READ_ONLY_FIELD", "readonly_rejected", "id"],
    ]
  );
});

test("executeFileNativeWriteback routes canonical deletes without schema validation", async () => {
  clearWritebackStatus();

  const result = await executeFileNativeWriteback({
    path: `/linear/issues/${issueId}.json`,
    resources,
    fsEvent: "delete",
    now: () => new Date("2026-05-09T09:05:00.000Z"),
    resolveDeleteRequest(path) {
      assert.equal(path, `/linear/issues/${issueId}.json`);
      return {
        action: "delete_issue",
        method: "DELETE",
        endpoint: `/issues/${issueId}`,
      };
    },
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.route.kind, "delete");
    assert.equal(result.request?.method, "DELETE");
  }
  assert.deepEqual(listWritebackStatus(), [
    {
      path: `/linear/issues/${issueId}.json`,
      op: "delete",
      status: "accepted",
      code: "OK",
      outcome: "ok",
      timestamp: "2026-05-09T09:05:00.000Z",
    },
  ]);
});

test("executeFileNativeWriteback bypasses validation for schema-less create/patch resources", async () => {
  clearWritebackStatus();
  const emptySchema: JsonSchema = {};

  const create = await executeFileNativeWriteback({
    path: "/linear/issues/draft.json",
    content: JSON.stringify({ anything: "goes", id: "still-allowed-no-schema" }),
    resources,
    loadSchema: () => emptySchema,
    now: () => new Date("2026-05-09T10:00:00.000Z"),
    resolveWritebackRequest(path) {
      assert.equal(path, "/linear/issues/draft.json");
      return {
        action: "create_issue",
        method: "POST",
        endpoint: "/issues",
        body: { title: "from draft" },
      };
    },
  });
  assert.equal(create.ok, true);
  if (create.ok) {
    assert.equal(create.route.kind, "create");
  }

  const patch = await executeFileNativeWriteback({
    path: `/linear/issues/${issueId}.json`,
    content: JSON.stringify({ anything: "goes", id: "still-allowed-no-schema" }),
    resources,
    loadSchema: () => emptySchema,
    now: () => new Date("2026-05-09T10:00:01.000Z"),
    resolveWritebackRequest(path) {
      assert.equal(path, `/linear/issues/${issueId}.json`);
      return {
        action: "update_issue",
        method: "PUT",
        endpoint: `/issues/${issueId}`,
        body: { anything: "goes" },
      };
    },
  });
  assert.equal(patch.ok, true);
  if (patch.ok) {
    assert.equal(patch.route.kind, "patch");
  }
});

function issueSchema(): JsonSchema {
  return {
    type: "object",
    required: ["title"],
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      priority: { enum: [0, 1, 2, 3, 4] },
      id: { type: "string", readOnly: true },
    },
  };
}
