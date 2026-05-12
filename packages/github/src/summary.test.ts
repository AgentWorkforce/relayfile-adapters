import assert from "node:assert/strict";
import test from "node:test";

import { buildSummary } from "./summary.js";

test("buildSummary derives GitHub pull request summary metadata", () => {
  assert.deepEqual(
    buildSummary({
      sender: {
        id: 42,
        login: "octocat",
      },
      repository: {
        full_name: "AgentWorkforce/relayfile",
      },
      changes: {
        title: {
          from: "Old title",
        },
      },
      pull_request: {
        title: "Ship relayfile watch fan-in",
        state: "open",
        draft: true,
        labels: [
          { name: "runtime" },
          { name: "urgent" },
        ],
      },
    }),
    {
      title: "Ship relayfile watch fan-in",
      status: "draft",
      labels: ["runtime", "urgent"],
      actor: {
        id: "42",
        displayName: "octocat",
      },
      fieldsChanged: ["title"],
      tags: ["kind:pull_request", "repo:AgentWorkforce/relayfile"],
    },
  );
});
