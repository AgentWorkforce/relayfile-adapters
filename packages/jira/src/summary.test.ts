import assert from "node:assert/strict";
import test from "node:test";

import { buildSummary } from "./summary.js";

test("buildSummary derives Jira issue metadata and changed fields", () => {
  assert.deepEqual(
    buildSummary({
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
    }),
    {
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
    },
  );
});
