# Writeback Adapter Contract Spec

Status: draft — implementable as written. The previously open reviewer questions are resolved in [Resolved Decisions](#resolved-decisions).

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

## Motivating incident: linear writeback gate vs bridge drift

Concrete repro that landed while drafting this spec.

[cloud#466](https://github.com/AgentWorkforce/cloud/pull/466) wired Linear into the dispatch switch in `cloud/packages/web/lib/integrations/relayfile-writeback-bridge.ts` — that PR's tests (7/7) all passed and the deploy succeeded. End-to-end verification immediately afterward showed local writes to path:`/linear/issues/new.json` still failing:

```
{ "opId":"op_116", "path":"path:/linear/issues/new.json",
  "provider":"linear", "status":"failed",
  "lastError":"unsupported provider writeback path: path:/linear/issues/new.json" }
```

Root cause: a *second* path-pattern gate in `cloud/packages/relayfile/src/writeback/provider-executor.ts` — a different package, a different deployment target (Cloudflare Workers vs Next.js Lambda) — had its own switch with `notion` and `github` cases and a default deny. Linear was wired in the bridge dispatch but rejected at the upstream gate before the bridge ever got called. Fixed in [cloud#467](https://github.com/AgentWorkforce/cloud/pull/467) by adding a `LINEAR_WRITEBACK_PATH` regex and a `case "linear"`.

This is the exact failure mode `pathMatchers` on the contract is designed to eliminate: **two files, in two packages, each maintaining their own copy of "what paths does this provider support?"** Tests in either file pass on their own; the divergence only shows up at runtime, on a path that exercises both call sites. Each new provider doubles the surface area for this kind of drift.

## Goals

- New providers added by writing one adapter package + one registry entry in cloud. No new `executeXWriteback` per provider.
- Provider-specific knowledge (auth headers, success encoding, error extraction, retry semantics) lives next to the request-builder code that already has that knowledge — same package, same tests.
- Existing `resolveWritebackRequest` exports stay working during migration. No flag day.
- Cloud retains transport (Nango proxy, ack, retry queue) and the workspace integration record lookup — adapters never see secrets or know about Nango directly.

## Non-Goals

- Redesigning the path-mapper, webhook normalizer, or sync record-writer flows. This spec is **writeback-only**.
- Changing the wire shape between cloud and the relayfile workspace fs. The opId / revision / content envelope stays as-is.
- Adding a runtime adapter registry / dynamic loading. Adapters stay in-tree (cloud bumps their npm deps).

## Ricky Local Run Contract

This document is a design spec, not an instruction for Ricky to implement the migration plan. When this file is passed to `ricky --mode local --spec-file docs/WRITEBACK_ADAPTER_CONTRACT_SPEC.md --run`, the generated workflow is documentation-only and validation-only.

The workflow should use deterministic shell steps only. It should not spawn Claude, Codex, Gemini, OpenCode, workforce personas, lead agents, child workflows, or implementation workers. Its job is to validate that this spec remains internally consistent and that the resolved decisions below are present.

The generated workflow's only target file is `docs/WRITEBACK_ADAPTER_CONTRACT_SPEC.md`. Code paths and relayfile paths shown inside examples are illustrative references, not implementation targets.

## Generated Workflow Side-Effect Policy

Generated workflows may automatically generate workflow artifacts under the repo and run local validation commands. For this spec, they may not automatically edit source files, tests, or docs.

Generated workflows must pause for explicit user approval before publishing packages, deploying, committing, pushing, opening PRs, merging, applying database migrations, deleting existing implementation code, or removing feature flags. Deletion and removal steps in the migration plan are implementation instructions, not automatic side effects for a generated workflow run.

## Contract

A new writeback protocol entrypoint in `@relayfile/adapter-core` defines the shared TypeScript types and a couple of small runtime helpers. It lives under `packages/core/src/writeback/` and is exported as `@relayfile/adapter-core/writeback` so adapters and cloud can import the writeback contract without adding another published package.

```ts
// file:packages/core/src/writeback/index.ts

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
export interface WritebackRequest<TBody = unknown> {
  readonly action: string;                      // free-form tag, e.g. "create_issue"
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly endpoint: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: TBody;
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
 * The discriminated-union the bridge's ack and retry pipeline already
 * understands. See cloud...relayfile-writeback-bridge.ts for the
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
 * Provider-agnostic retry scheduling data parsed by cloud transport.
 *
 * Adapters do not need to copy Retry-After into outcome metadata. The bridge
 * reads this from response headers once and passes it to the retry queue.
 */
export interface RetryScheduleHint {
  readonly retryAfterSeconds?: number;
}

export function parseRetryAfter(headers: Headers): RetryScheduleHint {
  const raw = headers.get("retry-after");
  if (!raw) return {};

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return { retryAfterSeconds: seconds };
  }

  const retryAt = Date.parse(raw);
  if (!Number.isNaN(retryAt)) {
    return {
      retryAfterSeconds: Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)),
    };
  }

  return {};
}

/**
 * The single contract every writeback-capable adapter implements.
 *
 * Adapters do NOT make HTTP calls; they describe requests and interpret
 * responses. The cloud transports those requests through Nango using the
 * connection record it has for the workspace.
 */
export interface WritebackAdapter<TBody = unknown, TResponse = unknown> {
  /**
   * Stable identifier matching the `provider` field on workspace
   * integration records, e.g. "linear", "notion", "github", "slack".
   */
  readonly provider: string;

  /**
   * Path patterns this adapter can resolve. Used for dispatch routing
   * and for capability discovery (the cloud can answer "does this
   * workspace support writebacks at path:/foo/bar/baz?" without invoking
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
  resolve(input: WritebackInput): WritebackRequest<TBody>;

  /**
   * Translate the transport response into a WritebackOutcome. This is
   * where provider-specific quirks live (Linear's `success: false`,
   * Slack's `ok: false`, GitHub's `422` vs `404`, etc.).
   *
   * `request` is passed back so the adapter can correlate
   * action and endpoint with the outcome metadata.
   */
  interpret(
    response: WritebackResponse<TResponse>,
    request: WritebackRequest<TBody>,
  ): WritebackOutcome;

  /**
   * Optional. Extra headers the adapter wants on every request (e.g.
   * Notion's `Notion-Version`, GitHub's `X-GitHub-Api-Version`).
   * Merged with `request.headers` at transport time, with request
   * headers taking precedence.
   */
  buildDefaultHeaders?(): Record<string, string>;
}

/**
 * Public capability helper. This is intentionally limited to provider and path
 * matching; it does not consult workspace integration state or secrets.
 */
export interface WritebackCapabilityRegistry {
  canWriteback(provider: string, path: string): boolean;
  adapterForPath(provider: string, path: string): WritebackAdapter | null;
}
```

### One registry, both call sites

The `REGISTRY` is the single source of truth for "what providers are wired" and "what paths each provider supports." **Every code path that needs to answer either of those questions reads from the registry — no provider-specific switches, no per-call-site regex literals.**

This is the load-bearing constraint that prevents the [motivating incident](#motivating-incident-linear-writeback-gate-vs-bridge-drift) from recurring. The two call sites today are:

1. **Upstream gate** in `cloud/packages/relayfile/src/writeback/provider-executor.ts` (Cloudflare Workers) — runs first, decides whether to dispatch at all. Currently has its own `getUnsupportedReason()` switch with `notion` / `github` regex literals.
2. **Dispatch + execution** in `cloud/packages/web/lib/integrations/relayfile-writeback-bridge.ts` (Next.js Lambda) — runs second, actually calls the provider. Currently has its own `executeXWriteback` per provider.

Under the contract, both reduce to:

```ts
// Shared library, importable from both Workers + Lambda contexts
import type { WritebackAdapter } from "@relayfile/adapter-core/writeback";
import { githubWritebackAdapter } from "@relayfile/adapter-github/writeback-adapter";
import { linearWritebackAdapter } from "@relayfile/adapter-linear/writeback-adapter";
import { notionWritebackAdapter } from "@relayfile/adapter-notion/writeback-adapter";
import { slackWritebackAdapter  } from "@relayfile/adapter-slack/writeback-adapter";

export const REGISTRY: Readonly<Record<string, WritebackAdapter>> = Object.freeze({
  github: githubWritebackAdapter,
  linear: linearWritebackAdapter,
  notion: notionWritebackAdapter,
  slack:  slackWritebackAdapter,
});

export function pathIsWritable(provider: string, path: string): boolean {
  const adapter = REGISTRY[provider];
  return Boolean(adapter && adapter.pathMatchers.some((rx) => rx.test(path)));
}

export function canWriteback(provider: string, path: string): boolean {
  return pathIsWritable(provider, path);
}

export function adapterForPath(provider: string, path: string): WritebackAdapter | null {
  const adapter = REGISTRY[provider];
  if (!adapter) return null;
  return adapter.pathMatchers.some((rx) => rx.test(path)) ? adapter : null;
}
```

```ts
// provider-executor.ts — the upstream gate
if (!pathIsWritable(provider, path)) {
  return ackUnsupported(`unsupported ${provider} writeback path: ${path}`);
}
```

```ts
// relayfile-writeback-bridge.ts — the dispatch + execution
const adapter = REGISTRY[providerFromPath(input.path)];
if (!adapter) return permanentFailure(integration.provider, "unsupported_provider", ...);

const request = adapter.resolve(input);
const headers = { ...adapter.buildDefaultHeaders?.(), ...request.headers };
const response = await proxyThroughNango({ ...request, headers });
const outcome = adapter.interpret(response, request);
const retryHint = parseRetryAfter(response.headers);
return ackWithRetryHint(outcome, retryHint);
```

Adding a new provider:

1. Write the adapter package (`@relayfile/adapter-<x>/writeback-adapter`).
2. Add **one** import + **one** registry entry to the shared file.
3. Done. Both the gate and the dispatch pick it up.

You cannot add it to one and forget the other — there's only one place to add it. The provider-executor's `LINEAR_WRITEBACK_PATH` regex literal that necessitated [cloud#467](https://github.com/AgentWorkforce/cloud/pull/467) wouldn't exist; `pathIsWritable("linear", path)` would consult `linearWritebackAdapter.pathMatchers` directly.

### The cloud-side reduction

The provider-specific functions in `relayfile-writeback-bridge.ts` (~360 lines today) shrink to ~30 lines of generic transport plus a `REGISTRY` import. The `getUnsupportedReason` switch in `provider-executor.ts` collapses to a single `pathIsWritable` call.

## Migration Plan

Per-adapter migration is independent. Order from cheapest to most invasive:

### Phase 0 — Land core writeback protocol

1. Add `packages/core/src/writeback/` with the types above and a thin runtime barrel for `permanentFailure` / `retryableFailure` / `successResult` constructors.
2. Export the entrypoint from `@relayfile/adapter-core/writeback`.
3. Keep this entrypoint free of schema-generation imports so Workers and Lambda can import it without pulling in the heavier adapter-core runtime graph.
4. Add a Cloudflare Workers smoke test before Phase 1 depends on the entrypoint.

### Phase 1 — Slack as the proving ground

Slack has no cloud-side wiring today, so we get to write the new shape from scratch without breaking anything. See [Slack adapter outline](#slack-adapter-outline) below. After Phase 1 ships:

- `@relayfile/adapter-slack` exports `slackWritebackAdapter: WritebackAdapter` alongside the existing `resolveWritebackRequest` (kept for backward compat).
- Cloud bridge gets the `REGISTRY` skeleton with **only** Slack populated, behind a feature flag (`RELAYFILE_USE_ADAPTER_PROTOCOL`). Existing executeXWriteback functions remain for the other three providers.
- New Slack writebacks flow through the contract end-to-end. Old providers untouched.

### Phase 2 — Linear, Notion (smallest existing executors)

For each of Linear and Notion:

1. Add a `<provider>WritebackAdapter` export to the adapter package that wraps the existing `resolveWritebackRequest` + the response-interpretation logic that currently lives in cloud.
2. Add the adapter to the cloud `REGISTRY`.
3. Flip the dispatch from `executeXWriteback` to `REGISTRY[provider]` for that provider only — **and** swap the provider's branch in `provider-executor.ts:getUnsupportedReason()` for a `pathIsWritable(provider, path)` call against the same registry. The two flips happen in the same PR; otherwise the gate and the bridge can drift again, exactly the way they drifted in the [motivating incident](#motivating-incident-linear-writeback-gate-vs-bridge-drift).
4. Delete the cloud-side `executeXWriteback` and its provider-specific extractors. Delete the provider's regex literal in `provider-executor.ts` (e.g. `LINEAR_WRITEBACK_PATH`).

The cloud-side test changes are minimal — the test asserts on the `RelayfileWritebackExecutionResult` shape, not on which function produced it. We keep the existing `tests/relayfile-writeback-bridge.test.ts` cases and migrate the response-shape assertions into adapter-package unit tests where they belong. `provider-writeback-executor.test.ts` keeps its supported and unsupported path tests, but they now exercise the registry path rather than provider-specific regex literals.

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
// file:packages/slack/src/writeback-adapter.ts
import type {
  WritebackAdapter,
  WritebackInput,
  WritebackOutcome,
  WritebackRequest,
  WritebackResponse,
} from "@relayfile/adapter-core/writeback";

import { resolveWritebackRequest } from "./writeback.js";
import type { SlackWritebackRequest } from "./types.js";

type SlackWritebackBody = SlackWritebackRequest["body"];

const SLACK_PATH_MATCHERS = [
  /^\/slack\/channels\/[^/]+\/messages\/new\.json$/,
  /^\/slack\/channels\/[^/]+\/messages\/[^/]+\/replies\/new\.json$/,
  /^\/slack\/channels\/[^/]+\/messages\/[^/]+\/reactions\/new\.json$/,
];

export const slackWritebackAdapter: WritebackAdapter<SlackWritebackBody, SlackResponseBody> = {
  provider: "slack",
  pathMatchers: SLACK_PATH_MATCHERS,

  resolve(input: WritebackInput): WritebackRequest<SlackWritebackBody> {
    const req: SlackWritebackRequest = resolveWritebackRequest(input.path, input.content);
    return {
      action: req.action,
      method: req.method,
      endpoint: req.endpoint,
      body: req.body,
    };
  },

  interpret(
    response: WritebackResponse<SlackResponseBody>,
    request: WritebackRequest<SlackWritebackBody>,
  ): WritebackOutcome {
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
    // is the canonical id for downstream reactions and replies.
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

## What this spec doesn't fix

Honest scope-limiting so reviewers don't expect the contract to do more than it does.

- **Sync (incoming) is a separate flow with its own per-provider switches.** [cloud#465](https://github.com/AgentWorkforce/cloud/pull/465) wired Notion into `record-writer.ts`'s sync dispatch; Linear has its own there. Adding a provider today touches both writeback and sync. The contract proposed here addresses writeback only. A sister `SyncAdapter` contract (or extending `WritebackAdapter` to a generic `ProviderAdapter`) is plausible follow-on work but is **out of scope for this spec**.
- **Schema / database surface for new integrations.** Adding a provider also touches: `workspace_integrations` enum and check constraints, Nango `provider_config_key` normalization, auth scope tables, and any provider-listing UI. None of those read from this registry today. The contract could grow a `providerMetadata` field to drive some of them, but the database-migration path is its own work.
- **Path-mapper / webhook normalizer / sync record routing.** Out of scope per [Non-Goals](#non-goals); just calling out explicitly so it's clear the registry is not a one-stop shop.
- **Cross-runtime importability is an assumption that needs verification.** The two writeback call sites today run in different deployment targets (Cloudflare Workers and Next.js Lambda). The spec assumes `@relayfile/adapter-core/writeback` and the per-provider adapter packages can be imported from both. Workers' module-resolution constraints (no Node built-ins, ESM-only, no dynamic require) need a smoke test in Phase 0 before Phase 1 adapters depend on it.

The "two-files-with-the-same-switch" pattern in the [motivating incident](#motivating-incident-linear-writeback-gate-vs-bridge-drift) almost certainly recurs in those other surfaces. Closing them off is its own design work.

## Resolved Decisions

1. **Package home for the protocol types: `@relayfile/adapter-core/writeback`.** The protocol belongs in core, not a new `@relayfile/adapter-protocol` package. To keep the cloud import lightweight, the writeback subpath must stay isolated from adapter-core's schema-generation runtime imports.

2. **`WritebackRequest.body` is typed.** `WritebackRequest<TBody = unknown>` and `WritebackAdapter<TBody, TResponse>` let adapters preserve provider-specific body types while the generic cloud transport can still treat the body opaquely.

3. **Retry-after is handled by transport.** The bridge parses `Retry-After` from `WritebackResponse.headers` with `parseRetryAfter()` and passes that hint to the retry queue. Adapters should not copy retry scheduling data into `WritebackOutcome.metadata`.

4. **Capability discovery is part of v1.** The shared registry exposes `canWriteback(provider, path)` and `adapterForPath(provider, path)` so the upstream gate, bridge, and workflow-engine callers use the same provider and path support checks.

## Estimated Effort

| Phase | Scope | Risk |
|---|---|---|
| 0 — core writeback protocol | New `@relayfile/adapter-core/writeback` entrypoint, types + helpers | Low |
| 1 — Slack adapter | New code only; no existing surface to break | Low–Medium |
| 2 — Linear + Notion | Two adapters, two cloud `REGISTRY` flips, deletions | Medium (touches the live demo flow) |
| 3 — GitHub | Heaviest existing executor; two-path dispatch | Medium |
| 4 — flag removal | Mechanical | Low |

Total ~1–2 weeks of focused work, gated behind the feature flag for safe staged rollout.
