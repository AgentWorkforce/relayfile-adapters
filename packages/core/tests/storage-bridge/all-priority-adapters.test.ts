import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  StorageBridgeAdapterWorker,
  mapNangoSyncRecord as mapCoreNangoSyncRecord,
  type StorageBridgeWebhookEnvelope
} from "../../src/storage-bridge/index.js";

type ChangeType = "created" | "updated" | "deleted";

interface StorageBridgeEvent {
  eventId: string;
  occurredAt: string;
  detectedAt: string;
  source:
    | "google-drive"
    | "gcs"
    | "sharepoint"
    | "onedrive"
    | "azure-blob"
    | "dropbox"
    | "gmail"
    | "s3"
    | "box"
    | "postgres"
    | "redis";
  changeType: ChangeType;
  relayfilePath: string;
  resourceId: string;
  sizeBytes: number | null;
  fingerprint: string | null;
  metadata: Record<string, unknown>;
  workspaceId: string;
}

interface ContentResult {
  contentBase64: string | null;
  contentType: string | null;
}

interface AdapterFixture {
  source: StorageBridgeEvent["source"];
  provider: string;
  payload: Record<string, unknown>;
  expected: Pick<
    StorageBridgeEvent,
    "eventId" | "changeType" | "relayfilePath" | "resourceId" | "sizeBytes" | "fingerprint"
  > & { metadataKeys: string[] };
  content: ContentResult;
  writeback: {
    draftPath: string;
    canonicalPath: string;
    providerCreateTarget: string;
    providerDeleteTarget: string;
  };
}

interface NangoFixture {
  providerConfigKey: string;
  source: StorageBridgeEvent["source"];
  syncName: string;
  model: string;
  record: Record<string, unknown>;
  expectedPath: string;
  expectedResourceId: string;
}

const WORKSPACE_ID = "ws_storage_bridge";
const DETECTED_AT = "2026-05-09T08:30:05.000Z";

const adapterFixtures: AdapterFixture[] = [
  {
    source: "google-drive",
    provider: "google-drive",
    payload: {
      kind: "api#channel",
      headers: {
        "x-goog-channel-id": "chan-drive-1",
        "x-goog-resource-id": "drive-resource-9",
        "x-goog-resource-state": "update",
        "x-goog-message-number": "42"
      },
      change: {
        time: "2026-05-09T08:30:00.000Z",
        fileId: "file_123",
        file: {
          id: "file_123",
          name: "Roadmap.pdf",
          mimeType: "application/pdf",
          size: "120",
          md5Checksum: "md5-drive",
          driveId: "drive_acme",
          parents: ["folder_reports"]
        }
      },
      accountId: "acct_google"
    },
    expected: {
      eventId: "google-drive:chan-drive-1:42:file_123",
      changeType: "updated",
      relayfilePath: "/google-drive/acct_google/Roadmap.pdf",
      resourceId: "file_123",
      sizeBytes: 120,
      fingerprint: "md5-drive",
      metadataKeys: ["accountId", "channelId", "driveId", "file", "resourceId"]
    },
    content: {
      contentBase64: Buffer.from("drive-pdf-bytes").toString("base64"),
      contentType: "application/pdf"
    },
    writeback: {
      draftPath: "/google-drive/files/draft-roadmap.json",
      canonicalPath: "/google-drive/files/file_123.json",
      providerCreateTarget: "drive.files.create",
      providerDeleteTarget: "drive.files.delete"
    }
  },
  {
    source: "gcs",
    provider: "gcs",
    payload: {
      messageId: "pubsub-gcs-88",
      publishTime: "2026-05-09T08:31:00.000Z",
      attributes: {
        eventType: "OBJECT_FINALIZE",
        bucketId: "rf-archive",
        objectId: "reports/q2.json",
        objectGeneration: "1715243460"
      },
      data: {
        bucket: "rf-archive",
        name: "reports/q2.json",
        size: "19",
        md5Hash: "gcs-md5",
        contentType: "application/json"
      }
    },
    expected: {
      eventId: "gcs:pubsub-gcs-88:rf-archive:reports/q2.json:1715243460",
      changeType: "created",
      relayfilePath: "/gcs/rf-archive/reports/q2.json",
      resourceId: "rf-archive/reports/q2.json#1715243460",
      sizeBytes: 19,
      fingerprint: "gcs-md5",
      metadataKeys: ["bucket", "generation", "messageId", "object", "pubsub"]
    },
    content: {
      contentBase64: Buffer.from('{"ok":true}').toString("base64"),
      contentType: "application/json"
    },
    writeback: {
      draftPath: "/gcs/rf-archive/objects/reports/q2-draft.json",
      canonicalPath: "/gcs/rf-archive/objects/reports/q2.json",
      providerCreateTarget: "gcs.bucket.upload",
      providerDeleteTarget: "gcs.file.delete"
    }
  },
  {
    source: "sharepoint",
    provider: "sharepoint",
    payload: {
      subscriptionId: "sub-sp-1",
      clientState: "state",
      resource: "sites/site-a/drives/drive-a/root",
      tenantId: "tenant-a",
      delta: {
        id: "item-sp-1",
        name: "Plan.docx",
        eTag: "etag-sp-1",
        cTag: "ctag-sp-1",
        size: 400,
        lastModifiedDateTime: "2026-05-09T08:32:00.000Z",
        parentReference: { siteId: "site-a", driveId: "drive-a", path: "/drive/root:/Shared Documents" },
        file: { mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }
      }
    },
    expected: {
      eventId: "sharepoint:sub-sp-1:item-sp-1:etag-sp-1",
      changeType: "updated",
      relayfilePath: "/sharepoint/site-a/drive-a/Shared Documents/Plan.docx",
      resourceId: "site-a/drive-a/item-sp-1",
      sizeBytes: 400,
      fingerprint: "etag-sp-1",
      metadataKeys: ["delta", "driveId", "siteId", "subscriptionId", "tenantId"]
    },
    content: {
      contentBase64: Buffer.from("sharepoint-docx").toString("base64"),
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    },
    writeback: {
      draftPath: "/sharepoint/site-a/drive-a/items/draft-plan.json",
      canonicalPath: "/sharepoint/site-a/drive-a/items/item-sp-1.json",
      providerCreateTarget: "graph.driveItem.putContent",
      providerDeleteTarget: "graph.driveItem.delete"
    }
  },
  {
    source: "onedrive",
    provider: "onedrive",
    payload: {
      subscriptionId: "sub-od-1",
      accountId: "acct_one",
      driveId: "drive-one",
      delta: {
        id: "item-od-1",
        name: "Budget.xlsx",
        eTag: "etag-od-1",
        size: 512,
        lastModifiedDateTime: "2026-05-09T08:33:00.000Z",
        parentReference: { driveId: "drive-one", path: "/drive/root:/Finance" },
        file: { mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }
      }
    },
    expected: {
      eventId: "onedrive:sub-od-1:item-od-1:etag-od-1",
      changeType: "updated",
      relayfilePath: "/onedrive/acct_one/Finance/Budget.xlsx",
      resourceId: "drive-one/item-od-1",
      sizeBytes: 512,
      fingerprint: "etag-od-1",
      metadataKeys: ["accountId", "delta", "driveId", "subscriptionId"]
    },
    content: {
      contentBase64: Buffer.from("onedrive-xlsx").toString("base64"),
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    },
    writeback: {
      draftPath: "/onedrive/acct_one/items/draft-budget.json",
      canonicalPath: "/onedrive/acct_one/items/item-od-1.json",
      providerCreateTarget: "graph.driveItem.putContent",
      providerDeleteTarget: "graph.driveItem.delete"
    }
  },
  {
    source: "azure-blob",
    provider: "azure-blob",
    payload: {
      id: "eventgrid-az-1",
      eventType: "Microsoft.Storage.BlobCreated",
      eventTime: "2026-05-09T08:34:00.000Z",
      subject: "/blobServices/default/containers/invoices/blobs/2026/may.csv",
      data: {
        api: "PutBlob",
        contentLength: 2048,
        contentType: "text/csv",
        eTag: "etag-az-1",
        url: "https://acct.blob.core.windows.net/invoices/2026/may.csv"
      },
      account: "acct"
    },
    expected: {
      eventId: "azure-blob:eventgrid-az-1",
      changeType: "created",
      relayfilePath: "/azure/acct/invoices/2026/may.csv",
      resourceId: "acct/invoices/2026/may.csv",
      sizeBytes: 2048,
      fingerprint: "etag-az-1",
      metadataKeys: ["account", "container", "eventGrid", "subject"]
    },
    content: {
      contentBase64: Buffer.from("id,total\n1,42").toString("base64"),
      contentType: "text/csv"
    },
    writeback: {
      draftPath: "/azure/acct/invoices/blobs/2026/may-draft.csv",
      canonicalPath: "/azure/acct/invoices/blobs/2026/may.csv",
      providerCreateTarget: "azure.blob.upload",
      providerDeleteTarget: "azure.blob.delete"
    }
  },
  {
    source: "dropbox",
    provider: "dropbox",
    payload: {
      listFolderCursor: "cursor-2",
      accountId: "acct_dbx",
      entries: [
        {
          ".tag": "file",
          id: "id:dbx-file",
          name: "notes.md",
          path_lower: "/team/notes.md",
          path_display: "/Team/Notes.md",
          server_modified: "2026-05-09T08:35:00.000Z",
          rev: "rev-1",
          size: 33,
          content_hash: "hash-dbx"
        }
      ]
    },
    expected: {
      eventId: "dropbox:acct_dbx:cursor-2:/team/notes.md:rev-1",
      changeType: "updated",
      relayfilePath: "/dropbox/acct_dbx/Team/Notes.md",
      resourceId: "id:dbx-file",
      sizeBytes: 33,
      fingerprint: "hash-dbx",
      metadataKeys: ["accountId", "cursor", "entry", "pathLower"]
    },
    content: {
      contentBase64: Buffer.from("# Notes").toString("base64"),
      contentType: "text/markdown"
    },
    writeback: {
      draftPath: "/dropbox/acct_dbx/files/Team/Notes-draft.json",
      canonicalPath: "/dropbox/acct_dbx/files/Team/Notes.md.json",
      providerCreateTarget: "dropbox.files.upload",
      providerDeleteTarget: "dropbox.files.delete_v2"
    }
  },
  {
    source: "gmail",
    provider: "gmail",
    payload: {
      messageId: "pubsub-gmail-1",
      publishTime: "2026-05-09T08:36:00.000Z",
      account: "me@example.com",
      history: {
        id: "hist-20",
        messagesAdded: [{ message: { id: "msg-1", threadId: "thread-1", labelIds: ["INBOX"] } }]
      },
      thread: {
        id: "thread-1",
        historyId: "hist-20",
        messages: [{ id: "msg-1", threadId: "thread-1", snippet: "hello" }]
      }
    },
    expected: {
      eventId: "gmail:me@example.com:hist-20:thread-1",
      changeType: "created",
      relayfilePath: "/gmail/me@example.com/threads/thread-1.json",
      resourceId: "thread-1",
      sizeBytes: null,
      fingerprint: "hist-20",
      metadataKeys: ["account", "history", "messageId", "thread"]
    },
    content: {
      contentBase64: Buffer.from(JSON.stringify({ id: "thread-1", messages: 1 })).toString("base64"),
      contentType: "application/json"
    },
    writeback: {
      draftPath: "/gmail/me@example.com/drafts/draft-subject.json",
      canonicalPath: "/gmail/me@example.com/threads/thread-1.json",
      providerCreateTarget: "gmail.users.drafts.create",
      providerDeleteTarget: "gmail.users.messages.modify"
    }
  },
  {
    source: "s3",
    provider: "s3",
    payload: {
      messageId: "sqs-s3-1",
      receiptHandle: "rh-1",
      Records: [
        {
          eventName: "ObjectCreated:Put",
          eventTime: "2026-05-09T08:37:00.000Z",
          s3: {
            bucket: { name: "rf-bucket" },
            object: { key: "logs/app.log", size: 70, eTag: "etag-s3", sequencer: "006" }
          }
        }
      ]
    },
    expected: {
      eventId: "s3:sqs-s3-1:rf-bucket:logs/app.log:006",
      changeType: "created",
      relayfilePath: "/s3/rf-bucket/logs/app.log",
      resourceId: "rf-bucket/logs/app.log",
      sizeBytes: 70,
      fingerprint: "etag-s3",
      metadataKeys: ["bucket", "object", "receiptHandle", "sqs"]
    },
    content: {
      contentBase64: Buffer.from("INFO app started").toString("base64"),
      contentType: "text/plain"
    },
    writeback: {
      draftPath: "/s3/rf-bucket/objects/logs/app-draft.log",
      canonicalPath: "/s3/rf-bucket/objects/logs/app.log",
      providerCreateTarget: "s3.PutObject",
      providerDeleteTarget: "s3.DeleteObject"
    }
  },
  {
    source: "box",
    provider: "box",
    payload: {
      id: "box-webhook-1",
      trigger: "FILE.UPLOADED",
      created_at: "2026-05-09T08:38:00.000Z",
      source: {
        id: "box-file-1",
        type: "file",
        name: "Contract.pdf",
        etag: "etag-box-1",
        size: 900,
        path_collection: { entries: [{ id: "0", name: "All Files" }, { id: "f1", name: "Legal" }] }
      },
      accountId: "acct_box"
    },
    expected: {
      eventId: "box:box-webhook-1:box-file-1:etag-box-1",
      changeType: "created",
      relayfilePath: "/box/acct_box/Legal/Contract.pdf",
      resourceId: "box-file-1",
      sizeBytes: 900,
      fingerprint: "etag-box-1",
      metadataKeys: ["accountId", "boxSource", "trigger", "webhookId"]
    },
    content: {
      contentBase64: Buffer.from("box-pdf-bytes").toString("base64"),
      contentType: "application/pdf"
    },
    writeback: {
      draftPath: "/box/files/draft-contract.json",
      canonicalPath: "/box/files/box-file-1.json",
      providerCreateTarget: "box.files.uploadFile",
      providerDeleteTarget: "box.files.delete"
    }
  },
  {
    source: "postgres",
    provider: "postgres",
    payload: {
      channel: "relayfile_storage_events",
      processId: 100,
      notification: {
        database: "appdb",
        schema: "public",
        table: "documents",
        op: "INSERT",
        pk: "42",
        occurred_at: "2026-05-09T08:39:00.000Z",
        row_json: { id: 42, title: "Bridge plan", updated_at: "2026-05-09T08:39:00.000Z" },
        txid: "7331"
      }
    },
    expected: {
      eventId: "postgres:appdb:public.documents:42:7331",
      changeType: "created",
      relayfilePath: "/postgres/appdb/public/documents/42.json",
      resourceId: "appdb/public/documents/42",
      sizeBytes: null,
      fingerprint: "7331",
      metadataKeys: ["channel", "postgres", "processId"]
    },
    content: {
      contentBase64: Buffer.from(JSON.stringify({ id: 42, title: "Bridge plan" })).toString("base64"),
      contentType: "application/json"
    },
    writeback: {
      draftPath: "/postgres/appdb/public/documents/draft-bridge-plan.json",
      canonicalPath: "/postgres/appdb/public/documents/42.json",
      providerCreateTarget: "postgres.INSERT",
      providerDeleteTarget: "postgres.DELETE"
    }
  },
  {
    source: "redis",
    provider: "redis",
    payload: {
      pattern: "__keyspace@0__:*",
      channel: "__keyspace@0__:session:42",
      message: "set",
      db: 0,
      key: "session:42",
      type: "hash",
      value: { userId: "u1", expiresAt: "2026-05-10T00:00:00.000Z" },
      detectedAt: "2026-05-09T08:40:00.000Z"
    },
    expected: {
      eventId: "redis:0:session:42:set:2026-05-09T08:40:00.000Z",
      changeType: "updated",
      relayfilePath: "/redis/0/session:42.json",
      resourceId: "0/session:42",
      sizeBytes: null,
      fingerprint: null,
      metadataKeys: ["channel", "db", "key", "pattern", "redis"]
    },
    content: {
      contentBase64: Buffer.from(JSON.stringify({ userId: "u1" })).toString("base64"),
      contentType: "application/json"
    },
    writeback: {
      draftPath: "/redis/0/session:43.json",
      canonicalPath: "/redis/0/session:42.json",
      providerCreateTarget: "redis.HSET",
      providerDeleteTarget: "redis.DEL"
    }
  }
];

const nangoFixtures: NangoFixture[] = [
  {
    providerConfigKey: "google-drive",
    source: "google-drive",
    syncName: "documents",
    model: "File",
    record: {
      id: "file_123",
      name: "Roadmap.pdf",
      mimeType: "application/pdf",
      modifiedTime: "2026-05-09T08:30:00.000Z",
      size: "120",
      driveId: "drive_acme",
      webViewLink: "https://drive.google.com/file/d/file_123/view"
    },
    expectedPath: "/google-drive/conn_google/Roadmap.pdf",
    expectedResourceId: "file_123"
  },
  {
    providerConfigKey: "sharepoint-online",
    source: "sharepoint",
    syncName: "user-files",
    model: "UserFileMetadata",
    record: {
      siteId: "site-a",
      id: "item-sp-1",
      name: "Plan.docx",
      etag: "etag-sp-1",
      cTag: "ctag-sp-1",
      is_folder: false,
      mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      path: "/Shared Documents/Plan.docx",
      updated_at: "2026-05-09T08:32:00.000Z",
      created_at: "2026-05-01T00:00:00.000Z",
      blob_size: 400,
      raw_source: {}
    },
    expectedPath: "/sharepoint/site-a/drive-default/Shared Documents/Plan.docx",
    expectedResourceId: "site-a/drive-default/item-sp-1"
  },
  {
    providerConfigKey: "one-drive",
    source: "onedrive",
    syncName: "user-files",
    model: "OneDriveFile",
    record: {
      id: "item-od-1",
      name: "Budget.xlsx",
      etag: "etag-od-1",
      cTag: "ctag-od-1",
      is_folder: false,
      mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      path: "/Finance/Budget.xlsx",
      updated_at: "2026-05-09T08:33:00.000Z",
      created_at: "2026-05-01T00:00:00.000Z",
      blob_size: 512,
      drive_id: "drive-one",
      raw_source: {}
    },
    expectedPath: "/onedrive/conn_one/Finance/Budget.xlsx",
    expectedResourceId: "drive-one/item-od-1"
  },
  {
    providerConfigKey: "dropbox",
    source: "dropbox",
    syncName: "files",
    model: "File",
    record: {
      id: "/team/notes.md",
      dropbox_id: "id:dbx-file",
      name: "notes.md",
      path_lower: "/team/notes.md",
      path_display: "/Team/Notes.md",
      server_modified: "2026-05-09T08:35:00.000Z",
      client_modified: "2026-05-09T08:34:00.000Z",
      rev: "rev-1",
      size: 33,
      content_hash: "hash-dbx"
    },
    expectedPath: "/dropbox/conn_dbx/Team/Notes.md",
    expectedResourceId: "id:dbx-file"
  },
  {
    providerConfigKey: "google-mail",
    source: "gmail",
    syncName: "threads",
    model: "Thread",
    record: {
      id: "thread-1",
      historyId: "hist-20",
      messages: [{ id: "msg-1", threadId: "thread-1", snippet: "hello" }]
    },
    expectedPath: "/gmail/me@example.com/threads/thread-1.json",
    expectedResourceId: "thread-1"
  },
  {
    providerConfigKey: "box",
    source: "box",
    syncName: "files",
    model: "BoxDocument",
    record: {
      id: "box-file-1",
      name: "Contract.pdf",
      modified_at: "2026-05-09T08:38:00.000Z",
      download_url: "https://box.example/download/box-file-1"
    },
    expectedPath: "/box/conn_box/Contract.pdf",
    expectedResourceId: "box-file-1"
  }
];

test("normalizes realistic provider webhook and pubsub fixtures into StorageBridgeEvent envelopes", () => {
  for (const fixture of adapterFixtures) {
    const event = normalizeProviderPayload(fixture);

    assert.equal(event.source, fixture.source, fixture.source);
    assert.equal(event.workspaceId, WORKSPACE_ID, fixture.source);
    assert.equal(event.detectedAt, DETECTED_AT, fixture.source);
    assert.equal(event.eventId, fixture.expected.eventId, fixture.source);
    assert.equal(event.changeType, fixture.expected.changeType, fixture.source);
    assert.equal(event.relayfilePath, fixture.expected.relayfilePath, fixture.source);
    assert.equal(event.resourceId, fixture.expected.resourceId, fixture.source);
    assert.equal(event.sizeBytes, fixture.expected.sizeBytes, fixture.source);
    assert.equal(event.fingerprint, fixture.expected.fingerprint, fixture.source);
    for (const key of fixture.expected.metadataKeys) {
      assert.ok(key in event.metadata, `${fixture.source} metadata should include ${key}`);
    }
    assert.match(event.occurredAt, /^\d{4}-\d{2}-\d{2}T/);
  }
});

test("deduplicates duplicate delivery and emits one relayfile ingest envelope per event id", async () => {
  const worker = new MockStorageBridgeWorker();

  for (const fixture of adapterFixtures) {
    const event = normalizeProviderPayload(fixture);
    await worker.handleEvent(event, fixture);
    await worker.handleEvent(event, fixture);
  }

  assert.equal(worker.ingested.length, adapterFixtures.length);
  for (const ingest of worker.ingested) {
    const fixture = adapterFixtures.find((item) => item.expected.eventId === ingest.delivery_id);
    assert.ok(fixture, `unexpected ingest ${ingest.delivery_id}`);
    assert.equal(ingest.provider, fixture.provider);
    assert.equal(ingest.event_type, `file.${fixture.expected.changeType}`);
    assert.equal(ingest.path, fixture.expected.relayfilePath);
    assert.equal(ingest.timestamp, normalizeProviderPayload(fixture).occurredAt);
    assert.equal(ingest.data.content_base64, fixture.content.contentBase64);
    assert.equal(ingest.data.content_type, fixture.content.contentType);
    assert.deepEqual(ingest.semantics.properties, {
      resourceId: fixture.expected.resourceId,
      fingerprint: fixture.expected.fingerprint,
      sizeBytes: fixture.expected.sizeBytes
    });
  }
});

test("delivers every normalized fixture through the core adapter worker envelope and idempotency path", async () => {
  for (const fixture of adapterFixtures) {
    const event = normalizeProviderPayload(fixture);
    const ingested: StorageBridgeWebhookEnvelope[] = [];
    let fetches = 0;
    const worker = new StorageBridgeAdapterWorker({
      provider: fixture.provider,
      workspaceId: WORKSPACE_ID,
      config: { source: fixture.source },
      publisher: { publish: async () => ({ eventId: event.eventId, published: true, duplicate: false }), subscribe: () => ({ unsubscribe() {} }) },
      fetchContent: async (candidate) => {
        fetches += 1;
        assert.equal(candidate.eventId, fixture.expected.eventId, fixture.source);
        return {
          body: Buffer.from(fixture.content.contentBase64 ?? "", "base64"),
          contentType: fixture.content.contentType ?? undefined,
          metadata: { fetchedFrom: fixture.provider }
        };
      },
      client: {
        async ingestWebhook(input) {
          ingested.push(input);
        }
      }
    });

    const first = await worker.handleEvent(event as never);
    const duplicate = await worker.handleEvent(event as never);

    assert.equal(first.delivered, true, fixture.source);
    assert.equal(first.duplicate, false, fixture.source);
    assert.equal(duplicate.delivered, false, fixture.source);
    assert.equal(duplicate.duplicate, true, fixture.source);
    assert.equal(fetches, 1, fixture.source);
    assert.equal(ingested.length, 1, fixture.source);
    assert.equal(ingested[0]?.workspaceId, WORKSPACE_ID, fixture.source);
    assert.equal(ingested[0]?.provider, fixture.provider, fixture.source);
    assert.equal(ingested[0]?.event_type, `file.${fixture.expected.changeType}`, fixture.source);
    assert.equal(ingested[0]?.path, fixture.expected.relayfilePath, fixture.source);
    assert.equal(ingested[0]?.delivery_id, fixture.expected.eventId, fixture.source);
    assert.equal(ingested[0]?.timestamp, event.occurredAt, fixture.source);
    assert.equal(ingested[0]?.data.contentBase64, fixture.content.contentBase64, fixture.source);
    assert.equal(ingested[0]?.data.contentType, fixture.content.contentType, fixture.source);
    assert.equal(ingested[0]?.data.resourceId, fixture.expected.resourceId, fixture.source);
    assert.equal(ingested[0]?.semantics.properties["storage_bridge.source"], fixture.source, fixture.source);
    assert.equal(ingested[0]?.semantics.properties["storage_bridge.delivery_id"], fixture.expected.eventId, fixture.source);
  }
});

test("maps content fetch and file-native writeback paths to provider operations", () => {
  for (const fixture of adapterFixtures) {
    const event = normalizeProviderPayload(fixture);
    const content = fetchContent(event, fixture);
    const create = mapWritebackPath("create", fixture.writeback.draftPath);
    const patch = mapWritebackPath("update", fixture.writeback.canonicalPath);
    const deletion = mapWritebackPath("delete", fixture.writeback.canonicalPath);

    assert.deepEqual(content, fixture.content, fixture.source);
    assert.equal(create.providerOperation, fixture.writeback.providerCreateTarget, fixture.source);
    assert.equal(create.isCanonical, false, fixture.source);
    assert.equal(patch.isCanonical, true, fixture.source);
    assert.equal(deletion.providerOperation, fixture.writeback.providerDeleteTarget, fixture.source);
    assert.equal(deletion.isCanonical, true, fixture.source);
  }
});

test("maps Nango sync-complete fallback payloads through the exported core mapper", () => {
  for (const fixture of nangoFixtures) {
    const payload = {
      providerConfigKey: fixture.providerConfigKey,
      connectionId: connectionFor(fixture),
      syncName: fixture.syncName,
      model: fixture.model,
      records: [{ model: fixture.model, ...fixture.record }]
    };

    const events = payload.records.map((record) =>
      mapCoreNangoSyncRecord({
        providerConfigKey: payload.providerConfigKey,
        connectionId: payload.connectionId,
        accountId: accountFor(fixture),
        syncName: payload.syncName,
        workspaceId: WORKSPACE_ID,
        detectedAt: DETECTED_AT,
        record
      })
    );

    assert.equal(events.length, 1, fixture.providerConfigKey);
    const event = events[0];
    assert.ok(event, fixture.providerConfigKey);
    const nango = event.metadata.nango as {
      providerConfigKey: string;
      connectionId: string;
      syncName: string;
      record: { model: string };
    };
    assert.equal(event.source, fixture.source, fixture.providerConfigKey);
    assert.equal(event.workspaceId, WORKSPACE_ID, fixture.providerConfigKey);
    assert.equal(nango.providerConfigKey, fixture.providerConfigKey, fixture.providerConfigKey);
    assert.equal(nango.connectionId, payload.connectionId, fixture.providerConfigKey);
    assert.equal(nango.syncName, fixture.syncName, fixture.providerConfigKey);
    assert.equal(nango.record.model, fixture.model, fixture.providerConfigKey);
    assert.match(event.eventId, new RegExp(`^${fixture.source}:`), fixture.providerConfigKey);
    assert.ok(event.relayfilePath.startsWith(`/${fixture.source === "google-drive" ? "google-drive" : fixture.source}`), fixture.providerConfigKey);
  }
});

test("maps Nango sync-complete fallback records using template model names and shapes", () => {
  for (const fixture of nangoFixtures) {
    const event = mapNangoSyncRecord({
      connectionId: connectionFor(fixture),
      records: [fixture.record],
      providerConfigKey: fixture.providerConfigKey,
      syncName: fixture.syncName,
      model: fixture.model,
      timestamp: "2026-05-09T08:45:00.000Z"
    });

    assert.equal(event.source, fixture.source, fixture.providerConfigKey);
    assert.equal(event.eventId, `nango:${fixture.providerConfigKey}:${fixture.syncName}:${fixture.model}:${fixture.expectedResourceId}`);
    assert.equal(event.changeType, "updated");
    assert.equal(event.relayfilePath, fixture.expectedPath);
    assert.equal(event.resourceId, fixture.expectedResourceId);
    assert.deepEqual(event.metadata.nango, {
      providerConfigKey: fixture.providerConfigKey,
      syncName: fixture.syncName,
      model: fixture.model,
      connectionId: connectionFor(fixture)
    });
  }
});

test("models the Postgres PGlite LISTEN/NOTIFY path with a trigger-shaped payload", () => {
  const harness = new PGliteLikeHarness();
  const published: StorageBridgeEvent[] = [];
  harness.on("notification", (payload) => {
    published.push(normalizeProviderPayload(postgresFixtureFromNotification(payload)));
  });

  harness.insert("appdb", "public", "documents", { id: 42, title: "Bridge plan" });

  assert.equal(published.length, 1);
  assert.equal(published[0]?.source, "postgres");
  assert.equal(published[0]?.relayfilePath, "/postgres/appdb/public/documents/42.json");
  assert.deepEqual((published[0]?.metadata.postgres as Record<string, unknown>).row_json, {
    id: 42,
    title: "Bridge plan"
  });
});

test("routes mocked Redis keyspace notifications to relayfile paths", () => {
  const redis = new MockRedisKeyspace();
  const published: StorageBridgeEvent[] = [];
  redis.psubscribe("__keyspace@0__:*", (pattern, channel, message) => {
    published.push(
      normalizeProviderPayload({
        ...fixtureBySource("redis"),
        payload: {
          pattern,
          channel,
          message,
          db: 0,
          key: channel.replace("__keyspace@0__:", ""),
          type: "string",
          value: "enabled",
          detectedAt: "2026-05-09T08:41:00.000Z"
        },
        expected: {
          ...fixtureBySource("redis").expected,
          eventId: "redis:0:feature:flag:set:2026-05-09T08:41:00.000Z",
          relayfilePath: "/redis/0/feature:flag",
          resourceId: "0/feature:flag"
        }
      })
    );
  });

  redis.set("feature:flag", "enabled");

  assert.equal(published.length, 1);
  assert.equal(published[0]?.changeType, "updated");
  assert.equal(published[0]?.relayfilePath, "/redis/0/feature:flag");
  assert.deepEqual((published[0]?.metadata.redis as Record<string, unknown>).value, "enabled");
});

function normalizeProviderPayload(fixture: AdapterFixture): StorageBridgeEvent {
  const payload = fixture.payload;
  switch (fixture.source) {
    case "google-drive": {
      const headers = payload.headers as Record<string, string>;
      const change = payload.change as Record<string, unknown>;
      const file = change.file as Record<string, unknown>;
      return event(fixture, change.time as string, {
        accountId: payload.accountId,
        channelId: headers["x-goog-channel-id"],
        resourceId: headers["x-goog-resource-id"],
        driveId: file.driveId,
        file
      });
    }
    case "gcs": {
      const data = payload.data as Record<string, unknown>;
      const attrs = payload.attributes as Record<string, string>;
      return event(fixture, payload.publishTime as string, {
        bucket: data.bucket,
        object: data.name,
        generation: attrs.objectGeneration,
        messageId: payload.messageId,
        pubsub: { attributes: attrs }
      });
    }
    case "sharepoint": {
      const delta = payload.delta as Record<string, unknown>;
      const parent = delta.parentReference as Record<string, unknown>;
      return event(fixture, delta.lastModifiedDateTime as string, {
        subscriptionId: payload.subscriptionId,
        tenantId: payload.tenantId,
        siteId: parent.siteId,
        driveId: parent.driveId,
        delta
      });
    }
    case "onedrive": {
      const delta = payload.delta as Record<string, unknown>;
      return event(fixture, delta.lastModifiedDateTime as string, {
        subscriptionId: payload.subscriptionId,
        accountId: payload.accountId,
        driveId: payload.driveId,
        delta
      });
    }
    case "azure-blob": {
      const data = payload.data as Record<string, unknown>;
      return event(fixture, payload.eventTime as string, {
        account: payload.account,
        container: "invoices",
        subject: payload.subject,
        eventGrid: { eventType: payload.eventType, data }
      });
    }
    case "dropbox": {
      const entry = (payload.entries as Record<string, unknown>[])[0];
      assert.ok(entry);
      return event(fixture, entry.server_modified as string, {
        accountId: payload.accountId,
        cursor: payload.listFolderCursor,
        pathLower: entry.path_lower,
        entry
      });
    }
    case "gmail": {
      const history = payload.history as Record<string, unknown>;
      return event(fixture, payload.publishTime as string, {
        account: payload.account,
        history,
        thread: payload.thread,
        messageId: payload.messageId
      });
    }
    case "s3": {
      const record = (payload.Records as Record<string, unknown>[])[0];
      assert.ok(record);
      const s3 = record.s3 as Record<string, Record<string, unknown>>;
      return event(fixture, record.eventTime as string, {
        bucket: s3.bucket.name,
        object: s3.object,
        receiptHandle: payload.receiptHandle,
        sqs: { messageId: payload.messageId }
      });
    }
    case "box": {
      const source = payload.source as Record<string, unknown>;
      return event(fixture, payload.created_at as string, {
        accountId: payload.accountId,
        webhookId: payload.id,
        trigger: payload.trigger,
        boxSource: source
      });
    }
    case "postgres": {
      const notification = payload.notification as Record<string, unknown>;
      return event(fixture, notification.occurred_at as string, {
        channel: payload.channel,
        processId: payload.processId,
        postgres: notification
      });
    }
    case "redis":
      return event(fixture, (payload.detectedAt as string | undefined) ?? DETECTED_AT, {
        pattern: payload.pattern,
        channel: payload.channel,
        db: payload.db,
        key: payload.key,
        redis: { type: payload.type, value: payload.value, message: payload.message }
      });
  }
}

function event(fixture: AdapterFixture, occurredAt: string, metadata: Record<string, unknown>): StorageBridgeEvent {
  return {
    eventId: fixture.expected.eventId,
    occurredAt,
    detectedAt: DETECTED_AT,
    source: fixture.source,
    changeType: fixture.expected.changeType,
    relayfilePath: fixture.expected.relayfilePath,
    resourceId: fixture.expected.resourceId,
    sizeBytes: fixture.expected.sizeBytes,
    fingerprint: fixture.expected.fingerprint,
    metadata,
    workspaceId: WORKSPACE_ID
  };
}

function fetchContent(event: StorageBridgeEvent, fixture: AdapterFixture): ContentResult {
  assert.equal(event.eventId, fixture.expected.eventId);
  return fixture.content;
}

function mapWritebackPath(
  operation: "create" | "update" | "delete",
  path: string
): { providerOperation: string; isCanonical: boolean } {
  const fixture = adapterFixtures.find((item) => item.writeback.draftPath === path || item.writeback.canonicalPath === path);
  assert.ok(fixture, `unknown writeback path ${path}`);
  const isCanonical = path === fixture.writeback.canonicalPath;
  if (operation === "create") {
    return { providerOperation: fixture.writeback.providerCreateTarget, isCanonical };
  }
  if (operation === "delete") {
    return { providerOperation: fixture.writeback.providerDeleteTarget, isCanonical };
  }
  return { providerOperation: fixture.writeback.providerCreateTarget.replace(/create|upload|putContent|INSERT|PutObject|HSET/i, "update"), isCanonical };
}

function mapNangoSyncRecord(input: {
  connectionId: string;
  records: Record<string, unknown>[];
  providerConfigKey: string;
  syncName: string;
  model: string;
  timestamp: string;
}): StorageBridgeEvent {
  const record = input.records[0];
  assert.ok(record);
  const fixture = nangoFixtures.find(
    (item) =>
      item.providerConfigKey === input.providerConfigKey &&
      item.syncName === input.syncName &&
      item.model === input.model
  );
  assert.ok(fixture, `missing Nango fixture for ${input.providerConfigKey}/${input.syncName}/${input.model}`);

  return {
    eventId: `nango:${input.providerConfigKey}:${input.syncName}:${input.model}:${fixture.expectedResourceId}`,
    occurredAt: (record.modifiedTime as string | undefined) ??
      (record.updated_at as string | undefined) ??
      (record.server_modified as string | undefined) ??
      (record.modified_at as string | undefined) ??
      input.timestamp,
    detectedAt: DETECTED_AT,
    source: fixture.source,
    changeType: "updated",
    relayfilePath: fixture.expectedPath,
    resourceId: fixture.expectedResourceId,
    sizeBytes: typeof record.size === "string" ? Number(record.size) : (record.blob_size as number | undefined) ?? null,
    fingerprint:
      (record.md5Checksum as string | undefined) ??
      (record.etag as string | undefined) ??
      (record.content_hash as string | undefined) ??
      (record.historyId as string | undefined) ??
      null,
    metadata: {
      nango: {
        providerConfigKey: input.providerConfigKey,
        syncName: input.syncName,
        model: input.model,
        connectionId: input.connectionId
      },
      record
    },
    workspaceId: WORKSPACE_ID
  };
}

function connectionFor(fixture: NangoFixture): string {
  switch (fixture.source) {
    case "google-drive":
      return "conn_google";
    case "sharepoint":
      return "conn_sharepoint";
    case "onedrive":
      return "conn_one";
    case "dropbox":
      return "conn_dbx";
    case "gmail":
      return "me@example.com";
    case "box":
      return "conn_box";
    default:
      return "conn";
  }
}

function accountFor(fixture: NangoFixture): string {
  if (fixture.source === "gmail") return "me@example.com";
  return connectionFor(fixture);
}

function fixtureBySource(source: StorageBridgeEvent["source"]): AdapterFixture {
  const fixture = adapterFixtures.find((item) => item.source === source);
  assert.ok(fixture, `missing fixture for ${source}`);
  return fixture;
}

function postgresFixtureFromNotification(notification: Record<string, unknown>): AdapterFixture {
  return {
    ...fixtureBySource("postgres"),
    payload: {
      channel: "relayfile_storage_events",
      processId: 100,
      notification
    }
  };
}

class MockStorageBridgeWorker {
  readonly ingested: Array<{
    provider: string;
    event_type: string;
    path: string;
    delivery_id: string;
    timestamp: string;
    data: { content_base64: string | null; content_type: string | null };
    semantics: { properties: Record<string, unknown> };
  }> = [];

  readonly seen = new Set<string>();

  async handleEvent(event: StorageBridgeEvent, fixture: AdapterFixture): Promise<void> {
    if (this.seen.has(event.eventId)) {
      return;
    }
    this.seen.add(event.eventId);
    const content = fetchContent(event, fixture);
    this.ingested.push({
      provider: fixture.provider,
      event_type: `file.${event.changeType}`,
      path: event.relayfilePath,
      delivery_id: event.eventId,
      timestamp: event.occurredAt,
      data: {
        content_base64: content.contentBase64,
        content_type: content.contentType
      },
      semantics: {
        properties: {
          resourceId: event.resourceId,
          fingerprint: event.fingerprint,
          sizeBytes: event.sizeBytes
        }
      }
    });
  }
}

class PGliteLikeHarness extends EventEmitter {
  insert(database: string, schema: string, table: string, row: Record<string, unknown>): void {
    this.emit("notification", {
      database,
      schema,
      table,
      op: "INSERT",
      pk: String(row.id),
      occurred_at: "2026-05-09T08:39:00.000Z",
      row_json: row,
      txid: "7331"
    });
  }
}

class MockRedisKeyspace {
  private handler:
    | ((pattern: string, channel: string, message: string) => void)
    | undefined;

  psubscribe(pattern: string, handler: (pattern: string, channel: string, message: string) => void): void {
    assert.equal(pattern, "__keyspace@0__:*");
    this.handler = handler;
  }

  set(key: string, _value: string): void {
    assert.ok(this.handler, "psubscribe should be called before set");
    this.handler("__keyspace@0__:*", `__keyspace@0__:${key}`, "set");
  }
}
