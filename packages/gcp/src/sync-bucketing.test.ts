import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { syncRecordBucketing } from "./sync-bucketing.js";

describe("gcp sync record bucketing", () => {
  it("routes Nango models to GCP auxiliary emitter bucket names", () => {
    assert.deepEqual(
      syncRecordBucketing.bucketRecords([{ id: "svc-1", serviceName: "api" }], "GcpCloudRunService"),
      {
        cloudRunServices: [{ id: "svc-1", serviceName: "api" }],
      },
    );
    assert.deepEqual(
      syncRecordBucketing.bucketRecords([{ id: "policy-1" }], "GcpMonitoringAlert"),
      {
        monitoringAlerts: [{ id: "policy-1" }],
      },
    );
    assert.deepEqual(
      syncRecordBucketing.bucketRecords([{ id: "current" }], "GcpBilling"),
      {
        billing: [{ id: "current" }],
      },
    );
    assert.deepEqual(
      syncRecordBucketing.bucketRecords([{ id: "group-1" }], "GcpErrorGroup"),
      {
        errorGroups: [{ id: "group-1" }],
      },
    );
  });

  it("maps deleted Nango records to tombstones", () => {
    assert.deepEqual(
      syncRecordBucketing.bucketRecords(
        [
          {
            id: "svc-1",
            serviceName: "api",
            _nango_metadata: { last_action: "deleted" },
          },
        ],
        "GcpCloudRunService",
      ),
      {
        cloudRunServices: [{ id: "svc-1", _deleted: true }],
      },
    );
  });
});
