import assert from "node:assert/strict";
import test from "node:test";

import { normalizeDaytonaWebhook } from "./webhook-normalizer.js";
import type { DaytonaWebhookEvent } from "./types.js";

type ExpectedObjectType = "sandbox" | "snapshot" | "volume";

interface EventCase {
  eventType: DaytonaWebhookEvent;
  objectType: ExpectedObjectType;
  objectId: string;
  expectedPath: string;
  expectedFileEventType: "file.created" | "file.updated" | "file.deleted";
  expectedShouldDelete: boolean;
}

const eventCases: readonly EventCase[] = [
  {
    eventType: "sandbox.created",
    objectType: "sandbox",
    objectId: "sandbox-1",
    expectedPath: "/daytona/sandboxes/sandbox-1.json",
    expectedFileEventType: "file.created",
    expectedShouldDelete: false,
  },
  {
    eventType: "sandbox.state.updated",
    objectType: "sandbox",
    objectId: "sandbox-2",
    expectedPath: "/daytona/sandboxes/sandbox-2.json",
    expectedFileEventType: "file.updated",
    expectedShouldDelete: false,
  },
  {
    eventType: "snapshot.created",
    objectType: "snapshot",
    objectId: "snapshot-1",
    expectedPath: "/daytona/snapshots/snapshot-1.json",
    expectedFileEventType: "file.created",
    expectedShouldDelete: false,
  },
  {
    eventType: "snapshot.state.updated",
    objectType: "snapshot",
    objectId: "snapshot-2",
    expectedPath: "/daytona/snapshots/snapshot-2.json",
    expectedFileEventType: "file.updated",
    expectedShouldDelete: false,
  },
  {
    eventType: "snapshot.removed",
    objectType: "snapshot",
    objectId: "snapshot-3",
    expectedPath: "/daytona/snapshots/snapshot-3.json",
    expectedFileEventType: "file.deleted",
    expectedShouldDelete: true,
  },
  {
    eventType: "volume.created",
    objectType: "volume",
    objectId: "volume-1",
    expectedPath: "/daytona/volumes/volume-1.json",
    expectedFileEventType: "file.created",
    expectedShouldDelete: false,
  },
  {
    eventType: "volume.state.updated",
    objectType: "volume",
    objectId: "volume-2",
    expectedPath: "/daytona/volumes/volume-2.json",
    expectedFileEventType: "file.updated",
    expectedShouldDelete: false,
  },
];

for (const eventCase of eventCases) {
  test(`normalizes Daytona ${eventCase.eventType} webhooks`, () => {
    const normalized = normalizeDaytonaWebhook({
      event: eventCase.eventType.toUpperCase(),
      id: eventCase.objectId,
      organization_id: "org-123",
      updated_at: "2026-06-12T10:00:00.000Z",
      state: "RUNNING",
    });

    assert.deepEqual(normalized, {
      provider: "daytona",
      eventType: eventCase.eventType,
      objectType: eventCase.objectType,
      objectId: eventCase.objectId,
      organizationId: "org-123",
      timestamp: "2026-06-12T10:00:00.000Z",
      state: "RUNNING",
      payload: {
        event: eventCase.eventType.toUpperCase(),
        id: eventCase.objectId,
        organization_id: "org-123",
        updated_at: "2026-06-12T10:00:00.000Z",
        state: "RUNNING",
      },
      fileEventType: eventCase.expectedFileEventType,
      shouldDelete: eventCase.expectedShouldDelete,
      path: eventCase.expectedPath,
    });
  });
}

test("normalizes object ids from provider-specific id fields", () => {
  assert.equal(
    normalizeDaytonaWebhook({
      event: "sandbox.created",
      sandboxId: "sandbox-from-field",
      organizationId: "org-123",
    })?.objectId,
    "sandbox-from-field",
  );
  assert.equal(
    normalizeDaytonaWebhook({
      event: "snapshot.created",
      snapshotId: "snapshot-from-field",
      organizationId: "org-123",
    })?.objectId,
    "snapshot-from-field",
  );
  assert.equal(
    normalizeDaytonaWebhook({
      event: "volume.created",
      volumeId: "volume-from-field",
      organizationId: "org-123",
    })?.objectId,
    "volume-from-field",
  );
});

test("normalizes object ids from nested records", () => {
  assert.equal(
    normalizeDaytonaWebhook({
      event: "sandbox.state.updated",
      sandbox: { id: "nested-sandbox" },
      organizationId: "org-123",
    })?.objectId,
    "nested-sandbox",
  );
  assert.equal(
    normalizeDaytonaWebhook({
      event: "snapshot.state.updated",
      snapshot: { id: "nested-snapshot" },
      organizationId: "org-123",
    })?.objectId,
    "nested-snapshot",
  );
  assert.equal(
    normalizeDaytonaWebhook({
      event: "volume.state.updated",
      volume: { id: "nested-volume" },
      organizationId: "org-123",
    })?.objectId,
    "nested-volume",
  );
});

test("extracts state across Daytona webhook field shapes", () => {
  const cases: Array<{ payload: Record<string, unknown>; expected: string }> = [
    { payload: { newState: "ERROR" }, expected: "ERROR" },
    { payload: { new_state: "BUILD_FAILED" }, expected: "BUILD_FAILED" },
    { payload: { state: "RUNNING" }, expected: "RUNNING" },
    { payload: { sandbox: { state: "STOPPED" } }, expected: "STOPPED" },
    { payload: { snapshot: { state: "PENDING" } }, expected: "PENDING" },
    { payload: { volume: { state: "AVAILABLE" } }, expected: "AVAILABLE" },
  ];

  for (const { payload, expected } of cases) {
    assert.equal(
      normalizeDaytonaWebhook({
        event: "sandbox.state.updated",
        id: "sandbox-123",
        organizationId: "org-123",
        ...payload,
      })?.state,
      expected,
    );
  }
});

test("extracts errorReason across Daytona webhook field shapes", () => {
  const cases: Array<{ payload: Record<string, unknown>; expected: string }> = [
    { payload: { errorReason: "top-level camel" }, expected: "top-level camel" },
    { payload: { error_reason: "top-level snake" }, expected: "top-level snake" },
    { payload: { sandbox: { errorReason: "nested camel" } }, expected: "nested camel" },
    { payload: { sandbox: { error_reason: "nested snake" } }, expected: "nested snake" },
    { payload: { snapshot: { errorReason: "snapshot failure" } }, expected: "snapshot failure" },
    { payload: { volume: { error_reason: "volume failure" } }, expected: "volume failure" },
  ];

  for (const { payload, expected } of cases) {
    assert.equal(
      normalizeDaytonaWebhook({
        event: "sandbox.state.updated",
        id: "sandbox-123",
        organizationId: "org-123",
        ...payload,
      })?.errorReason,
      expected,
    );
  }
});

test("returns null for unsupported events or incomplete webhook payloads", () => {
  assert.equal(normalizeDaytonaWebhook({ event: "workspace.created", id: "workspace-1" }), null);
  assert.equal(normalizeDaytonaWebhook({ event: "sandbox.created", organizationId: "org-123" }), null);
  assert.equal(normalizeDaytonaWebhook({ event: "sandbox.created", id: "sandbox-123" }), null);
  assert.equal(normalizeDaytonaWebhook("not-json"), null);
});
