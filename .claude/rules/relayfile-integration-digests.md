---
description: Provider adapters must keep Relayfile digest metadata and lifecycle state wired
paths:
  - packages/*/src/**
  - packages/*/test/**
  - packages/*/src/**/__tests__/**
---

# Relayfile integration digests

Relayfile digests are rendered generically upstream from workspace events. If an
adapter writes provider records that agents can read, the adapter must expose
stable record metadata and layout aliases that make those records summarizable
without provider-specific digest bullet code.

## Required for adapters

- Lifecycle verbs must be provider-aware. Explicitly classify terminal-state
  actions such as `closed`, `merged`, `archived`, `completed`, `canceled`, and
  `resolved`.
- Webhook ingestion must preserve terminal lifecycle state as record data.
  Do not convert `closed`/`merged`/`archived`/`completed` into deletion unless
  the upstream object was actually deleted.
- Keep the provider layout aligned with the category matrix in
  `docs/digest-layout-contract.md`. For example, issue-tracking resources must
  expose `by-state`, `by-assignee`, `by-creator`, and `by-priority`; CI/deploy
  resources must expose `by-status` unless the matrix documents an explicit
  exception.
- Run `npm run test:digest-contracts` whenever adding or materially changing an
  adapter, layout manifest, or category matrix entry.

## Provider-specific handlers

Adapters do not own provider-specific digest rendering. Do not add new
adapter-owned bullet renderers or require `DigestSection`-style output in the
adapter contract. Existing compatibility helpers may remain during a deprecation
window, but layout/category metadata is the contract enforced here.

When an adapter needs to export a digest compatibility handler, it must build it
with `createDigestHandler` and the shared digest types from
`@relayfile/adapter-core`. Keep adapter-local code limited to provider-specific
record identification, lifecycle action rules, optional canonical-record
guards, and alias segment configuration. Do not copy sorting, path prefix
filtering, alias/index/layout suppression, or bullet assembly logic into the
adapter.
