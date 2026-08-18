# Changelog

Cross-package release notes for the relayfile adapters workspace. Curate
`[Unreleased]` as PRs land. The publish workflow does not touch this file, so
the release cut is manual: when you run a release, rename `[Unreleased]` to the
published version with a date and open a fresh empty `[Unreleased]` above it.

## [Unreleased]

### Added

- `@relayfile/adapter-linear` now materializes `/linear/issues/by-project/<project-id>/<identifier>.json` aliases so project-scoped consumers can avoid mounting the full issue tree.
- `@relayfile/adapter-granola` now publishes Granola's current `note.generated`, `note.edited`, and `note.access_granted` webhook events in the known-trigger catalog, replacing the stale `recording.created` label so autocomplete and lint match upstream webhook semantics.
- `@relayfile/adapter-posthog` now provides read-only project-scoped materialization with canonical slug-and-ID paths, stable indexes and aliases, alert webhook normalization, digest visibility, and generated trigger and scope-key catalogs.
- `@relayfile/adapter-core/inbound` now publishes a version-hashed, provider-owned Nango/Hookdeck capability catalog, deterministic cross-runtime `logicalEventKey`, and exact golden vectors; incomplete Nango sync-page identities are rejected, and GitLab Hookdeck prefers `x-gitlab-event-uuid` before falling back to the Hookdeck delivery id.
- `@relayfile/gmail/identity` now declares `gmail` + `/gmail` as canonical, publishes `google-mail` provider/path migration aliases, and keeps compatibility digests readable across both roots while canonical resyncs drain legacy mounts.
- `@relayfile/gmail` now resolves draft writeback to Gmail's drafts API instead of collapsing it onto `messages.modify`: creates `POST` to `/gmail/v1/users/{account}/drafts`, updates `PUT` to `/gmail/v1/users/{account}/drafts/{draftId}`, and deletes address the draft id. `parseRelayfilePath` recognizes `drafts` under both the rootless (`/gmail/drafts/<id>.json`) and account-scoped (`/gmail/<account>/drafts/<id>.json`) forms across canonical and legacy roots.
- `@relayfile/gmail` now exports an additive, pure `/gmail` control contract for Cloud's Relayfile-first Gmail mount. It owns the bounded 13-action agent surface, canonical and by-id target resolution, payload fingerprints, minimum authorization/DWD requirements, and an explicit operator-only boundary; it neither executes nor persists Gmail writes.
- `@relayfile/adapter-github` can now backfill bounded repository commit history into a discoverable, newest-first `commits/_index.json` with canonical commit metadata paths, while push webhooks keep that index current.
- `@relayfile/relay-helpers` now exposes a process-scoped final-write authorizer that can deny or redirect every generic and bespoke helper write after explicit transport selection, preventing authored transports from bypassing immutable local preview policy.
- `@relayfile/relay-helpers` now exports an injectable `RelayTransport` and side-effect-free `PreviewTransport` with deterministic simulated receipts, seeded reads, process-scoped binding for existing no-argument clients, and cross-write thread-reference recording.
- Add authenticated GitHub pull-request create, ref push/update, and pull-request close writeback resources, selectable app/user PR authorship, plus live fail-closed merge-gate metadata on mounted pull requests.

### Breaking

- Writeback creation is now file-native. The reserved `new.json` create path is no longer special; create operations happen when an agent writes a valid JSON document to any non-canonical filename in a writable resource directory.
- Writeback dispatch is keyed by each resource's declared canonical `idPattern`: canonical `<id>.json` paths edit existing records, non-canonical filenames create new records, and deleting canonical files requests provider-side deletion.

### Migration

- See `docs/migration/file-native-writeback.md` for the new read/edit/create/delete contract, schema discovery flow, writeback status surface, and per-adapter draft filename examples.
- See `docs/migration/new-json-callers.md` for the Cloud and demo caller scan that identifies `new.json` write paths to migrate.

### Fixed

- `@relayfile/adapter-linear` issue creates now accept synced `team.id` and label ids directly, resolve `team.key`/`team.name` plus label names through mounted team/label indexes, and keep explicit `teamId`/`labelIds` authoritative; adapter-core now enforces the schema's at-least-one team reference.
- `@relayfile/adapter-github` now backfills label names into legacy issue `_index.json` rows from materialized issue artifacts, keeping label-filtered consumers on the index-only path.
- `@relayfile/adapter-core` direct HTTP create-draft writes now reuse the mount daemon's content identity, so a later mount echo coalesces onto the original revision and writeback operation instead of making its receipt context unreadable.
- `@relayfile/relay-helpers` GitHub and Linear create helpers now return a discriminated `confirmed`/`pending`/`dropped` result, preserve late-receipt writes as non-throwing `pending`, and never disguise a Relayfile draft path as a provider URL.
- `@relayfile/relay-helpers` final-write policies now compose monotonically in shared async scopes: authored rebinding cannot relax an outer denial or replace its canonical preview transport, overlapping Runs can be isolated, and out-of-order cleanup cannot resurrect stale policy.
- `@relayfile/relay-helpers` now names its rich recorded transport action `TransportPreviewAction`, matching the cross-package ownership boundary; the former `PreviewAction` export remains as a deprecated compatibility alias and does not claim the provider-neutral runtime type.
- GitHub ref writebacks now surface the nested provider `object.sha` as their receipt id, and pull-request creates use the PR number, so file-native callers can confirm both operations against canonical provider identities.
- `@relayfile/relay-helpers` now delegates Reddit subreddit parameters to `@relayfile/adapter-reddit`'s `normalizeSubreddit` helper, preserving lowercase canonical paths and optional `r/` prefixes while rejecting empty normalized values.
- Direct HTTP write admission now honors `Retry-After` up to 30 seconds for `workspace_busy` / `write_admission_limit` responses in the SDK's existing four-attempt retry layer, while preserving the prior two-second cap for other retryable responses. Implicit defaults are three seconds for receipt polling and 90 seconds for admission; an explicit `writebackTimeoutMs` bounds each phase independently, with `0` leaving admission unbounded and receipt polling disabled.

### Added

- GitHub pull indexes now surface `merged` and `mergedAt` across webhook, direct, and bulk ingestion paths so time-windowed consumers can identify merged pull requests without opening every `meta.json`.
- Added the Telegram adapter with typed path helpers, rich Bot API writeback resources for messages, reactions, callback answers, inline answers, commands, and menu buttons, plus optional event-sourced conversation history layout and discovery metadata.
- `normalizeWritebackStatus(result, entry?)` + `NormalizedWritebackState` (incl. `'no_receipt'`) and `NormalizedWritebackStatus` in `@relayfile/adapter-core` (and re-exported from the `vfs-client` subpath). Bridges high-level `WritebackResult` (receipt present/absent) with low-level `WritebackStatusEntry` outcomes. First-class support for agent debuggability (writeback no-receipt, W6) so runtime wrappers and terminal status taxonomies share a stable enum without per-adapter code. See updated `WritebackOutcome` and docs.
