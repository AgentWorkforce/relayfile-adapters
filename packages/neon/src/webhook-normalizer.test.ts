import assert from "node:assert/strict";
import test from "node:test";

import { normalizeNeonSyncDelta } from "./webhook-normalizer.js";

test("normalizeNeonSyncDelta emits the frozen Neon delta contract", () => {
  const events = [
    ...normalizeNeonSyncDelta("NeonOperation", [
      {
        id: "op-failed",
        status: "failed",
        _nango_metadata: {
          last_action: "ADDED",
          first_seen_at: "2026-06-18T09:00:00.000Z",
          cursor: "cur-1",
        },
      },
      {
        id: "op-cancelled",
        status: "cancelled",
        _nango_metadata: {
          last_action: "ADDED",
          first_seen_at: "2026-06-18T09:05:00.000Z",
        },
      },
      {
        id: "op-finished",
        status: "finished",
        _nango_metadata: {
          last_action: "UPDATED",
          last_modified_at: "2026-06-18T09:10:00.000Z",
          previous: { status: "running" },
        },
      },
    ]),
    ...normalizeNeonSyncDelta("NeonEndpoint", [
      {
        id: "ep-1",
        current_state: "active",
        _nango_metadata: {
          last_action: "UPDATED",
          last_modified_at: "2026-06-18T09:15:00.000Z",
          changed_fields: ["current_state"],
        },
      },
    ]),
    ...normalizeNeonSyncDelta("NeonAdvisorIssue", [
      {
        id: "raw-advisor-id",
        cache_key: "advisor-cache-key",
        project_id: "proj-1",
        level: "warning",
        _nango_metadata: {
          last_action: "ADDED",
          first_seen_at: "2026-06-18T09:20:00.000Z",
        },
      },
    ]),
  ];

  assert.deepEqual(
    events.map((event) => ({
      eventType: event.eventType,
      objectType: event.objectType,
      objectId: event.objectId,
      path: event.path,
      occurredAt: event.occurredAt,
      action: event.metadata.action,
    })),
    [
      {
        eventType: "operation.failed",
        objectType: "operation",
        objectId: "op-failed",
        path: "/neon/operations/op-failed.json",
        occurredAt: "2026-06-18T09:00:00.000Z",
        action: "ADDED",
      },
      {
        eventType: "operation.cancelled",
        objectType: "operation",
        objectId: "op-cancelled",
        path: "/neon/operations/op-cancelled.json",
        occurredAt: "2026-06-18T09:05:00.000Z",
        action: "ADDED",
      },
      {
        eventType: "operation.succeeded",
        objectType: "operation",
        objectId: "op-finished",
        path: "/neon/operations/op-finished.json",
        occurredAt: "2026-06-18T09:10:00.000Z",
        action: "UPDATED",
      },
      {
        eventType: "endpoint.state_changed",
        objectType: "endpoint",
        objectId: "ep-1",
        path: "/neon/endpoints/ep-1.json",
        occurredAt: "2026-06-18T09:15:00.000Z",
        action: "UPDATED",
      },
      {
        eventType: "advisor.issue_raised",
        objectType: "advisor-issue",
        objectId: "advisor-cache-key",
        path: "/neon/advisors/advisor-cache-key.json",
        occurredAt: "2026-06-18T09:20:00.000Z",
        action: "ADDED",
      },
    ],
  );
  assert.equal(events[0]?.metadata.cursor, "cur-1");
  assert.equal(events[4]?.payload.id, "raw-advisor-id");
});

test("normalizeNeonSyncDelta suppresses plain final snapshots without transition evidence", () => {
  assert.deepEqual(
    normalizeNeonSyncDelta("NeonOperation", [
      {
        id: "op-finished",
        status: "finished",
        _nango_metadata: {
          last_action: "UPDATED",
          last_modified_at: "2026-06-18T09:10:00.000Z",
        },
      },
    ]),
    [],
  );
  assert.deepEqual(
    normalizeNeonSyncDelta("NeonEndpoint", [
      {
        id: "ep-1",
        current_state: "active",
        _nango_metadata: {
          last_action: "UPDATED",
          last_modified_at: "2026-06-18T09:15:00.000Z",
        },
      },
    ]),
    [],
  );
});

test("normalizeNeonSyncDelta accepts workflow-boundary transition evidence", () => {
  const [operationEvent] = normalizeNeonSyncDelta("NeonOperation", [
    {
      id: "op-finished",
      status: "finished",
      _nango_metadata: {
        last_action: "updated",
        last_modified_at: "2026-06-18T09:10:00.000Z",
      },
      _relayfile_transition: {
        previous: { status: "running" },
        current: { status: "finished" },
        changedFields: ["status"],
      },
    },
  ]);
  const [endpointEvent] = normalizeNeonSyncDelta("NeonEndpoint", [
    {
      id: "ep-1",
      current_state: "idle",
      _nango_metadata: {
        last_action: "UPDATED",
        last_modified_at: "2026-06-18T09:15:00.000Z",
      },
      _relayfile_transition: {
        previous: { current_state: "active" },
        current: { current_state: "idle" },
        changedFields: ["current_state"],
      },
    },
  ]);

  assert.equal(operationEvent?.eventType, "operation.succeeded");
  assert.equal(endpointEvent?.eventType, "endpoint.state_changed");
  assert.equal("_relayfile_transition" in (operationEvent?.payload ?? {}), false);
  assert.equal("_nango_metadata" in (operationEvent?.payload ?? {}), false);
});

test("normalizeNeonSyncDelta drops records without required Nango metadata or stable ids", () => {
  assert.deepEqual(
    normalizeNeonSyncDelta("NeonOperation", [
      {
        id: "op-failed",
        status: "failed",
        _nango_metadata: {
          first_seen_at: "2026-06-18T09:00:00.000Z",
        },
      },
      {
        status: "failed",
        _nango_metadata: {
          last_action: "ADDED",
          first_seen_at: "2026-06-18T09:00:00.000Z",
        },
      },
    ]),
    [],
  );
});

test("normalizeNeonSyncDelta case-normalizes last_action and accepts changedFields aliases", () => {
  const [event] = normalizeNeonSyncDelta("NeonOperation", [
    {
      id: "op-finished",
      status: "finished",
      _nango_metadata: {
        last_action: "updated",
        updatedAt: "2026-06-18T09:10:00.000Z",
        changedFields: ["status"],
      },
    },
  ]);

  assert.equal(event?.eventType, "operation.succeeded");
  assert.equal(event?.metadata.action, "UPDATED");
});
