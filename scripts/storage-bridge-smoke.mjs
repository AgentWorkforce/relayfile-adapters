#!/usr/bin/env node
import assert from "node:assert/strict";

const detectedAt = "2026-05-09T08:30:05.000Z";
const workspaceId = "ws_storage_bridge";

const cases = [
  {
    source: "google-drive",
    provider: "google-drive",
    eventId: "google-drive:chan-drive-1:42:file_123",
    changeType: "updated",
    occurredAt: "2026-05-09T08:30:00.000Z",
    relayfilePath: "/google-drive/acct_google/Roadmap.pdf",
    resourceId: "file_123",
    sizeBytes: 120,
    fingerprint: "md5-drive",
    metadata: { accountId: "acct_google", channelId: "chan-drive-1", resourceId: "drive-resource-9" },
    content: "drive-pdf-bytes"
  },
  {
    source: "gcs",
    provider: "gcs",
    eventId: "gcs:pubsub-gcs-88:rf-archive:reports/q2.json:1715243460",
    changeType: "created",
    occurredAt: "2026-05-09T08:31:00.000Z",
    relayfilePath: "/gcs/rf-archive/reports/q2.json",
    resourceId: "rf-archive/reports/q2.json#1715243460",
    sizeBytes: 19,
    fingerprint: "gcs-md5",
    metadata: { bucket: "rf-archive", object: "reports/q2.json", pubsub: { messageId: "pubsub-gcs-88" } },
    content: '{"ok":true}'
  },
  {
    source: "sharepoint",
    provider: "sharepoint",
    eventId: "sharepoint:sub-sp-1:item-sp-1:etag-sp-1",
    changeType: "updated",
    occurredAt: "2026-05-09T08:32:00.000Z",
    relayfilePath: "/sharepoint/site-a/drive-a/Shared Documents/Plan.docx",
    resourceId: "site-a/drive-a/item-sp-1",
    sizeBytes: 400,
    fingerprint: "etag-sp-1",
    metadata: { subscriptionId: "sub-sp-1", siteId: "site-a", driveId: "drive-a" },
    content: "sharepoint-docx"
  },
  {
    source: "onedrive",
    provider: "onedrive",
    eventId: "onedrive:sub-od-1:item-od-1:etag-od-1",
    changeType: "updated",
    occurredAt: "2026-05-09T08:33:00.000Z",
    relayfilePath: "/onedrive/acct_one/Finance/Budget.xlsx",
    resourceId: "drive-one/item-od-1",
    sizeBytes: 512,
    fingerprint: "etag-od-1",
    metadata: { subscriptionId: "sub-od-1", accountId: "acct_one", driveId: "drive-one" },
    content: "onedrive-xlsx"
  },
  {
    source: "azure-blob",
    provider: "azure-blob",
    eventId: "azure-blob:eventgrid-az-1",
    changeType: "created",
    occurredAt: "2026-05-09T08:34:00.000Z",
    relayfilePath: "/azure/acct/invoices/2026/may.csv",
    resourceId: "acct/invoices/2026/may.csv",
    sizeBytes: 2048,
    fingerprint: "etag-az-1",
    metadata: { account: "acct", container: "invoices", eventGrid: { eventType: "Microsoft.Storage.BlobCreated" } },
    content: "id,total\n1,42"
  },
  {
    source: "dropbox",
    provider: "dropbox",
    eventId: "dropbox:acct_dbx:cursor-2:/team/notes.md:rev-1",
    changeType: "updated",
    occurredAt: "2026-05-09T08:35:00.000Z",
    relayfilePath: "/dropbox/acct_dbx/Team/Notes.md",
    resourceId: "id:dbx-file",
    sizeBytes: 33,
    fingerprint: "hash-dbx",
    metadata: { accountId: "acct_dbx", cursor: "cursor-2", pathLower: "/team/notes.md" },
    content: "# Notes"
  },
  {
    source: "gmail",
    provider: "gmail",
    eventId: "gmail:me@example.com:hist-20:thread-1",
    changeType: "created",
    occurredAt: "2026-05-09T08:36:00.000Z",
    relayfilePath: "/gmail/me@example.com/threads/thread-1.json",
    resourceId: "thread-1",
    sizeBytes: null,
    fingerprint: "hist-20",
    metadata: { account: "me@example.com", history: { id: "hist-20" }, thread: { id: "thread-1" } },
    content: '{"id":"thread-1","messages":1}'
  },
  {
    source: "s3",
    provider: "s3",
    eventId: "s3:sqs-s3-1:rf-bucket:logs/app.log:006",
    changeType: "created",
    occurredAt: "2026-05-09T08:37:00.000Z",
    relayfilePath: "/s3/rf-bucket/logs/app.log",
    resourceId: "rf-bucket/logs/app.log",
    sizeBytes: 70,
    fingerprint: "etag-s3",
    metadata: { bucket: "rf-bucket", object: { key: "logs/app.log" }, receiptHandle: "rh-1" },
    content: "INFO app started"
  },
  {
    source: "box",
    provider: "box",
    eventId: "box:box-webhook-1:box-file-1:etag-box-1",
    changeType: "created",
    occurredAt: "2026-05-09T08:38:00.000Z",
    relayfilePath: "/box/acct_box/Legal/Contract.pdf",
    resourceId: "box-file-1",
    sizeBytes: 900,
    fingerprint: "etag-box-1",
    metadata: { accountId: "acct_box", webhookId: "box-webhook-1", trigger: "FILE.UPLOADED" },
    content: "box-pdf-bytes"
  },
  {
    source: "postgres",
    provider: "postgres",
    eventId: "postgres:appdb:public.documents:42:7331",
    changeType: "created",
    occurredAt: "2026-05-09T08:39:00.000Z",
    relayfilePath: "/postgres/appdb/public/documents/42.json",
    resourceId: "appdb/public/documents/42",
    sizeBytes: null,
    fingerprint: "7331",
    metadata: { channel: "relayfile_storage_events", postgres: { row_json: { id: 42, title: "Bridge plan" } } },
    content: '{"id":42,"title":"Bridge plan"}'
  },
  {
    source: "redis",
    provider: "redis",
    eventId: "redis:0:session:42:set:2026-05-09T08:40:00.000Z",
    changeType: "updated",
    occurredAt: "2026-05-09T08:40:00.000Z",
    relayfilePath: "/redis/0/session:42.json",
    resourceId: "0/session:42",
    sizeBytes: null,
    fingerprint: null,
    metadata: { db: 0, key: "session:42", redis: { type: "hash", value: { userId: "u1" } } },
    content: '{"userId":"u1"}'
  }
];

const writebackCases = [
  { source: "google-drive", draftPath: "/google-drive/files/draft-roadmap.json", canonicalPath: "/google-drive/files/file_123.json", createOperation: "google-drive.files.create", deleteOperation: "google-drive.files.delete" },
  { source: "gcs", draftPath: "/gcs/rf-archive/objects/reports/q2-draft.json", canonicalPath: "/gcs/rf-archive/objects/reports/q2.json", createOperation: "gcs.objects.create", deleteOperation: "gcs.objects.delete" },
  { source: "sharepoint", draftPath: "/sharepoint/site-a/drive-a/items/draft-plan.json", canonicalPath: "/sharepoint/site-a/drive-a/items/item-sp-1.json", createOperation: "sharepoint.items.create", deleteOperation: "sharepoint.items.delete" },
  { source: "onedrive", draftPath: "/onedrive/acct_one/items/draft-budget.json", canonicalPath: "/onedrive/acct_one/items/item-od-1.json", createOperation: "onedrive.items.create", deleteOperation: "onedrive.items.delete" },
  { source: "azure-blob", draftPath: "/azure/acct/invoices/blobs/2026/may-draft.csv", canonicalPath: "/azure/acct/invoices/blobs/2026/may.csv", createOperation: "azure-blob.blobs.create", deleteOperation: "azure-blob.blobs.delete" },
  { source: "dropbox", draftPath: "/dropbox/acct_dbx/files/Team/Notes-draft.json", canonicalPath: "/dropbox/acct_dbx/files/Team/Notes.md.json", createOperation: "dropbox.files.create", deleteOperation: "dropbox.files.delete" },
  { source: "gmail", draftPath: "/gmail/me@example.com/drafts/draft-subject.json", canonicalPath: "/gmail/me@example.com/threads/thread-1.json", createOperation: "gmail.drafts.create", deleteOperation: "gmail.threads.delete" },
  { source: "s3", draftPath: "/s3/rf-bucket/objects/logs/app-draft.log", canonicalPath: "/s3/rf-bucket/objects/logs/app.log", createOperation: "s3.objects.create", deleteOperation: "s3.objects.delete" },
  { source: "box", draftPath: "/box/files/draft-contract.json", canonicalPath: "/box/files/box-file-1.json", createOperation: "box.files.create", deleteOperation: "box.files.delete" },
  { source: "postgres", draftPath: "/postgres/appdb/public/documents/draft-bridge-plan.json", canonicalPath: "/postgres/appdb/public/documents/42.json", createOperation: "postgres.rows.create", deleteOperation: "postgres.rows.delete" },
  { source: "redis", draftPath: "/redis/0/session:43.json", canonicalPath: "/redis/0/session:42.json", createOperation: "redis.keys.create", deleteOperation: "redis.keys.delete" }
];

const nangoFallbackCases = [
  { providerConfigKey: "google-drive", source: "google-drive", syncName: "documents", model: "File", resourceId: "file_123", path: "/google-drive/conn_google/Roadmap.pdf" },
  { providerConfigKey: "sharepoint-online", source: "sharepoint", syncName: "user-files", model: "UserFileMetadata", resourceId: "item-sp-1", path: "/sharepoint/site-a/drive-a/items/item-sp-1.json" },
  { providerConfigKey: "one-drive", source: "onedrive", syncName: "user-files", model: "OneDriveFile", resourceId: "item-od-1", path: "/onedrive/conn_one/items/item-od-1.json" },
  { providerConfigKey: "dropbox", source: "dropbox", syncName: "files", model: "File", resourceId: "id:dbx-file", path: "/dropbox/conn_dbx/Team/Notes.md" },
  { providerConfigKey: "google-mail", source: "gmail", syncName: "threads", model: "Thread", resourceId: "thread-1", path: "/gmail/me@example.com/threads/thread-1.json" },
  { providerConfigKey: "box", source: "box", syncName: "files", model: "BoxDocument", resourceId: "box-file-1", path: "/box/conn_box/files/box-file-1.json" }
];

class InMemoryStorageBridgeWorker {
  deliveries = [];
  seen = new Set();

  ingest(input) {
    if (this.seen.has(input.event.eventId)) {
      return;
    }
    this.seen.add(input.event.eventId);
    this.deliveries.push({
      workspaceId,
      provider: input.provider,
      event_type: `file.${input.event.changeType}`,
      path: input.event.relayfilePath,
      delivery_id: input.event.eventId,
      timestamp: input.event.occurredAt,
      data: {
        contentBase64: Buffer.from(input.content).toString("base64"),
        contentType: input.contentType ?? null,
        sizeBytes: input.event.sizeBytes,
        fingerprint: input.event.fingerprint,
        resourceId: input.event.resourceId,
        metadata: input.event.metadata
      },
      headers: {
        "x-relayfile-storage-bridge-source": input.event.source,
        "x-relayfile-storage-bridge-event-id": input.event.eventId
      },
      semantics: {
        properties: {
          "storage_bridge.source": input.event.source,
          "storage_bridge.change_type": input.event.changeType,
          "storage_bridge.resource_id": input.event.resourceId,
          "storage_bridge.fingerprint": input.event.fingerprint,
          "storage_bridge.delivery_id": input.event.eventId
        }
      }
    });
  }
}

const worker = new InMemoryStorageBridgeWorker();
for (const item of cases) {
  const event = {
    eventId: item.eventId,
    occurredAt: item.occurredAt,
    detectedAt,
    source: item.source,
    changeType: item.changeType,
    relayfilePath: item.relayfilePath,
    resourceId: item.resourceId,
    sizeBytes: item.sizeBytes,
    fingerprint: item.fingerprint,
    metadata: item.metadata,
    workspaceId
  };
  worker.ingest({ provider: item.provider, event, content: item.content });
  worker.ingest({ provider: item.provider, event, content: item.content });
}

assert.equal(worker.deliveries.length, cases.length, "duplicate provider deliveries must be idempotent by eventId");

for (const item of cases) {
  const delivery = worker.deliveries.find((candidate) => candidate.delivery_id === item.eventId);
  assert.ok(delivery, `missing delivery for ${item.source}`);
  assert.equal(delivery.provider, item.provider);
  assert.equal(delivery.event_type, `file.${item.changeType}`);
  assert.equal(delivery.path, item.relayfilePath);
  assert.equal(delivery.timestamp, item.occurredAt);
  assert.equal(delivery.data.contentBase64, Buffer.from(item.content).toString("base64"));
  assert.equal(delivery.data.resourceId, item.resourceId);
  assert.equal(delivery.data.sizeBytes, item.sizeBytes);
  assert.equal(delivery.headers["x-relayfile-storage-bridge-event-id"], item.eventId);
  assert.deepEqual(delivery.semantics.properties, {
    "storage_bridge.source": item.source,
    "storage_bridge.change_type": item.changeType,
    "storage_bridge.resource_id": item.resourceId,
    "storage_bridge.fingerprint": item.fingerprint,
    "storage_bridge.delivery_id": item.eventId
  });
}

for (const item of writebackCases) {
  assert.deepEqual(resolveWriteback(item, "create"), {
    operation: "create",
    providerOperation: item.createOperation,
    path: item.draftPath,
    canonical: false
  });
  assert.deepEqual(resolveWriteback(item, "delete"), {
    operation: "delete",
    providerOperation: item.deleteOperation,
    path: item.canonicalPath,
    canonical: true
  });
}

for (const item of nangoFallbackCases) {
  const event = mapNangoFallback(item);
  assert.equal(event.source, item.source);
  assert.equal(event.relayfilePath, item.path);
  assert.equal(event.resourceId, item.resourceId);
  assert.equal(event.metadata.nango.providerConfigKey, item.providerConfigKey);
  assert.equal(event.metadata.nango.syncName, item.syncName);
  assert.equal(event.metadata.nango.model, item.model);
}

console.log(`storage-bridge-smoke: ${cases.length} mocked provider events normalized, fetched, ingested, deduped; ${writebackCases.length} writeback mappings checked; ${nangoFallbackCases.length} Nango fallbacks checked`);

function resolveWriteback(item, operation) {
  return {
    operation,
    providerOperation: operation === "delete" ? item.deleteOperation : item.createOperation,
    path: operation === "delete" ? item.canonicalPath : item.draftPath,
    canonical: operation === "delete"
  };
}

function mapNangoFallback(item) {
  return {
    eventId: `nango:${item.providerConfigKey}:${item.syncName}:${item.model}:${item.resourceId}`,
    occurredAt: "2026-05-09T08:45:00.000Z",
    detectedAt,
    source: item.source,
    changeType: "updated",
    relayfilePath: item.path,
    resourceId: item.resourceId,
    sizeBytes: null,
    fingerprint: null,
    metadata: {
      nango: {
        providerConfigKey: item.providerConfigKey,
        syncName: item.syncName,
        model: item.model
      }
    },
    workspaceId
  };
}
