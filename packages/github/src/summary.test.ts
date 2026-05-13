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

test("buildSummary derives GitHub pull request summary metadata", () => {
  const summary = buildSummary({
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
  });

  assert.deepEqual(summary, {
    title: "Ship relayfile watch fan-in",
    status: "draft",
    labels: ["runtime", "urgent"],
    actor: {
      id: "42",
      displayName: "octocat",
    },
    fieldsChanged: ["title"],
    tags: ["kind:pull_request", "repo:AgentWorkforce/relayfile"],
  });
  assertSummaryWithinBudget(summary);
});

test("buildSummary caps oversized GitHub summaries under the 1 KB envelope budget", () => {
  const summary = buildSummary({
    sender: {
      id: 7,
      login: "maintainer",
    },
    repository: {
      full_name: "AgentWorkforce/cloud",
    },
    changes: Object.fromEntries(
      Array.from({ length: 20 }, (_, index) => [
        `field_${index}`,
        { from: `value-${index}` },
      ]),
    ),
    pull_request: {
      title: "Runtime ".repeat(40),
      state: "open",
      labels: Array.from({ length: 100 }, (_, index) => ({
        name: `label-${index}`,
      })),
    },
  });

  assert.equal(summary.title?.length, 120);
  assert.equal(summary.title?.endsWith("..."), true);
  assert.equal(summary.labels?.length, 8);
  assert.equal(summary.fieldsChanged?.length, 12);
  assertSummaryWithinBudget(summary);
});
