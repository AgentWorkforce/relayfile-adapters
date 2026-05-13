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

test("buildSummary derives Notion title, status, actor, and changed properties", () => {
  const summary = buildSummary({
    object: "page",
    parent: {
      type: "database_id",
      database_id: "db_123",
    },
    properties: {
      Name: {
        type: "title",
        title: [{ plain_text: "Launch proactive runtime" }],
      },
      Status: {
        type: "status",
        status: { name: "In Review" },
      },
      Area: {
        type: "multi_select",
        multi_select: [{ name: "Platform" }, { name: "Agents" }],
      },
    },
    changedProperties: ["Status", "Owner"],
    last_edited_by: {
      id: "usr_notion_1",
      name: "Grace Hopper",
    },
  });

  assert.deepEqual(summary, {
    title: "Launch proactive runtime",
    status: "In Review",
    labels: ["Platform", "Agents"],
    actor: {
      id: "usr_notion_1",
      displayName: "Grace Hopper",
    },
    fieldsChanged: ["Status", "Owner"],
    tags: ["object:page", "parent_type:database_id", "parent:db_123"],
  });
  assertSummaryWithinBudget(summary);
});

test("buildSummary caps oversized Notion summaries under the 1 KB envelope budget", () => {
  const summary = buildSummary({
    object: "page",
    parent: {
      type: "database_id",
      database_id: "db_999",
    },
    properties: {
      Name: {
        type: "title",
        title: [{ plain_text: "Launch ".repeat(40) }],
      },
      Status: {
        type: "status",
        status: { name: "In Progress" },
      },
      Area: {
        type: "multi_select",
        multi_select: Array.from({ length: 100 }, (_, index) => ({
          name: `Team ${index}`,
        })),
      },
    },
    changedProperties: Array.from({ length: 20 }, (_, index) => `Field ${index}`),
    last_edited_by: {
      id: "usr_notion_2",
      name: "Grace Hopper",
    },
  });

  assert.equal(summary.title?.length, 120);
  assert.equal(summary.title?.endsWith("..."), true);
  assert.equal(summary.labels?.length, 8);
  assert.equal(summary.fieldsChanged?.length, 12);
  assertSummaryWithinBudget(summary);
});
