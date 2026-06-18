import { modelBucket, safeNormalize } from "@relayfile/adapter-core/sync-bucketing";

import { normalizeNangoCloudflareModel } from "./path-mapper.js";

export const syncRecordBucketing = modelBucket({
  normalizeModel: safeNormalize(normalizeNangoCloudflareModel),
  buckets: {
    "worker-script": "workerScripts",
    "worker-usage": "workerUsage",
    "pages-project": "pagesProjects",
    "d1-database": "d1Databases",
    "kv-namespace": "kvNamespaces",
    "r2-bucket": "r2Buckets",
    queue: "queues",
    tunnel: "tunnels",
    zone: "zones",
    "dns-record": "dnsRecords",
    "notification-webhook": "notificationWebhooks",
    "notification-policy": "notificationPolicies",
    "notification-event": "notificationEvents",
  },
});
