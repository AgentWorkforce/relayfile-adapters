# Writeback Adapter Contract Spec

Status: draft — implementable as written. See [#open-questions](#open-questions) for the small handful of decisions reviewers should weigh in on before code lands.

## Problem

The cloud writeback bridge (`cloud/packages/web/lib/integrations/relayfile-writeback-bridge.ts`) currently has provider-coupled logic in three layers it doesn't need to be:

1. **Path → request resolution** — the cloud calls `resolveWritebackRequest(path, content)` exported by each adapter. Already lives in adapters. ✅
2. **HTTP transport via Nango** — `proxyThroughNango`. Cross-cutting; correctly lives in cloud. ✅
3. **Response interpretation** — every adapter has its own logic for "is this a success, retryable failure, or permanent failure?" but that logic is currently re-implemented inside the cloud's `executeNotionWriteback`, `executeGitHubWriteback`, `executeLinearWriteback`. ❌

As of `cloud@66c1c45` and `relayfile-adapters@0.1.18`:

| Provider | `resolveWritebackRequest` | Cloud-side execute fn | Lines of provider-specific code in cloud bridge |
|---|---|---|---|
| Notion | ✅ exported from adapter | `executeNotionWriteback` | ~55 |
| GitHub | ✅ as `GitHubWritebackHandler` class | `executeGitHubWriteback` + `executeGitHubReviewCommentWriteback` | ~190 |
| Linear | ✅ exported from adapter | `executeLinearWriteback` + `extractLinearExternalId` + `extractLinearGraphQLErrors` + `extractLinearMutationOutcome` | ~110 |
| Slack | ✅ exported from adapter | _none — falls through to `unsupported_provider`_ | 0 (but coming) |

The pattern isn't getting cleaner: each new provider adds a roughly-identical `executeXWriteback` function plus a handful of provider-specific extractors (Linear added three: external-id walker, GraphQL errors, mutation `success` flag). Slack will need at least an HTTP-vs-`ok:false` distinction (Slack's REST API returns 200 with `{ "ok": false, "error": "..." }`). Asana, Jira, Trello, etc. each bring their own success-encoding quirks.

This spec proposes moving response interpretation into the adapter package alongside the request resolver, behind a single contract the cloud can dispatch through generically.

## Goals

- New providers added by writing one adapter package + one registry entry in cloud. No new `executeXWriteback` per provider.
- Provider-specific knowledge (auth headers, success encoding, error extraction, retry semantics) lives next to the request-builder code that already has that knowledge — same package, same tests.
- Existing `resolveWritebackRequest` exports stay working during migration. No flag day.
- Cloud retains transport (Nango proxy, ack, retry queue) and the workspace integration record lookup — adapters never see secrets or know about Nango directly.

## Non-Goals

- Redesigning the path-mapper, webhook normalizer, or sync record-writer flows. This spec is **writeback-only**.
- Changing the wire shape between cloud and the relayfile workspace fs. The opId / revision / content envelope stays as-is.
- Adding a runtime adapter registry / dynamic loading. Adapters stay in-tree (cloud bumps their npm deps).

## Contract

A new package `@relayfile/adapter-protocol` (zero deps, TypeScript types + a couple of runtime helpers) defines the shared types. Lives at `packages/adapter-protocol/` in this repo so all adapters can depend on it without circulars through `core`.

```ts
// packages/adapter-protocol/src/writeback.ts

/**
 * The full input the cloud bridge hands to an adapter for a single
 * writeback operation. Mirrors RelayfileWritebackInput in cloud, but
 * intentionally provider-neutral.
 */
export interface WritebackInput {
  readonly opId: string;
  readonly workspaceId: string;
  readonly path: string;
  readonly revision: string;
  readonly content: string;
  readonly contentType?: string;
  readonly encoding?: string;
}

/**
 * The HTTP request shape an adapter wants the cloud to perform on its
 * behalf. Adapters never make outbound calls themselves — they describe
 * the call and let cloud transport handle proxying, auth, and ack.
 */
export interface WritebackRequest {
  readonly action: string;                      // free-form tag, e.g. "create_issue"
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly endpoint: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
}

/**
 * What the cloud transport hands back to the adapter after a Nango proxy
 * call. Adapters interpret the response and translate to a WritebackOutcome.
 */
export interface WritebackResponse<T = unknown> {
  readonly ok: boolean;                         // 2xx HTTP
  readonly status: number;
  readonly headers: Headers;
  readonly data: T | null;
}

/**
 * The discriminated-union the bridge's ack/retry pipeline already
 * understands. See cloud/.../relayfile-writeback-bridge.ts for the
 * cloud-side type this aligns with.
 */
export type WritebackOutcome =
  | {
      kind: "success";
      action: string;
      externalId?: string;
      metadata?: Record<string, unknown>;
    }
  | {
      kind: "retryable_failure";
      action: string;
      code: "provider_request_failed" | "transport_failed" | "rate_limited";
      message: string;
      metadata?: Record<string, unknown>;
    }
  | {
      kind: "permanent_failure";
      action: string;
      code: "unsupported_path" | "invalid_content" | "schema_rejected" | "auth_failed";
      message: string;
      metadata?: Record<string, unknown>;
    };

/**
 * The single contract every writeback-capable adapter implements.
 *
 * Adapters do NOT make HTTP calls; they describe requests and interpret
 * responses. The cloud transports those requests through Nango using the
 * connection record it has for the workspace.
 */
export interface WritebackAdapter {
  /**
   * Stable identifier matching the `provider` field on workspace
   * integration records, e.g. "linear", "notion", "github", "slack".
   */
  readonly provider: string;

  /**
   * Path patterns this adapter can resolve. Used for dispatch routing
   * and for capability discovery (the cloud can answer "does this
   * workspace support writebacks at /foo/bar/baz?" without invoking
   * the adapter).
   *
   * Patterns are evaluated in order; first match wins. The dispatch
   * matcher is regex over the absolute relayfile path (e.g.
   * "^/linear/issues/[^/]+\\.json$").
   */
  readonly pathMatchers: ReadonlyArray<RegExp>;

  /**
   * Translate a (path, content) pair into a WritebackRequest. Throwing
   * here is treated by the bridge as `permanent_failure` with code
   * `unsupported_path`. The error message is forwarded verbatim.
   */
  resolve(input: WritebackInput): WritebackRequest;

  /**
   * Translate the transport response into a WritebackOutcome. This is
   * where provider-specific quirks live (Linear's `success: false`,
   * Slack's `ok: false`, GitHub's `422` vs `404`, etc.).
   *
   * `request` is passed back so the adapter can correlate
   * action/endpoint with the outcome metadata.
   */
  interpret(response: WritebackResponse, request: WritebackRequest): WritebackOutcome;

  /**
   * Optional. Extra headers the adapter wants on every request (e.g.
   * Notion's `Notion-Version`, GitHub's `X-GitHub-Api-Version`).
   * Merged with `request.headers` at transport time, with request
   * headers taking precedence.
   */
  buildDefaultHeaders?(): Record<string, string>;
}
```

The cloud bridge's `executeRelayfileProviderWriteback` collapses to:

```ts
const REGISTRY: Readonly<Record<string, WritebackAdapter>> = Object.freeze({
  github: githubWritebackAdapter,
  linear: linearWritebackAdapter,
  notion: notionWritebackAdapter,
  slack:  slackWritebackAdapter,
});

async function executeAdapterWriteback(
  input: RelayfileWritebackInput,
  integration: WorkspaceIntegrationRecord,
): Promise<RelayfileWritebackExecutionResult> {
  const adapter = REGISTRY[providerFromPath(input.path)];
  if (!adapter) {
    return permanentFailure(integration.provider, "unsupported_provider", `No adapter for ${integration.provider}`);
  }

  let request: WritebackRequest;
  try {
    request = adapter.resolve(input);
  } catch (e) {
    return permanentFailure(adapter.provider, "unsupported_path", errorMessage(e));
  }

  const headers = { ...adapter.buildDefaultHeaders?.(), ...request.headers };
  const response = await proxyThroughNango({
    connectionId: integration.connectionId,
    providerConfigKey: normalizeProviderConfigKey(integration),
    method: request.method,
    endpoint: request.endpoint,
    headers,
    data: request.body,
  });

  return adapter.interpret(response, request);
}
```

The provider-specific functions in `relayfile-writeback-bridge.ts` (~360 lines today) shrink to ~30 lines of generic transport plus a `REGISTRY` literal.

## Migration Plan

Per-adapter migration is independent. Order from cheapest to most invasive:

### Phase 0 — Land protocol package

1. Create `packages/adapter-protocol/` with the types above and a thin runtime barrel for `permanentFailure` / `retryableFailure` / `successResult` constructors.
2. Publish `@relayfile/adapter-protocol@0.1.0`. No adapter depends on it yet.

### Phase 1 — Slack as the proving ground

Slack has no cloud-side wiring today, so we get to write the new shape from scratch without breaking anything. See [Slack adapter outline](#slack-adapter-outline) below. After Phase 1 ships:

- `@relayfile/adapter-slack` exports `slackWritebackAdapter: WritebackAdapter` alongside the existing `resolveWritebackRequest` (kept for backward compat).
- Cloud bridge gets the `REGISTRY` skeleton with **only** Slack populated, behind a feature flag (`RELAYFILE_USE_ADAPTER_PROTOCOL`). Existing executeXWriteback functions remain for the other three providers.
- New Slack writebacks flow through the contract end-to-end. Old providers untouched.

### Phase 2 — Linear, Notion (smallest existing executors)

For each of Linear and Notion:

1. Add a `<provider>WritebackAdapter` export to the adapter package that wraps the existing `resolveWritebackRequest` + the response-interpretation logic that currently lives in cloud.
2. Add the adapter to the cloud `REGISTRY`.
3. Flip the dispatch from `executeXWriteback` to `REGISTRY[provider]` for that provider only.
4. Delete the cloud-side `executeXWriteback` and its provider-specific extractors.

The cloud-side test changes are minimal — the test asserts on the `RelayfileWritebackExecutionResult` shape, not on which function produced it. We keep the existing `tests/relayfile-writeback-bridge.test.ts` cases and migrate the response-shape assertions into adapter-package unit tests where they belong.

### Phase 3 — GitHub

GitHub is the heaviest existing executor (~190 lines, two paths: PR comments and review comments via the dedicated `GitHubWritebackHandler` class). The class is already shaped close to the contract — Phase 3 mostly involves making it implement `WritebackAdapter` directly (or wrapping it in an adapter that does).

Two GitHub-specific subtleties to handle:

- The contents-API large-file fallback (see `executeGitHubReviewCommentWriteback`) is a transport-layer retry, not an interpretation. Stays in cloud.
- Review-comment-vs-PR-comment dispatch is currently keyed off `input.path.includes("/comments/")`. Move that into the adapter's `pathMatchers` so the dispatch happens through the same regex routing as everything else.

### Phase 4 — Remove the feature flag, retire compat shims

Once all four wired providers route through the registry, drop `RELAYFILE_USE_ADAPTER_PROTOCOL` and the legacy executors.

`resolveWritebackRequest` named exports stay on each adapter package indefinitely as a low-level escape hatch — nothing about the contract requires removing them, and external callers (sales scripts, demos, in-house workflows) may import them directly.

## Slack Adapter Outline

Concrete sketch of what the Slack adapter looks like under the new contract. Useful both as a proving ground and to make the contract feel less abstract for reviewers.

```ts
// packages/slack/src/writeback-adapter.ts
import type {
  WritebackAdapter,
  WritebackInput,
  WritebackOutcome,
  WritebackRequest,
  WritebackResponse,
} from "@relayfile/adapter-protocol";

import { resolveWritebackRequest } from "./writeback.js";
import type { SlackWritebackRequest } from "./types.js";

const SLACK_PATH_MATCHERS = [
  /^\/slack\/channels\/[^/]+\/messages\/new\.json$/,
  /^\/slack\/channels\/[^/]+\/messages\/[^/]+\/replies\/new\.json$/,
  /^\/slack\/channels\/[^/]+\/messages\/[^/]+\/reactions\/new\.json$/,
];

export const slackWritebackAdapter: WritebackAdapter = {
  provider: "slack",
  pathMatchers: SLACK_PATH_MATCHERS,

  resolve(input: WritebackInput): WritebackRequest {
    const req: SlackWritebackRequest = resolveWritebackRequest(input.path, input.content);
    return {
      action: req.action,
      method: req.method,
      endpoint: req.endpoint,
      body: req.body,
    };
  },

  interpret(response: WritebackResponse, request: WritebackRequest): WritebackOutcome {
    // Slack's web API quirk: 200 OK with { ok: false, error: "<reason>" }
    // is how it reports business-level rejections. We must inspect the
    // body, not the status, to decide success.
    const body = isSlackResponseBody(response.data) ? response.data : null;

    if (response.ok && body?.ok === true) {
      return {
        kind: "success",
        action: request.action,
        externalId: extractSlackExternalId(body, request.action),
        metadata: { status: response.status },
      };
    }

    const message = body?.error ?? `Slack request failed with status ${response.status}`;
    const retryable =
      response.status === 429 ||                  // rate_limited (Slack's signal)
      response.status >= 500 ||
      body?.error === "ratelimited" ||
      body?.error === "service_unavailable";

    return retryable
      ? {
          kind: "retryable_failure",
          action: request.action,
          code: response.status === 429 || body?.error === "ratelimited" ? "rate_limited" : "provider_request_failed",
          message,
          metadata: { status: response.status, slackError: body?.error },
        }
      : {
          kind: "permanent_failure",
          action: request.action,
          code: body?.error === "not_authed" || body?.error === "invalid_auth" ? "auth_failed" : "schema_rejected",
          message,
          metadata: { status: response.status, slackError: body?.error },
        };
  },
};

interface SlackResponseBody {
  ok?: boolean;
  error?: string;
  ts?: string;
  channel?: string;
}

function isSlackResponseBody(value: unknown): value is SlackResponseBody {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function extractSlackExternalId(body: SlackResponseBody, action: string): string | undefined {
  if (action === "post_message" || action === "post_thread_reply") {
    // Slack's chat.postMessage returns ts (the message timestamp), which
    // is the canonical id for downstream reactions/replies.
    return typeof body.ts === "string" ? body.ts : undefined;
  }
  return undefined;
}
```

Things to notice:

- **No HTTP code in the adapter.** It describes the call (`method`, `endpoint`, `body`) and decodes the response. The Nango proxy, the workspace-integration lookup, and the relayfile ack flow all stay in cloud.
- **Slack-specific quirks live next to Slack code.** `body.ok === false`, the `ratelimited`/`not_authed` error codes, and the `ts` field as the external-id are all in `packages/slack`. Cloud knows none of this.
- **Tests for `interpret()` are pure and fast.** Construct a `WritebackResponse` literal, call `interpret`, assert on the `WritebackOutcome`. No mocking Nango, no pglite db, no HTTP server. Should live in `packages/slack/src/__tests__/writeback-adapter.test.ts`.

A complete Phase 1 also adds a transport-level test in cloud (`tests/relayfile-writeback-bridge.test.ts`) that asserts the bridge correctly dispatches `/slack/...` paths through the registry, but the body-shape assertions move to the adapter package.

## Open Questions

Reviewers please weigh in:

1. **Package home for the protocol types.** `@relayfile/adapter-protocol` (new package, zero deps) vs adding to `@relayfile/adapter-core` (existing). Argument for new package: keeps `core`'s heavy schema-generation deps out of the cloud bridge. Argument for `core`: one fewer published package. Spec assumes new package.

2. **Should `WritebackRequest.body` be typed?** Current `unknown`. Considered a generic `WritebackRequest<TBody>` but it forces the cloud transport to carry the type, which doesn't help anything. Leaving `unknown`.

3. **Retry-after surfacing.** Slack and GitHub both return `Retry-After` headers on 429s. Spec doesn't expose this on `WritebackOutcome` today. Should the bridge's retry queue read `response.headers.get("retry-after")` directly (provider-agnostic), or should adapters surface it on `metadata.retryAfterSeconds`? Recommend the former — fewer places to remember.

4. **Capability discovery surface.** `pathMatchers` lets the cloud answer "is this path supported?" without invoking the adapter. Worth exposing a public helper (e.g. `cloud.canWriteback(path)`) for callers like the workflow engine? Out of scope for v1; tracked separately.

## Estimated Effort

| Phase | Scope | Risk |
|---|---|---|
| 0 — protocol package | New empty package, types + helpers | Low |
| 1 — Slack adapter | New code only; no existing surface to break | Low–Medium |
| 2 — Linear + Notion | Two adapters, two cloud `REGISTRY` flips, deletions | Medium (touches the live demo flow) |
| 3 — GitHub | Heaviest existing executor; two-path dispatch | Medium |
| 4 — flag removal | Mechanical | Low |

Total ~1–2 weeks of focused work, gated behind the feature flag for safe staged rollout.
