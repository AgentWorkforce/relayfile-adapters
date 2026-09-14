import assert from "node:assert/strict";
import test from "node:test";
import {
  ADAPTER_EVENT_SCHEMA,
  EVENT_SUBSCRIPTION_SCHEMA,
  createAdapterEvent,
  defineEventSubscription,
  parseAdapterEvent,
  parseEventSubscription,
  type AdapterEventInput,
} from "@relayfile/adapter-core/events";
import { KNOWN_TRIGGER_CATALOG } from "@relayfile/adapter-core/triggers";

function subscription() {
  return { schema: EVENT_SUBSCRIPTION_SCHEMA, provider: "linear", eventTypes: ["issue.create"], connectionId: "linear-connection" };
}

function event(): AdapterEventInput<"linear"> {
  return {
    id: "v1:provider-delivery-id:sha256:upstream-logical-identity",
    provider: "linear",
    eventType: "issue.create",
    workspaceId: "workspace-1",
    connectionId: "linear-connection",
    deliveryId: "transport-delivery-1",
    occurredAt: "2026-09-14T12:34:56.789Z",
    paths: ["/linear/issues/eng-123__issue-id.json"],
    payload: { id: "issue-id", title: "Fix the build" },
  };
}

function serializedEvent() {
  return { ...event(), schema: ADAPTER_EVENT_SCHEMA };
}

test("subscription and event parsers use every provider's existing trigger catalog", () => {
  for (const [provider, eventTypes] of Object.entries(KNOWN_TRIGGER_CATALOG)) {
    const parsed = parseEventSubscription({ ...subscription(), provider, eventTypes });
    assert.deepEqual(parsed.eventTypes, eventTypes);
    for (const eventType of eventTypes) {
      const parsedEvent = parseAdapterEvent({ ...serializedEvent(), provider, eventType });
      assert.equal(parsedEvent.provider, provider);
      assert.equal(parsedEvent.eventType, eventType);
    }
  }
  for (const provider of ["missing-provider", "toString", "__proto__"]) {
    assert.throws(() => parseEventSubscription({ ...subscription(), provider }), /Unknown event provider/);
    assert.throws(() => parseAdapterEvent({ ...serializedEvent(), provider }), /Unknown event provider/);
  }
  for (const eventType of ["issues.labeled", "linear.issue.create", "issue.*"]) {
    assert.throws(() => parseEventSubscription({ ...subscription(), eventTypes: [eventType] }), /Unknown linear event type/);
    assert.throws(() => parseAdapterEvent({ ...serializedEvent(), eventType }), /Unknown linear event type/);
  }
});

test("serialized declarations reject unknown versions and unsupported selectors", () => {
  assert.throws(() => parseEventSubscription({ ...subscription(), schema: "relayfile.event-subscription/2" }), /schema/);
  assert.throws(() => parseAdapterEvent({ ...serializedEvent(), schema: "relayfile.adapter-event/2" }), /schema/);
  for (const selector of ["filter", "scope", "labels", "providerConfigKey"]) {
    assert.throws(() => parseEventSubscription({ ...subscription(), [selector]: { labels: ["ready"] } }), /not supported/);
  }
  assert.throws(() => parseAdapterEvent({ ...serializedEvent(), accepted: true }), /not supported/);
  for (const eventTypes of [[], ["issue.create", "issue.create"], "issue.create"]) {
    assert.throws(() => parseEventSubscription({ ...subscription(), eventTypes }), /eventTypes/);
  }
});

test("definitions are independent immutable snapshots of mutable inputs", () => {
  const input = { provider: "linear" as const, eventTypes: ["issue.create" as const], connectionId: "connection-1", pathPrefixes: ["/linear/issues"] };
  const source = defineEventSubscription(input);
  input.connectionId = "other-connection";
  input.eventTypes.length = 0;
  input.pathPrefixes[0] = "/other";
  assert.equal(source.connectionId, "connection-1");
  assert.deepEqual(source.eventTypes, ["issue.create"]);
  assert.deepEqual(source.pathPrefixes, ["/linear/issues"]);
  assert.ok(Object.isFrozen(source));
  assert.ok(Object.isFrozen(source.eventTypes));
  assert.ok(Object.isFrozen(source.pathPrefixes));

  const payload = { title: "before", nested: { labels: ["ready"] } };
  const paths = ["/linear/issues/issue.json"];
  const delivered = createAdapterEvent({ ...event(), paths, payload });
  payload.title = "after";
  payload.nested.labels.push("changed");
  paths[0] = "/other";
  assert.deepEqual(delivered.payload, { title: "before", nested: { labels: ["ready"] } });
  assert.deepEqual(delivered.paths, ["/linear/issues/issue.json"]);
  assert.ok(Object.isFrozen(delivered));
  assert.ok(Object.isFrozen(delivered.paths));
  assert.ok(Object.isFrozen(delivered.payload));
  assert.ok(Object.isFrozen((delivered.payload as typeof payload).nested.labels));
});

test("envelopes require provenance and preserve logical and transport identity exactly", () => {
  const input = event();
  const delivered = createAdapterEvent(input);
  assert.equal(delivered.id, input.id);
  assert.equal(delivered.deliveryId, input.deliveryId);
  assert.equal(delivered.occurredAt, input.occurredAt);
  assert.equal(delivered.workspaceId, input.workspaceId);
  assert.equal(delivered.connectionId, input.connectionId);
  assert.deepEqual(parseAdapterEvent(JSON.parse(JSON.stringify(delivered))), delivered);
  const { deliveryId: _deliveryId, ...withoutDelivery } = input;
  assert.equal(Object.hasOwn(createAdapterEvent(withoutDelivery), "deliveryId"), false);
  for (const field of ["id", "workspaceId", "connectionId", "occurredAt", "paths", "payload"]) {
    const incomplete: Record<string, unknown> = serializedEvent();
    delete incomplete[field];
    assert.throws(() => parseAdapterEvent(incomplete), TypeError, field);
  }
  for (const value of ["", "  ", " shifted ", null, 5]) {
    assert.throws(() => parseAdapterEvent({ ...serializedEvent(), id: value }), TypeError);
    assert.throws(() => parseAdapterEvent({ ...serializedEvent(), connectionId: value }), TypeError);
    assert.throws(() => parseEventSubscription({ ...subscription(), connectionId: value }), TypeError);
  }
  for (const occurredAt of ["2026-02-30T12:34:56.789Z", "2026-09-14", "2026-09-14T12:34:56.789+00:00"]) {
    assert.throws(() => parseAdapterEvent({ ...serializedEvent(), occurredAt }), /occurredAt/);
  }
});

test("selectors and affected paths require concrete absolute paths", () => {
  for (const path of ["relative", "//linear", "/linear/", "/linear//issues", "/linear/../slack", "/linear/./issues", "/linear/*", "/linear/{id}", "/linear/[id]", "/linear/?", "/linear\\issues", "/linear/\u0000"]) {
    assert.throws(() => parseEventSubscription({ ...subscription(), pathPrefixes: [path] }), /concrete absolute Relayfile path/, path);
    assert.throws(() => parseAdapterEvent({ ...serializedEvent(), paths: [path] }), /concrete absolute Relayfile path/, path);
  }
  for (const paths of [[], ["/linear", "/linear"], " /linear"]) {
    assert.throws(() => parseAdapterEvent({ ...serializedEvent(), paths }), /paths/);
    assert.throws(() => parseEventSubscription({ ...subscription(), pathPrefixes: paths }), /pathPrefixes/);
  }
  for (const path of ["/", "/linear/issues", "/linear/issues/eng-123__id.json"]) {
    assert.deepEqual(parseEventSubscription({ ...subscription(), pathPrefixes: [path] }).pathPrefixes, [path]);
    assert.deepEqual(parseAdapterEvent({ ...serializedEvent(), paths: [path] }).paths, [path]);
  }
});

test("payloads preserve JSON values including null and reject non-JSON or cyclic input", () => {
  const shared = { value: "reused" };
  const payloads = [null, true, false, 0, 1.25, "", [null, true, 1], { shared, again: shared }];
  for (const payload of payloads) {
    assert.deepEqual(parseAdapterEvent({ ...serializedEvent(), payload }).payload, payload);
  }
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const cyclicArray: unknown[] = [];
  cyclicArray.push(cyclicArray);
  const badPayloads = [undefined, NaN, Infinity, -Infinity, BigInt(1), () => 1, Symbol("value"), new Date(), new Map(), cyclic, cyclicArray, { value: undefined }, [NaN], new Array(1)];
  for (const payload of badPayloads) {
    assert.throws(() => parseAdapterEvent({ ...serializedEvent(), payload }), TypeError);
  }
  assert.throws(() => parseAdapterEvent({ ...serializedEvent(), payload: { get secret() { throw new Error("getter executed"); } } }), /JSON data properties/);
  assert.throws(() => parseAdapterEvent({ ...serializedEvent(), payload: { [Symbol("hidden")]: true } }), /JSON data properties/);
  const getterArray = Object.defineProperty([1], "0", { get() { throw new Error("getter executed"); } });
  const hiddenObject = Object.defineProperty({}, "secret", { value: 1 });
  for (const payload of [getterArray, hiddenObject, Object.assign([1], { extra: 2 })]) {
    assert.throws(() => parseAdapterEvent({ ...serializedEvent(), payload }), /JSON data/);
  }
});

// Compile-time examples are deliberately not executed: runtime callers use parsers.
function typeChecks() {
  defineEventSubscription({ provider: "linear", eventTypes: ["issue.create"], connectionId: "connection" });
  // @ts-expect-error GitHub trigger names do not belong to Linear.
  defineEventSubscription({ provider: "linear", eventTypes: ["issues.labeled"], connectionId: "connection" });
  // @ts-expect-error GitHub trigger names do not belong to Linear.
  createAdapterEvent({ ...event(), eventType: "issues.labeled" });
}
void typeChecks;
