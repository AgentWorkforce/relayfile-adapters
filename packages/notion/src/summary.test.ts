import assert from "node:assert/strict";
import test from "node:test";

import { buildSummary } from "./summary.js";

test("buildSummary derives Notion title, status, actor, and changed properties", () => {
  assert.deepEqual(
    buildSummary({
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
      },
      changedProperties: ["Status", "Owner"],
      last_edited_by: {
        id: "usr_notion_1",
        name: "Grace Hopper",
      },
    }),
    {
      title: "Launch proactive runtime",
      status: "In Review",
      actor: {
        id: "usr_notion_1",
        displayName: "Grace Hopper",
      },
      fieldsChanged: ["Status", "Owner"],
      tags: ["object:page", "parent_type:database_id", "parent:db_123"],
    },
  );
});
