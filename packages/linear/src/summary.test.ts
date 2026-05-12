import assert from "node:assert/strict";
import test from "node:test";

import { buildSummary } from "./summary.js";

test("buildSummary derives routing-safe metadata from a Linear issue payload", () => {
  assert.deepEqual(
    buildSummary({
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
    }),
    {
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
    },
  );
});
