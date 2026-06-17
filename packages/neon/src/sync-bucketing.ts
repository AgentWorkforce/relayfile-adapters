import { modelBucket, safeNormalize } from "@relayfile/adapter-core/sync-bucketing";

import { normalizeNangoNeonModel } from "./path-mapper.js";

export const syncRecordBucketing = modelBucket({
  normalizeModel: safeNormalize(normalizeNangoNeonModel),
  buckets: {
    organization: "organizations",
    project: "projects",
    branch: "branches",
    endpoint: "endpoints",
    operation: "operations",
    "project-consumption": "projectConsumption",
    "branch-consumption": "branchConsumption",
    "spending-limit": "spendingLimits",
    "advisor-issue": "advisorIssues",
  },
});
