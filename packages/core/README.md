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

```ts
import { SchemaAdapter, loadMappingSpec } from "@relayfile/adapter-core";

const spec = await loadMappingSpec("./mappings/github.mapping.yaml");
const adapter = new SchemaAdapter({
  client,
  provider,
  spec,
  defaultConnectionId: "conn_123"
});
```

## What It Generates

- `adapter.generated.ts`: static mapping logic for path resolution and writeback matching
- `types.generated.ts`: TypeScript types derived from OpenAPI schemas
- `service-spec.snapshot.json`: normalized baseline for future drift checks

## Drift Detection

`detectDrift()` compares two normalized `ServiceSpec` objects and reports:

- breaking changes: removed endpoints, removed fields, required field additions, type changes
- warnings: possible property renames
- additions: new endpoints, new schemas, optional field additions
