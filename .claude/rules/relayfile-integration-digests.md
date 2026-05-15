---
description: Provider adapters must keep Relayfile digests and lifecycle state wired
paths:
  - packages/*/src/**
  - packages/*/test/**
  - packages/*/src/**/__tests__/**
---

# Relayfile integration digests

Relayfile digests are part of the adapter contract. If an adapter writes
provider records that agents can read, the adapter must also make those records
summarizable in the activity digest.

## Required for adapters

- Export a real `digest` handler from `src/digest.ts` and the package `src/index.ts`.
- The digest handler must use `ctx.changeEvents({ providers: [ctx.provider] })`
  and return deterministic bullets sorted by event time and id.
- Lifecycle verbs must be provider-aware. Explicitly classify terminal-state
  actions such as `closed`, `merged`, `archived`, `completed`, `canceled`, and
  `resolved`.
- Webhook ingestion must preserve terminal lifecycle state as record data.
  Do not convert `closed`/`merged`/`archived`/`completed` into deletion unless
  the upstream object was actually deleted.
- Add tests for create/update, terminal state, delete, deterministic ordering,
  and empty windows.

## No-op handlers

A digest handler that returns `null` is a temporary placeholder, not a pattern.
Do not add new no-op digest handlers for providers that expose records in
Relayfile. If a provider intentionally has no digest output, document that
choice and test the exclusion.
