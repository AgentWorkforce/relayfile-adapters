import type {
  InboundSource,
  LogicalEventKeyResult,
} from "./types.js";

interface InboundLogicalEventGoldenVectorBase {
  readonly id: string;
  readonly source: InboundSource;
  readonly headers?: Readonly<Record<string, string>>;
  readonly rawBody: string;
}

export interface InboundLogicalEventSuccessGoldenVector
  extends InboundLogicalEventGoldenVectorBase {
  readonly expected: LogicalEventKeyResult;
}

export interface InboundLogicalEventRejectionGoldenVector
  extends InboundLogicalEventGoldenVectorBase {
  readonly expectedError: {
    readonly name: "IncompleteNangoSyncPageIdentityError";
    readonly code: "incomplete_nango_sync_page_identity";
    readonly missingFields: readonly string[];
  };
}

export type InboundLogicalEventGoldenVector =
  | InboundLogicalEventSuccessGoldenVector
  | InboundLogicalEventRejectionGoldenVector;

/**
 * Cross-runtime vectors for Cloud, relayfile-cloud, and generated edge
 * artifacts. Raw bodies are exact UTF-8 bytes with no implicit trailing
 * newline.
 */
export const INBOUND_LOGICAL_EVENT_GOLDEN_VECTORS = [
  {
    id: "github-nango-delivery",
    source: "nango",
    headers: { "x-nango-delivery-id": "delivery-gh-001" },
    rawBody:
      '{"type":"forward","providerConfigKey":"github-relay","connectionId":"conn-gh","payload":{"action":"opened","id":42}}',
    expected: {
      version: "relayfile.ingest.logical/1",
      key: "v1:provider-delivery-id:sha256:d8d0e5edb08a276d0e23b478615457d206b8170b6e194413d82bf0eb65349c85",
      strategy: "provider-delivery-id",
      capabilityId: "github.nango",
      providerId: "github",
      evidence: {
        rawBodySha256:
          "4f6b15091d1b03e15b06f2625c490d79e9dbbb7d410ad2a7d2d3a1aee3649787",
        providerDeliveryId: "delivery-gh-001",
      },
    },
  },
  {
    id: "github-sync-compact",
    source: "nango",
    rawBody:
      '{"type":"sync","providerConfigKey":"github-relay","payload":{"connectionId":"conn-gh","syncName":"fetch-issues","model":"Issue","queryTimeStamp":"2026-07-25T00:00:00.000Z","cursor":"cursor-2","records":[{"id":1}]}}',
    expected: {
      version: "relayfile.ingest.logical/1",
      key: "v1:nango-sync-page:sha256:e9a7dc2e86a3f2afb4a9325b90faf5ba2df53452a3577358c6c6f0989b849b1a",
      strategy: "nango-sync-page",
      capabilityId: "github.nango",
      providerId: "github",
      evidence: {
        rawBodySha256:
          "70a4c8541f73737ccbeb9da4aabf8498cb45e0fba3c54ac6e765865fa8ce4073",
        sourceCursor: "2026-07-25T00:00:00.000Z/cursor-2",
      },
    },
  },
  {
    id: "github-sync-reformatted",
    source: "nango",
    rawBody:
      '{\n  "payload": {\n    "records": [{ "id": 999 }],\n    "cursor": "cursor-2",\n    "model": "Issue",\n    "syncName": "fetch-issues",\n    "connectionId": "conn-gh",\n    "queryTimeStamp": "2026-07-25T00:00:00.000Z"\n  },\n  "providerConfigKey": "github-relay",\n  "type": "sync"\n}',
    expected: {
      version: "relayfile.ingest.logical/1",
      key: "v1:nango-sync-page:sha256:e9a7dc2e86a3f2afb4a9325b90faf5ba2df53452a3577358c6c6f0989b849b1a",
      strategy: "nango-sync-page",
      capabilityId: "github.nango",
      providerId: "github",
      evidence: {
        rawBodySha256:
          "1f5b6d35a4efe6bb86f112a50a919697dd422a26b54d3025028df2227eece879",
        sourceCursor: "2026-07-25T00:00:00.000Z/cursor-2",
      },
    },
  },
  {
    id: "github-sync-incomplete-page-identity",
    source: "nango",
    rawBody:
      '{"type":"sync","providerConfigKey":"github-relay","payload":{"connectionId":"conn-gh","syncName":"fetch-issues","model":"Issue","records":[{"id":1}]}}',
    expectedError: {
      name: "IncompleteNangoSyncPageIdentityError",
      code: "incomplete_nango_sync_page_identity",
      missingFields: ["windowOrCursor"],
    },
  },
  {
    id: "gitlab-hookdeck-provider-uuid",
    source: "hookdeck",
    headers: {
      "x-gitlab-event": "Merge Request Hook",
      "x-gitlab-event-uuid": "gitlab-event-123",
      "x-hookdeck-eventid": "hookdeck-456",
    },
    rawBody: '{"object_kind":"merge_request","project":{"id":42}}',
    expected: {
      version: "relayfile.ingest.logical/1",
      key: "v1:provider-delivery-id:sha256:5331024f5d732c3a9fcf808bced68e693a1945d8db7ee9978ebc64314bb21313",
      strategy: "provider-delivery-id",
      capabilityId: "gitlab.hookdeck",
      providerId: "gitlab",
      evidence: {
        rawBodySha256:
          "2b04b94211bd64879fd067ee0ff4301d17d42503bef406512b494d48f86ea4b6",
        providerDeliveryId: "gitlab-event-123",
      },
    },
  },
  {
    id: "gitlab-hookdeck-delivery-fallback",
    source: "hookdeck",
    headers: {
      "x-gitlab-event": "Merge Request Hook",
      "x-hookdeck-eventid": "hookdeck-456",
    },
    rawBody: '{"object_kind":"merge_request","project":{"id":42}}',
    expected: {
      version: "relayfile.ingest.logical/1",
      key: "v1:hookdeck-delivery-id:sha256:2e0ea52dfdc94abe317ece568e2e78815cf8aff24810ff4b1fa9983cdd5d3cca",
      strategy: "hookdeck-delivery-id",
      capabilityId: "gitlab.hookdeck",
      providerId: "gitlab",
      evidence: {
        rawBodySha256:
          "2b04b94211bd64879fd067ee0ff4301d17d42503bef406512b494d48f86ea4b6",
        providerDeliveryId: "hookdeck-456",
      },
    },
  },
  {
    id: "linear-semantic",
    source: "nango",
    rawBody:
      '{"type":"forward","providerConfigKey":"linear-relay","connectionId":"conn-linear","payload":{"action":"update","data":{"id":"issue-1","title":"Fix me"}}}',
    expected: {
      version: "relayfile.ingest.logical/1",
      key: "v1:semantic-payload:sha256:e001d3463863ae208932de174080503d172d57f8ef6b117af69f0dd3b4ee66da",
      strategy: "semantic-payload",
      capabilityId: "linear.nango",
      providerId: "linear",
      evidence: {
        rawBodySha256:
          "72e612b3257cf3cfc0aeff20bf3813ea4a11e6952db880cc13fcf014035cb690",
      },
    },
  },
  {
    id: "unknown-raw",
    source: "nango",
    rawBody:
      '{ "type": "future-kind", "providerConfigKey": "github-relay", "value": 1 }',
    expected: {
      version: "relayfile.ingest.logical/1",
      key: "v1:raw-body:sha256:c0471aa30460cd6539e2c5c2f92194bf36ebf01aa12d0878d09ef50909e88c50",
      strategy: "raw-body",
      capabilityId: "github.nango",
      providerId: "github",
      evidence: {
        rawBodySha256:
          "8e1c59098a2b1a116b5caf0e87d4074c80d7e6a47989d1ec907e67f1d47e83cd",
      },
    },
  },
] as const satisfies readonly InboundLogicalEventGoldenVector[];
