# @relayfile/adapter-core

`@relayfile/adapter-core` replaces hand-written relayfile adapters with a mapping file plus an API spec. It supports runtime execution through `SchemaAdapter`, code generation for zero-dependency adapters, and drift detection against upstream API specs.

## Install

```bash
npm install @relayfile/adapter-core @relayfile/sdk
```

## Mapping Spec

```yaml
adapter:
  name: github
  version: "1.0.0"
  baseUrl: https://api.github.com
  source:
    openapi: https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.yaml
webhooks:
  pull_request:
    path: /github/repos/{{repository.owner.login}}/{{repository.name}}/pulls/{{number}}/metadata.json
writebacks:
  review:
    match: /github/repos/*/*/pulls/*/reviews/*.json
    endpoint: POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews
```

See [../../docs/MAPPING_YAML_SPEC.md](../../docs/MAPPING_YAML_SPEC.md) for the full mapping YAML specification.

## Bundled adapter mappings

The published package ships every adapter's mapping YAML, not only the core
fallbacks:

- `mappings/<provider>.mapping.yaml` — the core fallbacks (`github`, `slack`),
  unchanged.
- `mappings/adapters/<provider>.mapping.yaml` — a verbatim copy of each
  `packages/<adapter>/<provider>.mapping.yaml`, so a consumer that depends only
  on `@relayfile/adapter-core` (for example `AgentWorkforce/flows`, which
  generates its trigger namespaces from the `webhooks:` blocks) sees the
  adapter's own events. Apply adapter-local over fallback.

The copies are generated and committed: `npm run mappings:bundle -w
@relayfile/adapter-core` refreshes them and `catalog:check` (run by
`turbo test`) fails when they drift, so a tarball can never carry a stale
bundle.

## CLI

```bash
npx adapter-core init --service github --openapi https://example.com/openapi.yaml
npx adapter-core validate --spec mappings/github.mapping.yaml
npx adapter-core generate --spec mappings/github.mapping.yaml --outdir src/generated
npx adapter-core drift --spec mappings/github.mapping.yaml --baseline src/generated/service-spec.snapshot.json
npx adapter-core docs-to-spec --url https://docs.example.com/api --out specs --service example
npx adapter-core docs-check --spec specs/example.openapi.yaml
npx adapter-core docs-update --spec specs/example.openapi.yaml
```

## Docs-To-Spec

For APIs that only publish documentation pages, `adapter-core` can crawl those docs, extract API structure with an LLM, and emit both an OpenAPI spec and a mapping file.

```bash
npx adapter-core docs-to-spec \
  --url https://docs.example.com/api-reference \
  --out ./specs \
  --service example \
  --paths /api-reference/endpoints,/api-reference/webhooks \
  --sync-trigger content-hash
```

Generated OpenAPI files store crawl metadata in `x-docs-source`. That enables:

- `docs-check` to do a cheap hash, RSS, or GitHub-release check before any crawl or LLM call
- `docs-update` to re-crawl, diff against the current spec, preserve `x-human-edited: true` sections, and mark removed operations as deprecated

Generated mapping files use `adapter.source.docs` so the existing runtime and generator pipeline can load documentation-backed adapters the same way it loads OpenAPI or Postman-backed adapters.

## Runtime

Pass the mapping object produced by your build step to the runtime adapter:

```ts
import { SchemaAdapter, type MappingSpec } from "@relayfile/adapter-core";
import type { ConnectionProvider, RelayFileClient } from "@relayfile/sdk";

export function createAdapter(
  client: RelayFileClient,
  provider: ConnectionProvider,
  spec: MappingSpec
) {
  return new SchemaAdapter({
    client,
    provider,
    spec,
    defaultConnectionId: "conn_123"
  });
}
```

In a separate Node.js **build script**, load the YAML and save the validated
mapping as JSON. Bundle that JSON into your app and pass it to `createAdapter`:

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { loadMappingSpec } from "@relayfile/adapter-core/ingest";

const spec = await loadMappingSpec("./mappings/github.mapping.yaml");
await mkdir("./generated", { recursive: true });
await writeFile("./generated/github.mapping.json", JSON.stringify(spec));
```

## Build-time tooling imports

The root entry exports runtime helpers and shared types. Tooling values previously
exported from the root now require an explicit subpath (a breaking import change):

| Subpath | Exports |
| --- | --- |
| `@relayfile/adapter-core/docs` | `DocsCrawler`, `APIExtractor`, `SpecGenerator`, `MappingGenerator`, `ChangeDetector`, `SpecUpdater`, `defaultSyncConfig`, and docs types |
| `@relayfile/adapter-core/ingest` | `loadServiceSpecFromMapping`, OpenAPI/Postman/sample loaders, `loadMappingSpec`, `parseMappingSpecText`, `validateMappingSpec`, and service types |
| `@relayfile/adapter-core/ingest/mapping` | Mapping parser/validator only, for consumers that need YAML mapping loading without docs or service-spec ingestion |
| `@relayfile/adapter-core/generate` | Adapter/type generators, `detectDrift`, and trigger/scope-key/writeback-path/inbound catalog generators |

Keep these imports in build scripts or Node.js tooling. For a Worker/runtime
bundle, load the mapping at build time and pass the resulting object to
`SchemaAdapter`. The CLI commands are unchanged. Tooling dependencies remain
installed for the CLI, but are not reachable from the runtime entry. GitHub's
existing lazy mapping loader uses `/ingest/mapping`; it still requires YAML
but does not resolve crawlers or Postman conversion.

Core and adapter library packages declare `sideEffects: false`: their module
initializers create local data/functions without global registration or I/O.
`relay-helpers` is excluded because its authorizer initializes process-global
coordination. The core CLI is an executable entry and still runs normally.

After release, publish adapters with synchronized core dependency versions, then
update Cloud's dependencies and lockfile. Cloud can remove its temporary
`experimental.optimizePackageImports` entry for core after verifying the Worker
size check against that release.

## What It Generates

- `adapter.generated.ts`: static mapping logic for path resolution and writeback matching
- `types.generated.ts`: TypeScript types derived from OpenAPI schemas
- `service-spec.snapshot.json`: normalized baseline for future drift checks

## Drift Detection

`detectDrift()` compares two normalized `ServiceSpec` objects and reports:

- breaking changes: removed endpoints, removed fields, required field additions, type changes
- warnings: possible property renames
- additions: new endpoints, new schemas, optional field additions
