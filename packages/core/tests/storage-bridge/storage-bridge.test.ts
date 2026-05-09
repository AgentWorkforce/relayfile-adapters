import test from "node:test";
import assert from "node:assert/strict";
import {
  InMemoryStorageBridgeEventPublisher,
  StorageBridgeAdapterWorker,
  assertReadOnlyFieldsRejected,
  buildStorageBridgeWebhookEnvelope,
  createStorageBridgeEvent,
  dispatchStorageBridgeWriteback,
  mapNangoSyncRecord,
  parseStorageBridgeWriteback,
  type AdapterResourceConfig,
  type JsonSchemaObject,
  type ParsedStorageBridgeWriteback,
  type StorageBridgeEventForSource,
} from "../../src/storage-bridge/index.js";

test("StorageBridgeEvent factory validates and enriches source metadata", () => {
  const event = createStorageBridgeEvent({
    source: "s3",
    changeType: "created",
    relayfilePath: "/s3/acme-bucket/reports/q1.csv",
    resourceId: "acme-bucket/reports/q1.csv",
    occurredAt: "2026-05-09T08:00:00.000Z",
    sizeBytes: 7,
    fingerprint: "etag-1",
    workspaceId: "ws_123",
    sourceMetadata: {
      accountId: "aws-prod",
      nativeEventId: "evt_123",
    },
  });

  assert.equal(event.source, "s3");
  assert.equal(event.changeType, "created");
  assert.match(event.eventId, /^s3:/);
  assert.deepEqual(event.metadata.source, {
    source: "s3",
    accountId: "aws-prod",
    nativeEventId: "evt_123",
  });

  const s3Event = event as StorageBridgeEventForSource<"s3">;
  assert.equal(s3Event.source, "s3");
});

test("InMemoryStorageBridgeEventPublisher deduplicates by eventId", async () => {
  const publisher = new InMemoryStorageBridgeEventPublisher();
  const received: string[] = [];
  publisher.subscribe((event) => {
    received.push(event.eventId);
  });
  const event = createStorageBridgeEvent({
    eventId: "evt_1",
    source: "gcs",
    changeType: "updated",
    relayfilePath: "/gcs/bucket/file.txt",
    resourceId: "bucket/file.txt",
  });

  assert.deepEqual(await publisher.publish(event), {
    eventId: "evt_1",
    published: true,
    duplicate: false,
  });
  assert.deepEqual(await publisher.publish(event), {
    eventId: "evt_1",
    published: false,
    duplicate: true,
  });
  assert.deepEqual(received, ["evt_1"]);
});

test("StorageBridgeAdapterWorker fetches content, retries ingest, and emits webhook envelope", async () => {
  const ingested: unknown[] = [];
  let attempts = 0;
  const worker = new StorageBridgeAdapterWorker({
    provider: "dropbox",
    workspaceId: "ws_123",
    config: { accountId: "acct_1" },
    publisher: new InMemoryStorageBridgeEventPublisher(),
    sleep: async () => {},
    retryPolicy: { maxAttempts: 2, baseDelayMs: 1 },
    fetchContent: async () => ({
      body: "hello",
      contentType: "text/plain",
      metadata: { provider: "dropbox" },
    }),
    client: {
      async ingestWebhook(input) {
        attempts += 1;
        if (attempts === 1) throw new Error("temporary failure");
        ingested.push(input);
      },
    },
  });
  const event = createStorageBridgeEvent({
    eventId: "evt_dropbox_1",
    source: "dropbox",
    changeType: "updated",
    relayfilePath: "/dropbox/acct_1/files/hello.txt",
    resourceId: "/hello.txt",
    workspaceId: "ws_123",
  });

  const result = await worker.handleEvent(event);

  assert.equal(result.delivered, true);
  assert.equal(result.attempts, 2);
  assert.equal(ingested.length, 1);
  assert.deepEqual(result.envelope?.data, {
    contentBase64: Buffer.from("hello").toString("base64"),
    contentType: "text/plain",
    sizeBytes: null,
    fingerprint: null,
    resourceId: "/hello.txt",
    metadata: { provider: "dropbox" },
  });
});

test("buildStorageBridgeWebhookEnvelope maps deletes without fetching content", () => {
  const event = createStorageBridgeEvent({
    eventId: "evt_deleted",
    source: "postgres",
    changeType: "deleted",
    relayfilePath: "/postgres/main/public/widgets/42.json",
    resourceId: "main.public.widgets.42",
  });

  const envelope = buildStorageBridgeWebhookEnvelope({ event, workspaceId: "ws_123" });

  assert.equal(envelope.event_type, "file.deleted");
  assert.equal(envelope.delivery_id, "evt_deleted");
  assert.equal(envelope.data.contentBase64, null);
});

test("mapNangoSyncRecord covers google-mail fallback records", () => {
  const event = mapNangoSyncRecord({
    providerConfigKey: "google-mail",
    connectionId: "conn_123",
    accountId: "me",
    workspaceId: "ws_123",
    record: {
      id: "msg_1",
      threadId: "thr_1",
      updatedAt: "2026-05-09T10:00:00.000Z",
    },
  });

  assert.equal(event.source, "gmail");
  assert.equal(event.relayfilePath, "/gmail/me/threads/thr_1.json");
  assert.equal(event.resourceId, "msg_1");
});

test("storage bridge writeback dispatches file-native create, update, and delete", async () => {
  const resources: readonly AdapterResourceConfig[] = [
    {
      name: "objects",
      path: "/s3/acme/objects",
      pathPattern: /^\/s3\/acme\/objects(?:\/[^/]+)?$/,
      idPattern: /^obj_[a-z0-9]+$/,
      schema: "objects.schema.json",
      createExample: "objects.create.example.json",
    },
  ];
  const calls: string[] = [];
  const handlers = {
    create(input: ParsedStorageBridgeWriteback) {
      calls.push(`create:${input.id}`);
      return { created: "obj_abc", path: "/s3/acme/objects/obj_abc.json" };
    },
    update(input: ParsedStorageBridgeWriteback) {
      calls.push(`update:${input.id}`);
      return { ok: true };
    },
    delete(input: ParsedStorageBridgeWriteback) {
      calls.push(`delete:${input.id}`);
      return { ok: true };
    },
  };

  const created = await dispatchStorageBridgeWriteback(
    {
      workspaceId: "ws_123",
      path: "/s3/acme/objects/draft-report.json",
      content: { key: "reports/q1.csv" },
    },
    {
      resources,
      handlers,
    },
  );

  await dispatchStorageBridgeWriteback(
    {
      workspaceId: "ws_123",
      path: "/s3/acme/objects/obj_abc.json",
      content: { key: "reports/q2.csv" },
    },
    {
      resources,
      handlers,
    },
  );

  await dispatchStorageBridgeWriteback(
    {
      workspaceId: "ws_123",
      path: "/s3/acme/objects/obj_abc.json",
      method: "DELETE",
    },
    {
      resources,
      handlers,
    },
  );

  assert.deepEqual(created, {
    created: "obj_abc",
    path: "/s3/acme/objects/obj_abc.json",
  });
  assert.deepEqual(calls, [
    "create:draft-report",
    "update:obj_abc",
    "delete:obj_abc",
  ]);
  assert.throws(
    () =>
      parseStorageBridgeWriteback(
        {
          workspaceId: "ws_123",
          path: "/s3/acme/objects/new.json",
          content: {},
        },
        resources,
      ),
    /new\.json is not supported/,
  );
});

test("assertReadOnlyFieldsRejected reports schema readOnly fields", () => {
  const schema: JsonSchemaObject = {
    type: "object",
    properties: {
      id: { type: "string", readOnly: true },
      nested: {
        type: "object",
        properties: {
          updatedAt: { type: "string", readOnly: true },
        },
      },
    },
  };

  assert.throws(
    () =>
      assertReadOnlyFieldsRejected(schema, {
        id: "abc",
        nested: { updatedAt: "2026-05-09T10:00:00.000Z" },
      }),
    /id, nested\.updatedAt/,
  );
});
