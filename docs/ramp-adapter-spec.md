# `@relayfile/adapter-ramp` — implementation spec

Status: ready to implement. Owner: unassigned. Driver: Gil (usegil) design partner —
Ramp is the first integration on their list that Relayfile does not broker today.

Read [`AGENTS.md`](../AGENTS.md) first. This spec assumes the adapter contract described
there (path-mapper, `LAYOUT.md`, `_index.json`, alias trees, declared catalogs, writeback
discovery) and only records the Ramp-specific decisions.

## 1. Goal and scope

Mount a Ramp business as a filesystem so a finance agent can `cat` a bill, a purchase
order, or a transaction — and, in phase 3, code a transaction or draft a bill by writing
a file.

**In scope** (the design-partner resources, plus the dimension reads that make them
legible): bills, item receipts, purchase orders, reimbursements, transactions, vendor
agreements, vendors, receipts, transfers, repayments, and the entity / user /
department / location / merchant / spend-program / GL-account dimension tables. Payment
data is surfaced inside the owning bill record; there is no standalone
`/ramp/payments/` resource.

**Out of scope**: cards, card vault, limits, funds, treasury balances, spend programs
beyond a read-only dimension mount, `/developer/v1/statements` (see §3), incorporation,
sourcing, trips, x402, and anything requiring `cards:read_vault`.

## 2. Provider facts

| Fact | Value |
|---|---|
| Base URL | `https://api.ramp.com` (sandbox `https://demo-api.ramp.com`) |
| API root | `/developer/v1` |
| Nango provider slugs | `ramp`, `ramp-sandbox` (both `OAUTH2`, `authorization_method: header`) |
| Authorization URL | `https://app.ramp.com/v1/authorize` (sandbox `https://demo.ramp.com/v1/authorize`) |
| Token URL | `https://api.ramp.com/developer/v1/token` |
| Grant type | `authorization_code` — **not** `client_credentials`, which only reaches the app owner's own Ramp business |
| Pagination | `?start=<cursor>&page_size=<n>`; response is `{ data: [...], page: { next: string \| null } }` where `next` is a full URL. Follow `page.next` until null. |
| Machine-readable contract | `https://docs.ramp.com/openapi/developer-api.json` — per-operation `security` blocks name the exact scope for every endpoint. Snapshot it under `scripts/integration-contracts/ramp/source/` (see §8). |

Ramp's OpenAPI is complete enough to drive `contractEndpoint(...)` writeback schemas —
this adapter should be **contract-backed, not inline**, unlike most of the existing table
in `docs/writeback-spec-coverage.md`.

## 3. Scopes

Canonical list lives in [`docs/integration-scopes.yaml`](./integration-scopes.yaml)
under `slug: ramp`. Do not restate it in code comments; import the intent, not the list.

Three traps that will otherwise cost an afternoon:

- **There is no `payments:*` scope.** Ramp's webhook guide says verbatim: "Payments —
  No public OAuth scope". Payment data is read through `bills:read` (including
  `/bills/{bill_id}/remittance-receipt`), `reimbursements:read`, `transfers:read`, and
  `repayments:read`.
- **There is no `vendor_agreements:*` scope.** `/developer/v1/vendors/agreements/*` is
  gated by `vendors:read` / `vendors:write`, even though the webhook event family is
  named `vendor_agreements.*`.
- **`statements:read` is excluded.** It exists in the published OpenAPI and in the app
  scope picker, but was reported unavailable on the design partner's app registration.
  Treat `/developer/v1/statements` as out of scope until that is resolved; do not build a
  statements resource that dies on a 403 for the first customer.

Webhook management requires **no specific OAuth scope**, but it still requires a valid
OAuth access token. The `/developer/v1/webhooks*` operations currently ship an `oauth2`
security requirement with an empty scope list in the OpenAPI.

## 4. VFS layout

Root `/ramp`. One tree per business (a Nango connection == one Ramp business).

```text
/ramp/LAYOUT.md
/ramp/_index.json
/ramp/business.json                                  # GET /business
/ramp/bills/<bill_id>__<slug>/meta.json              # directory record — owns documents
/ramp/bills/<bill_id>__<slug>/documents/_index.json
/ramp/bills/by-invoice-number/<slug>__<id>.json
/ramp/bills/by-vendor/<vendor-slug>/<slug>__<id>.json
/ramp/bills/by-status/<status>/<slug>__<id>.json
/ramp/purchase-orders/<po_id>__<slug>/meta.json      # directory record — line items + linked docs
/ramp/purchase-orders/by-number/…  by-vendor/…  by-receipt-status/…
/ramp/item-receipts/<receipt_id>__<slug>/meta.json   # directory record — owns documents
/ramp/item-receipts/by-number/…  by-purchase-order/…
/ramp/vendor-agreements/<agreement_id>__<slug>/meta.json   # directory record — owns documents
/ramp/vendor-agreements/by-name/…  by-renewal-status/…
/ramp/transactions/<slug>__<id>.json                 # flat — receipts live in their own resource
/ramp/transactions/by-merchant/…  by-state/…
/ramp/reimbursements/<slug>__<id>.json               # flat
/ramp/reimbursements/by-user/…  by-state/…
/ramp/receipts/<slug>__<id>.json                     # flat
/ramp/receipts/by-transaction/…  by-reimbursement/…
/ramp/vendors/<slug>__<id>.json                      # flat
/ramp/vendors/by-name/…
/ramp/transfers/<slug>__<id>.json
/ramp/repayments/<slug>__<id>.json
/ramp/dimensions/entities/<slug>__<id>.json
/ramp/dimensions/users/<slug>__<id>.json             # by-email/ alias
/ramp/dimensions/departments/<slug>__<id>.json
/ramp/dimensions/locations/<slug>__<id>.json
/ramp/dimensions/merchants/<slug>__<id>.json
/ramp/dimensions/spend-programs/<slug>__<id>.json
/ramp/accounting/accounts/<slug>__<id>.json
/ramp/accounting/fields/<slug>__<id>.json
```

**Directory vs flat rule applied here**: an entity gets a directory record + `meta.json`
only when it owns child *files*. Bills (`invoice_urls`), item receipts (`documents`), and
vendor agreements (attached documents) do. Transactions and reimbursements reference
receipts *by id* into `/ramp/receipts/`, so they stay flat and get `by-transaction/` /
`by-reimbursement/` alias trees on the receipts resource instead. Do not duplicate receipt
bodies into two trees.

**Payments are not a resource.** There is no `/ramp/payments/` directory. A bill's
`payment` object is materialized inside the bill record; `payments.updated` webhooks
resolve to the owning bill. Say this explicitly in `LAYOUT.md` — an agent that goes
looking for `/ramp/payments/` should find the answer in the layout guide, not in a 404.

### Titles, slugs, and `updated`

`_index.json` rows need `{ id, title, updated }`. Ramp is inconsistent about update
timestamps, so define one fallback chain per resource and test it:

| Resource | `title` from | `updated` fallback chain |
|---|---|---|
| bills | `invoice_number` (fall back to `vendor.name`) | `paid_at ?? issued_at ?? created_at` |
| purchase-orders | `purchase_order_number` (fall back to `name`) | `archived_at ?? created_at` |
| item-receipts | `item_receipt_number` | `archived_at ?? received_at ?? created_at` |
| vendor-agreements | `name` | `updated_at ?? created_at` |
| transactions | `merchant_name` | `updated_at ?? settlement_date ?? user_transaction_time` |
| reimbursements | `merchant` (fall back to `user_full_name`) | `updated_at ?? submitted_at ?? created_at` |
| vendors | `name` | `updated_at`-less → `created_at` |
| receipts | `<transaction_id or reimbursement_id>` | `created_at` |

Indexes stay sorted by `updated` descending. Slugs go through
`packages/core/src/alias-slug.ts` — never a local slugifier. Ramp IDs are UUIDs; do not
normalize them.

Useful natural-filter fields to add to index rows beyond the minimum, because they let an
agent answer common questions without opening every file: bills →
`status`, `sync_status`, `approval_status`, `amount`, `vendor.id`; transactions →
`state`, `sync_status`, `amount`, `merchant_id`, `card_holder.user_id`, `entity_id`;
reimbursements → `state`, `sync_status`, `user_id`; purchase-orders →
`receipt_status`, `billing_status`, `vendor_id`.

## 5. `path-mapper.ts`

Export a typed compose + parse helper per canonical path above. Round-trip tests
(compose → parse → equality) are required for each. Consumers must never concatenate a
Ramp path by hand.

Note that `docs/MAPPING_YAML_SPEC.md` still documents a legacy
`/<provider>/<type>/<id>/metadata.json` convention. That is historical scaffolding —
`meta.json` (directory records) and flat `.json` are authoritative per `AGENTS.md`. If you
generate anything from a mapping YAML, fix the template rather than the path-mapper.

## 6. Sync (`resources.ts` reads)

One list endpoint per resource, all cursor-paginated. Use `entity_id` as the primary
scope filter and the `from_*`/`to_*`/`*_after` params for incremental sync:

- bills → `GET /bills` (`from_created_at`, `to_created_at`, `entity_id`)
- item receipts → `GET /item-receipts` (`purchase_order_id`, `include_archived`)
- purchase orders → `GET /purchase-orders` (`from_created_at`, `include_archived`)
- reimbursements → `GET /reimbursements` (`updated_after`, `from_date`, `to_date`)
- transactions → `GET /transactions` (`from_date`, `to_date`, `synced_after`, `include_merchant_data=true`)
- vendors → `GET /vendors` (`from_updated_at`)
- vendor agreements → hydrate from `vendor_agreements.*` webhooks and
  `GET /vendors/agreements/{agreement_id}`; there is no top-level list endpoint
- receipts → `GET /receipts` (`created_after`; `include_ocr_data` opt-in)
- transfers → `GET /transfers`, repayments → `GET /repayments`
- dimensions → `GET /entities`, `/users`, `/departments`, `/locations`, `/merchants`, `/spend-programs`
- accounting → `GET /accounting/accounts`, `GET /accounting/fields`

`supportedScopeKeys()`: `entityId`, `vendorId`, `userId`, `departmentId`, `locationId`,
`since`. These are persona-facing filters only — never `connectionId` or token fields.

## 7. Webhooks and `inbound.ts`

Ramp webhooks arrive **through Hookdeck**, the same ingress pattern as GitLab — not through
Nango. Nango's `ramp` provider entry carries auth and proxy config only, with no webhook
routing script, so there is nothing to route through it. Register the subscription against
`POST /developer/v1/webhooks` with the **Hookdeck source URL** as `endpoint_url`, and let
Hookdeck fan out to the relayfile ingress.

Two consequences of putting Hookdeck in front:

- The verification handshake (below) is answered by whatever sits behind Hookdeck, so the
  Hookdeck source must be live and forwarding *before* the subscription is created —
  otherwise the subscription sits in `pending_verification` forever.
- Ramp's own retry budget is spent against Hookdeck, not against us. Hookdeck's retries to
  our destination are separate and carry a stable `x-hookdeck-eventid`; see the identity
  discussion below.

Delivery mechanics that the normalizer must respect:

- **Payloads are thin**: `{ id, type, created_at, business_id, object: { id } }`. The
  normalizer resolves `object.id` + `type` to a VFS path and the sync layer re-fetches the
  full resource. This is why the read scope for a resource is what actually makes its
  events useful.
- **Signature**: `X-Ramp-Signature` — HMAC-SHA256 over the *raw* request body, keyed by the
  per-subscription `secret` returned when the subscription is created. Verify before
  parsing, and keep the raw bytes (`evidence.rawBodySha256` depends on them).
- **Verification handshake**: a new subscription lands in `pending_verification`; Ramp
  POSTs a challenge, and the endpoint must answer via
  `POST /developer/v1/webhooks/{webhook_id}/verify`. `webhooks.verification` and
  `tests.test_event` are transport-level — handle them in the ingress, and keep them **out**
  of `supportedEvents()`.
- **Retries and ordering**: up to 10 retries with exponential backoff on 429/5xx, same
  event `id` each time; events may arrive out of order (`transactions.cleared` before
  `transactions.authorized`). Always re-fetch current resource state rather than applying
  the event as a delta. Respond 2xx within 10s.
- **Multi-tenant**: `business_id` in the payload is the only tenant discriminator. Route on
  it; do not assume one subscription per connection.

### Logical-event identity

Per [`docs/inbound-capability-contract.md`](./inbound-capability-contract.md), delivery
identity is read **only from headers named by the adapter declaration**, and a payload
business identifier such as a generic `eventId` is never implicitly promoted to transport
identity. Ramp puts its retry-stable `id` in the **body** and ships no delivery-ID header of
its own, so tier 1 of the hierarchy is unavailable. Hookdeck supplies tier 3.

Declare both capabilities, modelled directly on `packages/gitlab/src/inbound.ts`:

```ts
export const inboundCapabilities = defineInboundCapabilities([
  defineNangoInboundCapability({
    id: "ramp.nango",
    providerId: "ramp",
    pathRoot: "/ramp",
    providerConfigAliases: RAMP_PROVIDER_CONFIG_ALIASES,
  }),
  defineHookdeckInboundCapability({
    id: "ramp.hookdeck",
    providerId: "ramp",
    pathRoot: "/ramp",
    providerConfigAliases: RAMP_PROVIDER_CONFIG_ALIASES,
    detectionHeaders: ["x-ramp-signature"],
    // Ramp ships no provider delivery-id header — omit providerDeliveryIdHeaders
    // rather than inventing one or promoting the body `id`.
    hookdeckDeliveryIdHeaders: ["x-hookdeck-eventid"],
  }),
]);
```

`providerDeliveryIdHeaders` is optional in the core types; **omit it**. Do not map Ramp's
body `id` into it — that is exactly the implicit promotion the contract forbids, and the
next reader will otherwise "fix" your correct declaration. Leave a comment saying so.

`x-ramp-signature` is Ramp's only distinctive header, which makes it the detection key.
Hookdeck forwards original request headers, so it survives the hop.

**Known narrow gap, document it in code:** `x-hookdeck-eventid` is stable across *Hookdeck's*
retries to our destination, but a *Ramp-side* retry (which fires only when Hookdeck itself
returns 429/5xx or times out) creates a new Hookdeck event with a new id. In that window,
the same Ramp event can produce two logical keys. Ramp's body `id` is the only thing stable
across Ramp retries, so dedupe on it at the claim/idempotency layer — not by promoting it to
transport identity. The exposure is small (it requires a Hookdeck ingest failure), but a
claim owner that silently double-processes a `bills.paid` is not acceptable in a finance
integration.

`supportedEvents()` — the full business-event set from Ramp's guide, minus the two
transport events: `bills.approved|archived|created|paid|ready_to_sync|rejected|updated`,
`item_receipts.created`, `payments.updated`, `purchase_orders.archived|created|updated`,
`reimbursements.batch_payment_reimbursed|ready_for_review|ready_to_sync|sync_requested`,
`transactions.all_requirements_met_and_approved_changed|authorized|body_coding_updated|cleared|declined|ready_for_review|ready_to_sync|receipt_added|sync_requested|synced`,
`vendor_agreements.archived|created|deleted|document_added|renewal_milestone|updated`,
`vendors.activated|approved|updated`, `entities.created`, `users.invite_accepted`,
`unified_requests.*`, `spend_requests.comment_created|created`, `applications.status_updated`.

Note `bills.updated` does **not** fire for approvals or payments — subscribe to
`bills.approved` and `bills.paid` for those.

## 8. Writeback (phase 3)

File-native semantics per `AGENTS.md`: create by writing a valid JSON document to any
non-canonical filename in the resource directory, edit by writing mutable fields to the
canonical record, delete by removing it. **No magic `new.json`.** `idPattern` regexes must
match the `<slug>__<id>` tail form, not a bare UUID filename.

| VFS write | Ramp call | Scope | Notes |
|---|---|---|---|
| new doc in `/ramp/bills/drafts/` | `POST /bills/drafts` → `POST /bills/drafts/{id}/submit` | `bills:write` | only `vendor_id` is required at draft time; submit is a second, explicit step — model it as its own resource, not an implicit side effect |
| edit `/ramp/bills/<id>__<slug>/meta.json` | `PATCH /bills/{bill_id}` | `bills:write` | |
| new doc in `/ramp/purchase-orders/` | `POST /purchase-orders` | `purchase_orders:write` | requires `currency`, `entity_id`, `line_items`, `three_way_match_enabled` |
| new doc in `/ramp/item-receipts/` | `POST /item-receipts` | `item_receipts:write` | requires `item_receipt_line_items`, `item_receipt_number`, `purchase_order_id`, `received_at` |
| edit `/ramp/transactions/<slug>__<id>.json` | `PATCH /transactions/{transaction_id}` | `transactions:write` | **the request body accepts `line_items` only** — accounting coding lives on line items, not on the transaction body |
| write `/ramp/transactions/<slug>__<id>/memo.json` | `POST /memos/{transaction_id}` | `memos:write` | requires `memo`; `is_memo_recurring` optional. Lowest-risk write in the whole surface — good first end-to-end proof |
| new doc in `/ramp/reimbursements/mileage/` | `POST /reimbursements/mileage` | `reimbursements:write` | requires `distance`, `reimbursee_id`, `trip_date` |

Deliberately **not** wired: `vendors:write`. `POST /vendors/{vendor_id}/update-bank-accounts`
sits behind the same scope as benign vendor edits, which makes vendor writeback a
payment-redirection surface. If a design partner needs it, it goes behind an explicit
human-approval gate, not a file write.

Each writeback resource needs, per the writeback discovery contract: a `src/resources.ts`
entry (resource path, schema path, create example path, `idPattern`), a `.schema.json`
(draft 2020-12, **full synced record shape**, field-level descriptions, provider enums as
`enum`, server-managed fields — `id`, `created_at`, `updated_at`, `ramp_url`,
`deep_link_url`, `_webhook`, `_connection` — marked `"readOnly": true`), and a
`.create.example.json` omitting read-only fields.

Source these schemas from the Ramp OpenAPI via `contractEndpoint(...)` /
`scripts/writeback-contracts.mjs`, with a manifest under
`scripts/integration-contracts/ramp/` and the full spec nested in `source/`. Then update
`docs/writeback-spec-coverage.md` with the contract-backed / inline counts in the same PR.

## 9. Files to create

```text
packages/ramp/
  package.json               # no "private", version field present, do NOT bump versions in the feature PR
  tsconfig.json
  ramp.mapping.yaml
  src/
    index.ts  types.ts  path-mapper.ts  queries.ts  resources.ts
    webhook-normalizer.ts  writeback.ts  inbound.ts
    layout.ts  layout-prompt.ts  index-emitter.ts  emit-auxiliary-files.ts
    digest.ts  summary.ts  sync-bucketing.ts
  discovery/ramp/.adapter.md
```

Model the package on `packages/linear` (full-featured, has `inbound.ts`) rather than
`packages/fathom` (read-only, no inbound declaration).

## 10. Regenerate and verify

```bash
npx turbo build
npx adapter-core triggers generate
npx adapter-core scope-keys generate
npx adapter-core writeback-paths generate
npx adapter-core inbound generate
node scripts/generate-writeback-discovery.mjs   # after updating scripts/writeback-discovery-data.mjs
npm run gen -w @relayfile/relay-helpers          # new writeback provider ⇒ regenerate clients
node scripts/resolve-publish-targets.mjs all     # confirm packages/ramp is discovered
npx turbo build typecheck test                   # must pass before the PR
```

CI regenerates and diffs each catalog, so a declaration change without a regenerate fails
the build. Add `ramp` to a `GROUPS` alias in `scripts/resolve-publish-targets.mjs` if a
`finance` group is introduced (optional).

## 11. Tests

- Round-trip test per path-mapper helper.
- Collision test per alias subtree (`aliasCollisionSuffix`, deterministic across runs —
  never first-writer-wins).
- `LAYOUT.md` non-empty test: ≥1000 bytes plus key-substring assertions, including the
  "there is no `/ramp/payments/`" explanation.
- Webhook normalizer: one fixture per event family, plus an out-of-order pair
  (`cleared` before `authorized`) asserting the later fetch wins.
- Signature verification: valid, tampered-body, and wrong-secret cases against raw bytes.
- Pagination: a two-page `page.next` fixture asserting the cursor is followed and results
  are not truncated.
- `updated` fallback chain: one case per resource in the §4 table, including the
  null-`updated_at` path.
- Index ordering: `updated` descending.

## 12. Cross-repo follow-up (cloud) — required for proactive agents

Shipping this package alone does **not** make `ramp:transactions.cleared` a usable persona
trigger. Cloud keeps its own registry, and anything outside it throws on
`relayfilePathsForTrigger` — `agentworkforce deploy` returns
`400 unsupported_trigger`. After this adapter publishes, cloud needs:

1. `packages/core/src/relayfile/provider-contracts.ts` — a `ramp` entry (`root: "/ramp"`,
   `aliases: ["ramp-relay"]`, `resources` imported from the adapter,
   `triggerEvents: KNOWN_TRIGGER_CATALOG.ramp`, and a `triggerGlobs` mapping each event
   family to its subtree, e.g. `transactions.*` → `["/ramp/transactions/**"]`).
2. `packages/web/lib/integrations/providers.ts` — a provider entry
   (`id: "ramp"`, `defaultConfigKey: "ramp-relay"`, `vfsRoot: "/ramp"`,
   `backend: "nango"`, `backendIntegrationId: "ramp-relay"`).
3. A `@relayfile/adapter-core` dep bump in cloud — catalog changes only reach consumers on
   the next bump.

Mention this follow-up in the adapter PR body per the cross-repo coordination rule.

**Interim, before cloud lands**: an integration `scope` still mounts (`relayfilePathsFromScope`
takes the glob verbatim without provider validation), so a persona can read `/ramp/**` and
wake on a `schedules:` sweep of the mounted tree instead of a webhook trigger. Pair the
sweep with both a time window contiguous with the cadence and a workspace-memory seen-set —
see `sales/proposal-agent/agent.ts` for the pattern.

## 13. Phasing

| PR | Contents | Proves |
|---|---|---|
| 1 | package scaffold, path-mapper, queries, index/alias emitters, `LAYOUT.md`, read-only sync for the seven resources + dimensions | an agent can `cat` a bill and a transaction |
| 2 | `webhook-normalizer.ts`, `inbound.ts`, signature verification, subscription registration + verification handshake | events land and resolve to paths |
| 3 | writeback resources, contract-backed schemas, discovery regeneration, `writeback-spec-coverage.md` | memo write → visible in Ramp; then transaction coding |
| 4 | cloud provider-contract + providers.ts + dep bump | `ramp:*` works as a persona trigger |

## 14. Environment promotion (sandbox → production)

Sandbox and production are **two different Nango provider entries** (`ramp-sandbox` and
`ramp`), which means two integrations, two config keys, two Ramp app registrations, and two
sets of client credentials. Promotion is not a flag flip, and connections do not migrate —
every customer re-consents against the production app.

Implementation constraints that follow, and that you must honour from PR 1:

- **Never hardcode a base URL.** `https://api.ramp.com` vs `https://demo-api.ramp.com` comes
  from the Nango connection / proxy config. One codebase serves both environments; a
  hardcoded host means a second code path later.
- **Provider-config aliases must cover both.** `RAMP_PROVIDER_CONFIG_ALIASES` should include
  the sandbox key (e.g. `ramp`, `ramp-relay`, `ramp-sandbox-relay`) so inbound classification
  resolves either environment to the same `/ramp` root.
- **Webhook subscriptions and secrets are per-environment.** The subscription is created
  against whichever API host the connection points at, and the `secret` returned at create
  time is unique to that subscription. A sandbox signing secret is dead in production.
  Never bake a secret into a fixture that also runs against prod.
- **Scope parity is not inherited.** Ramp rejects the *entire* authorize request with
  "Unavailable scope was requested" if a single requested scope is not enabled on that
  specific app registration. Sandbox parity proves nothing about the prod app — re-verify
  the toggles against `required_scopes` in `docs/integration-scopes.yaml` before cutting
  over. This has already bitten us once.
- **First prod sync is a full backfill**, not a delta. The sandbox tree is throwaway.

**Testing without a real business:** the Ramp sandbox UI (`demo.ramp.com`) has a demo-actions
panel at `⌘J` that simulates transactions being created, bills being marked paid, and
reimbursements being marked paid — each requires a matching role (bill payment needs Admin,
Business Owner, or AP Clerk). That is the event stream PR 2's normalizer, signature
verification, and out-of-order tests should be built against. Do not block on production
access to write PR 2.

Ramp gates production access behind its own partner review — approval is required before
production credentials are issued, and the review is largely a security-disclosure exercise
(SOC 2 Type II / ISO 27001 / PCI or a recent third-party pen test, data-handling
descriptions, public security policy, monitored security contact). That application belongs
to whoever owns the branded OAuth app, not to this repo. It runs in parallel with PRs 1–3
and should not block them.

## 15. Open questions

- Whether a third-party app needs Ramp partner review before customer businesses can grant
  it — only Admin/Business Owner roles can authorize third-party apps. Confirm with Ramp
  before promising a customer-facing white-label connect flow.
- Whether `statements:read` becomes available on the design partner's app (§3). If it does,
  `/ramp/statements/` is a small additive resource.
- `GET /unified-requests` returned an empty item schema in the published OpenAPI — capture
  a live sample before modeling approval-flow records.
