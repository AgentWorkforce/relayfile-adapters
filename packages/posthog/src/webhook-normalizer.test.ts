import assert from "node:assert/strict";
import test from "node:test";

import { normalizePostHogWebhook } from "./webhook-normalizer.js";

test("normalizes numeric PostHog ids and derives resolved trigger semantics", () => {
  const normalized = normalizePostHogWebhook({
    id: 42,
    project_id: 17,
    title: "Checkout errors above threshold",
    state: "resolved",
    source: "untrusted-source",
    occurred_at: "2026-07-25T08:33:00.000Z",
  });

  assert.ok(normalized);
  assert.equal(normalized.objectId, "42");
  assert.equal(normalized.projectId, "17");
  assert.equal(normalized.eventType, "posthog.alert.resolved");
  assert.equal(normalized.fileEventType, "file.updated");
  assert.equal(normalized.shouldDelete, false);
  assert.equal(
    normalized.path,
    "/posthog/projects/17/alert-events/checkout-errors-above-threshold__42.json",
  );
  assert.deepEqual(
    {
      id: normalized.record.id,
      project_id: normalized.record.project_id,
      source: normalized.record.source,
      state: normalized.record.state,
      event_type: normalized.record.event_type,
    },
    {
      id: "42",
      project_id: "17",
      source: "posthog",
      state: "resolved",
      event_type: "posthog.alert.resolved",
    },
  );
});

test("explicit upstream event type remains authoritative", () => {
  const normalized = normalizePostHogWebhook({
    alert_id: "alert-1",
    projectId: "project-1",
    status: "resolved",
    event_type: "posthog.alert.triggered",
  });

  assert.ok(normalized);
  assert.equal(normalized.eventType, "posthog.alert.triggered");
  assert.equal(normalized.state, "resolved");
  assert.equal(normalized.record.state, "resolved");
  assert.equal(normalized.record.event_type, "posthog.alert.triggered");
  assert.equal(normalized.fileEventType, "file.updated");
  assert.equal(normalized.shouldDelete, false);
});

test("rejects missing and non-finite identifiers", () => {
  assert.equal(
    normalizePostHogWebhook({ id: "alert-1", state: "triggered" }),
    null,
  );
  assert.equal(
    normalizePostHogWebhook({
      id: Number.NaN,
      project_id: 17,
      state: "triggered",
    }),
    null,
  );
});
