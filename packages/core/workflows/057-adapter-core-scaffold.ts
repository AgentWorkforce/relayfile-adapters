/**
 * 057-adapter-core-scaffold.ts
 *
 * Build @relayfile/adapter-core — schema-driven adapter generator.
 *
 * Instead of hand-coding each adapter, define a YAML/JSON mapping spec
 * + point at an OpenAPI spec or Postman collection. adapter-core generates
 * the path mapping, webhook normalization, and type definitions.
 *
 * Adding a new service = one mapping file + one API spec URL.
 * API changes = rarely matter (pass-through by default).
 * Path changes = update one line in YAML.
 *
 * Input sources:
 * - OpenAPI 3.x specs (JSON or YAML, URL or local file)
 * - Postman Collection v2.1 (JSON, URL or local file)
 * - Raw webhook payload samples (JSON files)
 *
 * Run: agent-relay run workflows/057-adapter-core-scaffold.ts
 */

import { workflow } from '@agent-relay/sdk/workflows';

const ROOT = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-core';
const SDK_ROOT = '/Users/khaliqgant/Projects/AgentWorkforce-relayfile';
const ADAPTER_GITHUB = '/Users/khaliqgant/Projects/AgentWorkforce/relayfile-adapter-github';

async function main() {
  const result = await workflow('adapter-core-scaffold')
    .description('Build @relayfile/adapter-core — generate adapters from OpenAPI/Postman specs + YAML mapping')
    .pattern('linear')
    .channel('wf-adapter-core')
    .maxConcurrency(2)
    .timeout(3_600_000)

    .agent('architect', { cli: 'claude', role: 'Designs the schema-driven adapter system' })
    .agent('builder', { cli: 'codex', preset: 'worker', role: 'Implements adapter-core' })
    .agent('reviewer', { cli: 'claude', role: 'Reviews the implementation' })

    .step('design', {
      agent: 'architect',
      task: `Design @relayfile/adapter-core — a schema-driven adapter generator for relayfile.

Read context:
- ${SDK_ROOT}/packages/sdk/typescript/src/provider.ts — IntegrationProvider, IntegrationAdapter interfaces
- ${SDK_ROOT}/packages/sdk/typescript/src/types.ts — WebhookInput, all VFS types
- ${ADAPTER_GITHUB}/src/writeback.ts — existing hand-coded adapter (reference for what we're replacing)
- ${ADAPTER_GITHUB}/src/types.ts — manually written types (should be auto-generated)
- ${ADAPTER_GITHUB}/docs/adapter-spec.md — the adapter/provider architecture

The problem: hand-coded adapters rot when APIs change. Nango's integration-templates
repo (200+ hand-maintained integrations) is exactly what we want to avoid.

The insight: relayfile adapters are THIN. They only do two things:
1. Compute VFS paths from API objects/webhook events
2. Pass through data (no transformation by default)

Design a system with these components:

1. **Mapping Spec** (YAML/JSON):
\`\`\`yaml
# github.mapping.yaml
adapter:
  name: github
  version: "1.0"
  source:
    openapi: https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.yaml
    # OR postman: https://www.postman.com/collection/...
    # OR local: ./specs/github-openapi.yaml

  # How webhook events map to VFS paths
  webhooks:
    pull_request:
      path: "/github/repos/{{repository.owner.login}}/{{repository.name}}/pulls/{{number}}/metadata.json"
      # data: pass-through (default) — raw payload written as-is
      # extract: [title, body, state]  — optional: only write these fields

    pull_request_review:
      path: "/github/repos/{{repository.owner.login}}/{{repository.name}}/pulls/{{pull_request.number}}/reviews/{{review.id}}.json"

    push:
      path: "/github/repos/{{repository.owner.login}}/{{repository.name}}/commits/{{head_commit.id}}/metadata.json"

    issues:
      path: "/github/repos/{{repository.owner.login}}/{{repository.name}}/issues/{{issue.number}}/metadata.json"

  # How API responses map to VFS paths (for sync/ingest, not webhooks)
  resources:
    pull_request:
      endpoint: GET /repos/{owner}/{repo}/pulls/{pull_number}
      path: "/github/repos/{{owner}}/{{repo}}/pulls/{{pull_number}}/metadata.json"

    pull_request_files:
      endpoint: GET /repos/{owner}/{repo}/pulls/{pull_number}/files
      path: "/github/repos/{{owner}}/{{repo}}/pulls/{{pull_number}}/files/{{filename}}"
      # iterate: true — each item in the response array gets its own file

    repository_contents:
      endpoint: GET /repos/{owner}/{repo}/contents/{path}
      path: "/github/repos/{{owner}}/{{repo}}/contents/{{path}}"

  # Writeback: VFS paths → API calls
  writebacks:
    review:
      match: "/github/repos/*/*/pulls/*/reviews/*.json"
      endpoint: POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews
      # extract path params from the VFS path using named capture groups

    comment:
      match: "/github/repos/*/*/pulls/*/comments/*.json"
      endpoint: POST /repos/{owner}/{repo}/pulls/{pull_number}/comments
\`\`\`

2. **Spec Ingest** (src/ingest/):
   - openapi-loader.ts: fetch + parse OpenAPI 3.x (YAML/JSON) — remote URL or local file
   - postman-loader.ts: fetch + parse Postman Collection v2.1 — uses @scalar/postman-to-openapi
     to convert Postman → OpenAPI internally. Consumer never deals with the conversion.
   - sample-loader.ts: read raw webhook JSON samples for APIs with no spec at all
   - Source resolution: if URL starts with http → fetch remote; otherwise → read local file
     (supports ./specs/local-file.yaml checked into the adapter repo)
   - Output: normalized ServiceSpec (endpoints, schemas, webhook shapes)
   
   The pipeline is always: any input format → OpenAPI (internal) → ServiceSpec.
   Postman collections and webhook samples get converted to OpenAPI first.

3. **Generator** (src/generate/):
   - adapter-generator.ts: mapping spec + service spec → generated adapter code
   - types-generator.ts: OpenAPI schemas → TypeScript types (for consumers who want them)
   - Generates:
     a. computePath(event) function
     b. normalizeWebhook(input) function
     c. writeback handler
     d. TypeScript types from API schemas
   - Generated code is ZERO-dependency (just the mapping logic)

4. **Runtime** (src/runtime/):
   - SchemaAdapter class: reads mapping spec at runtime (no codegen needed)
   - computePath(webhookEvent) → VFS path
   - normalizePayload(event, options?) → pass-through or extracted fields
   - matchWriteback(vfsPath) → API endpoint + params
   - Implements IntegrationAdapter from @relayfile/sdk

5. **Drift Detection** (src/drift/):
   - drift-checker.ts: compare current OpenAPI spec vs spec the adapter was built against
   - Detects: removed fields, renamed properties, new required fields, changed types
   - Output: DriftReport { breaking: [...], warnings: [...], additions: [...] }
   - CI integration: run on schedule, fail on breaking changes

6. **CLI** (src/cli.ts):
   - npx adapter-core generate --spec github.mapping.yaml --outdir ./src/generated/
   - npx adapter-core validate --spec github.mapping.yaml (check mapping references valid fields)
   - npx adapter-core drift --spec github.mapping.yaml (check for API changes)
   - npx adapter-core init --service github --openapi <url> (bootstrap a mapping file)

7. **CI Workflow** (.github/workflows/drift-check.yml):
   - Runs weekly (or on schedule)
   - Fetches latest OpenAPI specs for all adapters
   - Runs drift detection
   - Opens an issue if breaking changes detected

Output: full architecture, file tree, mapping spec schema, CLI commands.
Keep under 100 lines. End with DESIGN_COMPLETE.`,
      verification: { type: 'output_contains', value: 'DESIGN_COMPLETE' },
      timeout: 300_000,
    })

    .step('implement', {
      agent: 'builder',
      dependsOn: ['design'],
      task: `Implement @relayfile/adapter-core.

Design: {{steps.design.output}}

Working in ${ROOT}.

1. Package setup:
   - package.json: name "@relayfile/adapter-core", bin for CLI
   - Dependencies: @relayfile/sdk (peer), yaml (YAML parsing), minimatch (glob writeback matching), @scalar/postman-to-openapi (Postman → OpenAPI conversion)
   - tsconfig.json
   - No heavy deps — keep it light

2. **Mapping spec parser** (src/spec/):
   - parser.ts: load and validate mapping YAML/JSON
   - types.ts: MappingSpec, WebhookMapping, ResourceMapping, WritebackMapping types
   - Path template: Mustache-style {{field.nested}} interpolation

3. **Spec loaders** (src/ingest/):
   - openapi.ts: fetch OpenAPI spec, extract endpoint schemas + webhook event schemas
   - postman.ts: fetch Postman collection, extract requests + examples
   - sample.ts: read sample JSON files
   - All return normalized ServiceSpec

4. **Runtime adapter** (src/runtime/):
   - SchemaAdapter extends IntegrationAdapter:
     constructor(spec: MappingSpec, provider: IntegrationProvider)
     computePath(event) — template interpolation
     ingestWebhook(input: WebhookInput) — compute path + write raw payload
     matchWriteback(path) — glob match + extract params
     handleWriteback(path, content) — match + call provider.proxy()

5. **Generator** (src/generate/):
   - Generate static TypeScript code from mapping spec
   - types from OpenAPI schemas
   - Zero-runtime-dep output

6. **Drift detector** (src/drift/):
   - Compare two OpenAPI specs (old vs new)
   - Report breaking/warning/additions
   - JSON output for CI

7. **CLI** (src/cli.ts):
   - Commands: generate, validate, drift, init
   - init: given --service name + --openapi URL → scaffold mapping YAML

8. **Example mapping files** (mappings/):
   - github.mapping.yaml — full GitHub adapter spec
   - slack.mapping.yaml — Slack adapter spec (demonstrate it works for different services)

9. Tests + build + README

10. Commit:
    git checkout -b feat/scaffold
    HUSKY=0 git add -A
    HUSKY=0 git -c core.hooksPath=/dev/null commit --no-verify -m "feat: @relayfile/adapter-core — schema-driven adapter generator

    Generate relayfile adapters from OpenAPI/Postman specs + YAML mapping.
    - Runtime SchemaAdapter: no codegen needed, reads mapping at runtime
    - Generator: produce static TS code + types from specs
    - Drift detection: compare API specs, flag breaking changes
    - CLI: init, generate, validate, drift
    - Example mappings: github, slack

    Zero hand-coded API mappings. Adding a new service = one YAML file."
    git push origin feat/scaffold

End with IMPLEMENT_COMPLETE.`,
      verification: { type: 'output_contains', value: 'IMPLEMENT_COMPLETE' },
      timeout: 1_200_000,
    })

    .step('convert-github', {
      agent: 'builder',
      dependsOn: ['implement'],
      task: `Convert the existing adapter-github to use adapter-core.

Working in ${ADAPTER_GITHUB} on branch feat/schema-driven.

1. Read the generated github.mapping.yaml from ${ROOT}/mappings/github.mapping.yaml

2. Copy it to ${ADAPTER_GITHUB}/github.mapping.yaml

3. Update the adapter to use SchemaAdapter from @relayfile/adapter-core:
   - The hand-coded writeback.ts path matching can be replaced by mapping spec
   - Keep writeback.ts for now (it has good validation logic) but add SchemaAdapter
     as the primary webhook→VFS path computation
   - src/adapter.ts: new file that instantiates SchemaAdapter with the mapping

4. Update package.json:
   - Add @relayfile/adapter-core as dependency
   - npm install

5. Verify: the adapter now uses the mapping spec for path computation

6. Commit on feat/schema-driven + push

Keep the existing writeback.ts — it's more than just path mapping (it validates
review payloads). The SchemaAdapter handles ingest; writeback stays custom for now.

End with CONVERT_COMPLETE.`,
      verification: { type: 'output_contains', value: 'CONVERT_COMPLETE' },
      timeout: 600_000,
    })

    .step('review', {
      agent: 'reviewer',
      dependsOn: ['implement', 'convert-github'],
      task: `Review @relayfile/adapter-core in ${ROOT} and the converted adapter-github.

Verify adapter-core:
1. SchemaAdapter implements IntegrationAdapter correctly
2. Mapping spec supports webhooks, resources, writebacks
3. OpenAPI + Postman loaders work (at least parse structure)
4. Path template interpolation handles nested fields ({{a.b.c}})
5. Drift detection compares two specs meaningfully
6. CLI has init/generate/validate/drift commands
7. Example mappings for github + slack exist and are valid
8. No heavy dependencies (yaml + minimatch only)

Verify adapter-github conversion:
9. github.mapping.yaml exists and covers PR/push/review/issue webhooks
10. SchemaAdapter is instantiated with the mapping
11. Existing writeback.ts still works (not broken)

The key question: could someone add a new adapter (e.g., GitLab) by writing
ONLY a mapping YAML file + pointing at GitLab's OpenAPI spec? If not, what's missing?

Fix issues. Keep under 60 lines. End with REVIEW_COMPLETE.`,
      verification: { type: 'output_contains', value: 'REVIEW_COMPLETE' },
      timeout: 300_000,
    })

    .onError('retry', { maxRetries: 1, retryDelayMs: 10_000 })
    .run({ cwd: ROOT });

  console.log('Adapter core complete:', result.status);
}

main().catch(e => { console.error(e); process.exitCode = 1; });
