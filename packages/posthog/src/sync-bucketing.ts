import {
  modelBucket,
  safeNormalize,
} from "@relayfile/adapter-core/sync-bucketing";

import { normalizeNangoPostHogModel } from "./path-mapper.js";

export const syncRecordBucketing = modelBucket({
  normalizeModel: safeNormalize(normalizeNangoPostHogModel),
  buckets: {
    project: "projects",
    insight: "insights",
    dashboard: "dashboards",
    "feature-flag": "featureFlags",
    annotation: "annotations",
    experiment: "experiments",
    survey: "surveys",
    "alert-event": "alertEvents",
  },
});
