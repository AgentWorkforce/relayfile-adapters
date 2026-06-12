import assert from "node:assert/strict";
import test from "node:test";

import { normalizeRecallWebhook } from "./webhook-normalizer.js";

test("normalizes Recall recording webhooks to recording canonical paths", () => {
  const normalized = normalizeRecallWebhook(
    {
      event: "recording.created",
      id: "rec_123",
      title: "Demo call",
      updated_at: "2026-06-11T12:00:00.000Z",
    },
    { "x-relay-connection-id": "conn_1" },
  );

  assert.deepEqual(normalized, {
    provider: "recall",
    eventType: "recording.created",
    objectType: "recording",
    objectId: "rec_123",
    path: "/recall/recordings/rec_123.json",
    connectionId: "conn_1",
    payload: {
      event: "recording.created",
      id: "rec_123",
      object: "recording",
      source_object_type: "recording",
      title: "Demo call",
      updated_at: "2026-06-11T12:00:00.000Z",
    },
  });
});

test("normalizes Recall transcript webhooks onto the same recording with transcript_text", () => {
  const normalized = normalizeRecallWebhook({
    event: "transcript.done",
    recording_id: "rec_456",
    transcript: [
      { speaker: "A", text: "Hello" },
      { speaker: "B", text: "World" },
    ],
  });

  assert.equal(normalized.objectType, "transcript");
  assert.equal(normalized.objectId, "rec_456");
  assert.equal(normalized.path, "/recall/recordings/rec_456.json");
  assert.equal(normalized.payload.id, "rec_456");
  assert.equal(normalized.payload.transcript_text, "Hello\nWorld");
});
