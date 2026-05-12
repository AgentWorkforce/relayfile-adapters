import assert from "node:assert/strict";
import test from "node:test";

import { buildSummary } from "./summary.js";

const MAX_SUMMARY_JSON_LENGTH = 1024;

function assertSummaryWithinBudget(summary: unknown): void {
  const serialized = JSON.stringify(summary);
  assert.ok(
    serialized.length < MAX_SUMMARY_JSON_LENGTH,
    `expected summary JSON under ${MAX_SUMMARY_JSON_LENGTH} bytes, got ${serialized.length}`,
  );
}

test("buildSummary derives Slack actor and channel tags from message payloads", () => {
  const summary = buildSummary({
    text: "Customer escalation posted to ops",
    user: "U123",
    user_name: "relay-bot",
    channel: {
      id: "C456",
      name: "ops-alerts",
    },
    channel_type: "channel",
  });

  assert.deepEqual(summary, {
    title: "Customer escalation posted to ops",
    actor: {
      id: "U123",
      displayName: "relay-bot",
    },
    tags: ["channel:C456", "channel_name:ops-alerts", "channel_type:channel"],
  });
  assertSummaryWithinBudget(summary);
});

test("buildSummary truncates oversized Slack text under the 1 KB envelope budget", () => {
  const summary = buildSummary({
    text: `Escalation from jane@example.com ${"critical ".repeat(40)}call +1 (555) 123-4567 now`,
    user: "U999",
    user_name: "ops-bot",
    channel: {
      id: "C777",
      name: "sev-1-war-room",
    },
    channel_type: "channel",
  });

  assert.equal(summary.title?.length, 80);
  assert.equal(summary.title?.endsWith("..."), true);
  assert.match(summary.title ?? "", /\[redacted-email\]|\[redacted-number\]/);
  assertSummaryWithinBudget(summary);
});
