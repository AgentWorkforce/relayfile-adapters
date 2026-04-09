approved

- Scope reviewed: SDK plus adapter-core only.
- Confirmed [integration-adapter.ts](/Users/khaliqgant/Projects/AgentWorkforce/relayfile/packages/sdk/typescript/src/integration-adapter.ts) defines the canonical `IntegrationAdapter` abstract class with the `client` and `provider` constructor, required abstract `ingestWebhook` / `computePath` / `computeSemantics` methods, and optional `supportedEvents` / `writeBack` / `sync` hooks needed by `SchemaAdapter`.
- Confirmed [index.ts](/Users/khaliqgant/Projects/AgentWorkforce/relayfile/packages/sdk/typescript/src/index.ts) re-exports the new SDK module with `export * from "./integration-adapter.js";`, so `IntegrationAdapter` is exposed as a runtime value rather than type-only.
- Confirmed [schema-adapter.ts](/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapters/packages/core/src/runtime/schema-adapter.ts) now imports `IntegrationAdapter` from `@relayfile/sdk` and no longer defines a local abstract base class.
- Confirmed [index.ts](/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapters/packages/core/src/index.ts) re-exports `IntegrationAdapter` from `@relayfile/sdk` for back-compat consumers.
- Confirmed the five hand-coded adapter packages `github`, `slack`, `linear`, `notion`, and `gitlab` are untouched in the current diff/status, and their local `IntegrationAdapter` classes remain in place for Phase 3 migration work.
- Confirmed item (6) on the basis stated in the review request: if this review bundle was produced, `regression-build-adapters` succeeded, which supports the conclusion that the SDK contract change is non-breaking for the untouched adapters.
