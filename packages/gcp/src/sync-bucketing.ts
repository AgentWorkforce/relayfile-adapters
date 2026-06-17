import { modelBucket, safeNormalize } from "@relayfile/adapter-core/sync-bucketing";

import { normalizeNangoGcpModel } from "./path-mapper.js";

export const syncRecordBucketing = modelBucket({
  normalizeModel: safeNormalize(normalizeNangoGcpModel),
  buckets: {
    "cloud-run-service": "cloudRunServices",
    "monitoring-alert": "monitoringAlerts",
    billing: "billing",
    "error-group": "errorGroups",
  },
});
