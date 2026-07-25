import assert from "node:assert/strict";
import test from "node:test";

import {
  INBOUND_CAPABILITY_CATALOG,
  INBOUND_CAPABILITY_CATALOG_VERSION,
  INBOUND_LOGICAL_EVENT_GOLDEN_VECTORS,
  logicalEventKey,
  resolveInboundCapability,
} from "./index.js";

const encoder = new TextEncoder();

test("published logical-event golden vectors remain byte exact", async () => {
  for (const vector of INBOUND_LOGICAL_EVENT_GOLDEN_VECTORS) {
    const actual = await logicalEventKey({
      source: vector.source,
      ...("headers" in vector ? { headers: vector.headers } : {}),
      payload: JSON.parse(vector.rawBody),
      rawBody: vector.rawBody,
    });
    assert.deepEqual(actual, vector.expected, vector.id);
  }
});

test("catalog resolves every formerly divergent Nango provider-config alias", () => {
  const expected = new Map([
    ["github-relay", "github"],
    ["github-sage", "github"],
    ["github-app", "github"],
    ["github-app-oauth", "github"],
    ["linear-relay", "linear"],
    ["linear-sage", "linear"],
    ["notion-relay", "notion"],
    ["notion-sage", "notion"],
    ["slack-relay", "slack"],
    ["slack-sage", "slack"],
    ["slack-sage-preview", "slack"],
    ["google-mail-relay", "gmail"],
    ["google-mail", "gmail"],
    ["gmail", "gmail"],
    ["hubspot-relay", "hubspot"],
    ["gitlab-relay", "gitlab"],
  ]);

  for (const [providerConfigKey, providerId] of expected) {
    const capability = resolveInboundCapability({
      source: "nango",
      payload: { type: "sync", providerConfigKey },
      rawBody: encoder.encode("{}"),
    });
    assert.equal(capability?.providerId, providerId, providerConfigKey);
  }

  assert.match(INBOUND_CAPABILITY_CATALOG_VERSION, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(
    new Set(INBOUND_CAPABILITY_CATALOG.map((capability) => capability.id)).size,
    INBOUND_CAPABILITY_CATALOG.length,
  );
});

test("Nango sync pages key by provider config, connection, sync, model, window, and cursor", async () => {
  const firstPayload = {
    type: "sync",
    providerConfigKey: "github-relay",
    payload: {
      connectionId: "conn-1",
      syncName: "fetch-issues",
      model: "Issue",
      queryTimeStamp: "2026-07-25T00:00:00.000Z",
      cursor: "cursor-2",
      records: [{ id: 1 }],
    },
  };
  const secondPayload = {
    payload: {
      records: [{ id: 999 }],
      cursor: "cursor-2",
      model: "Issue",
      syncName: "fetch-issues",
      connectionId: "conn-1",
      queryTimeStamp: "2026-07-25T00:00:00.000Z",
    },
    providerConfigKey: "github-relay",
    type: "sync",
  };

  const first = await logicalEventKey({
    source: "nango",
    payload: firstPayload,
    rawBody: encoder.encode(JSON.stringify(firstPayload)),
  });
  const second = await logicalEventKey({
    source: "nango",
    payload: secondPayload,
    rawBody: encoder.encode(JSON.stringify(secondPayload, null, 2)),
  });

  assert.equal(first.strategy, "nango-sync-page");
  assert.equal(first.key, second.key);
  assert.notEqual(first.evidence.rawBodySha256, second.evidence.rawBodySha256);
  assert.equal(
    first.evidence.sourceCursor,
    "2026-07-25T00:00:00.000Z/cursor-2",
  );
});

test("GitLab Hookdeck uses the provider event UUID before Hookdeck delivery fallback", async () => {
  const input = {
    source: "hookdeck" as const,
    headers: {
      "X-Gitlab-Event": "Merge Request Hook",
      "X-Gitlab-Event-UUID": "gitlab-event-123",
      "X-Hookdeck-EventID": "hookdeck-delivery-456",
    },
    payload: { object_kind: "merge_request", project: { id: 42 } },
    rawBody: encoder.encode('{"object_kind":"merge_request","project":{"id":42}}'),
  };

  const capability = resolveInboundCapability(input);
  assert.equal(capability?.id, "gitlab.hookdeck");
  const result = await logicalEventKey(input, capability);
  assert.equal(result.strategy, "provider-delivery-id");
  assert.equal(result.evidence.providerDeliveryId, "gitlab-event-123");
});

test("known events use canonical semantic JSON before exact-body fallback", async () => {
  const base = {
    type: "forward",
    providerConfigKey: "linear-relay",
    connectionId: "conn-linear",
    payload: { action: "update", data: { id: "issue-1", title: "Fix me" } },
  };
  const reordered = {
    connectionId: "conn-linear",
    payload: { data: { title: "Fix me", id: "issue-1" }, action: "update" },
    providerConfigKey: "linear-relay",
    type: "forward",
  };

  const first = await logicalEventKey({
    source: "nango",
    payload: base,
    rawBody: encoder.encode(JSON.stringify(base)),
  });
  const second = await logicalEventKey({
    source: "nango",
    payload: reordered,
    rawBody: encoder.encode(JSON.stringify(reordered, null, 2)),
  });

  assert.equal(first.strategy, "semantic-payload");
  assert.equal(first.key, second.key);
  assert.notEqual(first.evidence.rawBodySha256, second.evidence.rawBodySha256);
});

test("business event ids are not treated as transport delivery ids", async () => {
  const result = await logicalEventKey({
    source: "nango",
    payload: {
      type: "forward",
      providerConfigKey: "linear-relay",
      connectionId: "conn-linear",
      eventId: "business-event-1",
      payload: { action: "update", data: { id: "issue-1" } },
    },
    rawBody: encoder.encode(
      '{"type":"forward","providerConfigKey":"linear-relay","connectionId":"conn-linear","eventId":"business-event-1","payload":{"action":"update","data":{"id":"issue-1"}}}',
    ),
  });

  assert.equal(result.strategy, "semantic-payload");
  assert.equal(result.evidence.providerDeliveryId, undefined);
});

test("unknown event kinds use exact raw-body identity explicitly", async () => {
  const compact = await logicalEventKey({
    source: "nango",
    payload: { type: "future-kind", providerConfigKey: "github-relay", value: 1 },
    rawBody: encoder.encode('{"type":"future-kind","providerConfigKey":"github-relay","value":1}'),
  });
  const spaced = await logicalEventKey({
    source: "nango",
    payload: { type: "future-kind", providerConfigKey: "github-relay", value: 1 },
    rawBody: encoder.encode('{ "type": "future-kind", "providerConfigKey": "github-relay", "value": 1 }'),
  });

  assert.equal(compact.strategy, "raw-body");
  assert.notEqual(compact.key, spaced.key);
});
