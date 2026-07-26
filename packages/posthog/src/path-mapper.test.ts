import assert from "node:assert/strict";
import test from "node:test";

import {
  computePostHogPath,
  parsePostHogPath,
  posthogDashboardByNameAliasPath,
  posthogExperimentByNameAliasPath,
  posthogProjectByNameAliasPath,
  posthogSurveyByNameAliasPath,
} from "./path-mapper.js";
import type { PostHogPathObjectType } from "./types.js";

const scopedCases = [
  ["insight", "Checkout conversion", "141"],
  ["dashboard", "Checkout funnel", "73"],
  ["feature-flag", "Checkout V2", "9"],
  ["annotation", "Release shipped", "55"],
  ["experiment", "Checkout CTA color", "22"],
  ["survey", "Checkout feedback", "survey-1"],
  ["alert-event", "Checkout errors", "alert-1"],
] as const satisfies readonly [
  Exclude<PostHogPathObjectType, "project">,
  string,
  string,
][];

test("canonical PostHog paths compose and parse with slug-and-id filenames", () => {
  for (const [objectType, displayName, objectId] of scopedCases) {
    const path = computePostHogPath(objectType, objectId, {
      projectId: "17",
      displayName,
    });
    assert.match(path, /\/[a-z0-9-]+__[^/]+\.json$/u);
    assert.deepEqual(parsePostHogPath(path), {
      objectType,
      objectId,
      projectId: "17",
    });
  }

  const projectPath = computePostHogPath("project", "17");
  assert.equal(projectPath, "/posthog/projects/17.json");
  assert.deepEqual(parsePostHogPath(projectPath), {
    objectType: "project",
    objectId: "17",
  });
});

test("parser retains compatibility with legacy bare-id paths", () => {
  assert.deepEqual(
    parsePostHogPath("/posthog/projects/17/dashboards/73.json"),
    {
      objectType: "dashboard",
      objectId: "73",
      projectId: "17",
    },
  );
});

test("named aliases use deterministic collision suffixes", () => {
  const helpers = [
    (id: string) => posthogProjectByNameAliasPath("Revenue", id),
    (id: string) =>
      posthogDashboardByNameAliasPath("17", "Revenue", id),
    (id: string) =>
      posthogExperimentByNameAliasPath("17", "Revenue", id),
    (id: string) => posthogSurveyByNameAliasPath("17", "Revenue", id),
  ];

  for (const helper of helpers) {
    const first = helper("1");
    const repeated = helper("1");
    const collision = helper("2");
    assert.equal(first, repeated);
    assert.notEqual(first, collision);
    assert.match(first, /\/by-name\/revenue-[a-f0-9]{8}__1\.json$/u);
  }
});

test("project-scoped paths require a project id", () => {
  assert.throws(
    () => computePostHogPath("dashboard", "73"),
    /requires projectId/u,
  );
});
