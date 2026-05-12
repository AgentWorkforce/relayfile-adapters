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

test("buildSummary derives Jira issue metadata and changed fields", () => {
  const summary = buildSummary({
    issue: {
      key: "RUNTIME-42",
      fields: {
        summary: "Fix proactive runtime replay",
        status: { name: "In Progress" },
        priority: { name: "Highest" },
        labels: ["runtime", "pager"],
        issuetype: { name: "Bug" },
        reporter: {
          accountId: "jira-user-1",
          displayName: "Linus Torvalds",
        },
      },
    },
    changelog: {
      items: [
        { field: "status" },
        { field: "priority" },
      ],
    },
  });

  assert.deepEqual(summary, {
    title: "Fix proactive runtime replay",
    status: "In Progress",
    priority: "Highest",
    labels: ["runtime", "pager"],
    actor: {
      id: "jira-user-1",
      displayName: "Linus Torvalds",
    },
    fieldsChanged: ["status", "priority"],
    tags: ["issue_type:Bug", "project:RUNTIME"],
  });
  assertSummaryWithinBudget(summary);
});

test("buildSummary caps oversized Jira summaries under the 1 KB envelope budget", () => {
  const summary = buildSummary({
    issue: {
      key: "OPS-99",
      fields: {
        summary: "Escalation ".repeat(40),
        status: { name: "In Progress" },
        priority: { name: "Highest" },
        labels: Array.from({ length: 100 }, (_, index) => `label-${index}`),
        issuetype: { name: "Incident" },
        reporter: {
          accountId: "jira-user-2",
          displayName: "Linus Torvalds",
        },
      },
    },
    changelog: {
      items: Array.from({ length: 20 }, (_, index) => ({
        field: `field-${index}`,
      })),
    },
  });

  assert.equal(summary.title?.length, 120);
  assert.equal(summary.title?.endsWith("..."), true);
  assert.equal(summary.labels?.length, 8);
  assert.equal(summary.fieldsChanged?.length, 12);
  assertSummaryWithinBudget(summary);
});
