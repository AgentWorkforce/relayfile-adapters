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

test("buildSummary derives routing-safe metadata from a Linear issue payload", () => {
  const summary = buildSummary({
    title: "Ship proactive runtime summaries",
    description: "Stable description",
    state: { name: "In Progress" },
    priority: 1,
    labels: [
      { name: "ops" },
      { name: "urgent" },
    ],
    actionBy: {
      id: "usr_linear_1",
      name: "Ada Lovelace",
    },
    previousData: {
      title: "Old title",
      description: "Stable description",
    },
  });

  assert.deepEqual(summary, {
    title: "Ship proactive runtime summaries",
    status: "In Progress",
    priority: "urgent",
    labels: ["ops", "urgent"],
    actor: {
      id: "usr_linear_1",
      displayName: "Ada Lovelace",
    },
    fieldsChanged: ["title"],
    tags: ["state:In Progress", "priority:urgent"],
  });
  assertSummaryWithinBudget(summary);
});

test("buildSummary caps oversized Linear summaries under the 1 KB envelope budget", () => {
  const summary = buildSummary({
    title: "Escalation ".repeat(40),
    state: { name: "In Progress" },
    priority: 1,
    labels: Array.from({ length: 100 }, (_, index) => ({
      name: `label-${index}`,
    })),
    actionBy: {
      id: "usr_linear_2",
      name: "Ada Lovelace",
    },
    previousData: Object.fromEntries(
      Array.from({ length: 20 }, (_, index) => [
        `field_${index}`,
        `previous-${index}`,
      ]),
    ),
  });

  assert.equal(summary.title?.length, 120);
  assert.equal(summary.title?.endsWith("..."), true);
  assert.equal(summary.labels?.length, 8);
  assert.equal(summary.fieldsChanged?.length, 12);
  assertSummaryWithinBudget(summary);
});
