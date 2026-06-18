import assert from "node:assert/strict";
import test from "node:test";

import {
  computeNeonPath,
  neonAdvisorIssueByNameAliasPath,
  neonOperationByStatusAliasPath,
  neonProjectByOrgAliasPath,
  neonProjectConsumptionByMetricAliasPath,
  normalizeNangoNeonModel,
} from "./path-mapper.js";

test("normalizeNangoNeonModel maps sync models to resource object types", () => {
  assert.equal(normalizeNangoNeonModel("NeonProject"), "project");
  assert.equal(normalizeNangoNeonModel("NeonBranchConsumption"), "branch-consumption");
  assert.equal(normalizeNangoNeonModel("NeonAdvisorIssue"), "advisor-issue");
  assert.equal(normalizeNangoNeonModel("unknown"), null);
});

test("computeNeonPath produces canonical record paths", () => {
  assert.equal(computeNeonPath("project", "proj-1"), "/neon/projects/proj-1.json");
  assert.equal(computeNeonPath("operation", "op-1"), "/neon/operations/op-1.json");
  assert.equal(
    computeNeonPath("project-consumption", "proj-1__compute_unit_seconds__2026-06-17T00:00:00Z"),
    "/neon/consumption/projects/proj-1__compute_unit_seconds__2026-06-17T00%3A00%3A00Z.json",
  );
});

test("neon aliases encode grouping dimensions deterministically", () => {
  assert.equal(
    neonProjectByOrgAliasPath("org-demo", "proj-1"),
    "/neon/projects/by-org/org-demo/proj-1.json",
  );
  assert.equal(
    neonOperationByStatusAliasPath("failed", "op-1"),
    "/neon/operations/by-status/failed/op-1.json",
  );
  assert.equal(
    neonProjectConsumptionByMetricAliasPath("compute_unit_seconds", "rec-1"),
    "/neon/consumption/projects/by-metric/compute-unit-seconds/rec-1.json",
  );
  assert.match(
    neonAdvisorIssueByNameAliasPath("RLS Disabled in Public", "issue-1"),
    /^\/neon\/advisors\/by-name\/rls-disabled-in-public-[a-z0-9]+__issue-1\.json$/u,
  );
});
