import test from "node:test";
import assert from "node:assert/strict";
import { parseMappingSpecText, validateMappingSpec } from "../../src/spec/parser.js";
import type { ServiceSpec } from "../../src/ingest/types.js";

test("parseMappingSpecText parses yaml mapping specs", () => {
  const spec = parseMappingSpecText(`
adapter:
  name: github
  version: "1.0.0"
  source:
    openapi: ./openapi.yaml
webhooks:
  pull_request:
    path: /github/repos/{{repository.owner.login}}/{{repository.name}}/pulls/{{number}}/metadata.json
`);

  assert.equal(spec.adapter.name, "github");
  assert.equal(spec.webhooks.pull_request?.path.includes("{{number}}"), true);
});

test("validateMappingSpec checks webhook template fields against service schema", () => {
  const spec = parseMappingSpecText(`
adapter:
  name: github
  version: "1.0.0"
  source:
    openapi: ./openapi.yaml
webhooks:
  pull_request:
    path: /github/repos/{{repository.owner.login}}/{{repository.name}}/pulls/{{missing}}/metadata.json
`);

  const serviceSpec: ServiceSpec = {
    title: "GitHub",
    version: "1",
    sourceKind: "openapi",
    sourceLocation: "fixture",
    endpoints: [],
    schemas: {},
    webhookSchemas: {
      pull_request: {
        type: "object",
        properties: {
          repository: {
            type: "object",
            properties: {
              owner: {
                type: "object",
                properties: {
                  login: { type: "string" },
                },
              },
              name: { type: "string" },
            },
          },
          number: { type: "integer" },
        },
      },
    },
  };

  const result = validateMappingSpec(spec, serviceSpec);
  assert.equal(result.valid, false);
  assert.match(
    result.issues.map((issue) => issue.message).join("\n"),
    /missing/i
  );
});

test("parseMappingSpecText accepts cursor pagination with cursorPath", () => {
  const spec = parseMappingSpecText(`
adapter:
  name: github
  version: "1.0.0"
  source:
    openapi: ./openapi.yaml
webhooks: {}
resources:
  pulls:
    endpoint: "GET /repos/{owner}/{repo}/pulls"
    path: /github/repos/{{owner}}/{{repo}}/pulls/{{id}}/metadata.json
    pagination:
      strategy: cursor
      cursorPath: meta.nextCursor
      paramName: after
`);
  const p = spec.resources?.pulls?.pagination;
  assert.ok(p);
  assert.equal(p.strategy, "cursor");
  assert.equal((p as { cursorPath: string }).cursorPath, "meta.nextCursor");
  assert.equal((p as { paramName?: string }).paramName, "after");
});

test("parseMappingSpecText rejects cursor pagination missing cursorPath", () => {
  assert.throws(
    () =>
      parseMappingSpecText(`
adapter:
  name: github
  version: "1.0.0"
  source:
    openapi: ./openapi.yaml
webhooks: {}
resources:
  pulls:
    endpoint: "GET /repos/{owner}/{repo}/pulls"
    path: /github/repos/{{owner}}/pulls.json
    pagination:
      strategy: cursor
`),
    /cursorPath/i
  );
});

test("parseMappingSpecText rejects an unsupported pagination strategy", () => {
  assert.throws(
    () =>
      parseMappingSpecText(`
adapter:
  name: github
  version: "1.0.0"
  source:
    openapi: ./openapi.yaml
webhooks: {}
resources:
  pulls:
    endpoint: "GET /repos/{owner}/{repo}/pulls"
    path: /github/repos/{{owner}}/pulls.json
    pagination:
      strategy: keyset
`),
    /not supported/i
  );
});

test("parseMappingSpecText accepts offset pagination with optional fields", () => {
  const spec = parseMappingSpecText(`
adapter:
  name: github
  version: "1.0.0"
  source:
    openapi: ./openapi.yaml
webhooks: {}
resources:
  issues:
    endpoint: "GET /repos/{owner}/{repo}/issues"
    path: /github/repos/{{owner}}/issues/{{number}}/metadata.json
    pagination:
      strategy: offset
      pageSize: 100
`);
  const p = spec.resources?.issues?.pagination;
  assert.ok(p);
  assert.equal(p.strategy, "offset");
  assert.equal((p as { pageSize?: number }).pageSize, 100);
});

test("parseMappingSpecText accepts page pagination", () => {
  const spec = parseMappingSpecText(`
adapter:
  name: github
  version: "1.0.0"
  source:
    openapi: ./openapi.yaml
webhooks: {}
resources:
  issues:
    endpoint: "GET /repos/{owner}/{repo}/issues"
    path: /github/repos/{{owner}}/issues/{{number}}/metadata.json
    pagination:
      strategy: page
      limitParamName: per_page
`);
  const p = spec.resources?.issues?.pagination;
  assert.ok(p);
  assert.equal(p.strategy, "page");
});

test("parseMappingSpecText accepts link-header pagination", () => {
  const spec = parseMappingSpecText(`
adapter:
  name: github
  version: "1.0.0"
  source:
    openapi: ./openapi.yaml
webhooks: {}
resources:
  issues:
    endpoint: "GET /repos/{owner}/{repo}/issues"
    path: /github/repos/{{owner}}/issues/{{number}}/metadata.json
    pagination:
      strategy: link-header
`);
  assert.equal(spec.resources?.issues?.pagination?.strategy, "link-header");
});

test("parseMappingSpecText accepts next-token pagination with tokenPath", () => {
  const spec = parseMappingSpecText(`
adapter:
  name: aws
  version: "1.0.0"
  source:
    openapi: ./openapi.yaml
webhooks: {}
resources:
  buckets:
    endpoint: "GET /buckets"
    path: /aws/buckets/{{Name}}/metadata.json
    pagination:
      strategy: next-token
      tokenPath: NextContinuationToken
`);
  const p = spec.resources?.buckets?.pagination;
  assert.ok(p);
  assert.equal(p.strategy, "next-token");
  assert.equal((p as { tokenPath: string }).tokenPath, "NextContinuationToken");
});

test("parseMappingSpecText rejects next-token pagination missing tokenPath", () => {
  assert.throws(
    () =>
      parseMappingSpecText(`
adapter:
  name: aws
  version: "1.0.0"
  source:
    openapi: ./openapi.yaml
webhooks: {}
resources:
  buckets:
    endpoint: "GET /buckets"
    path: /aws/buckets/{{Name}}/metadata.json
    pagination:
      strategy: next-token
`),
    /tokenPath/i
  );
});

test("parseMappingSpecText accepts sync block with modelName", () => {
  const spec = parseMappingSpecText(`
adapter:
  name: github
  version: "1.0.0"
  source:
    openapi: ./openapi.yaml
webhooks: {}
resources:
  pulls:
    endpoint: "GET /repos/{owner}/{repo}/pulls"
    path: /github/repos/{{owner}}/pulls/{{id}}/metadata.json
    sync:
      modelName: PullRequest
      cursorField: updated_at
      checkpointKey: github:pulls:cursor
`);
  assert.equal(spec.resources?.pulls?.sync?.modelName, "PullRequest");
  assert.equal(spec.resources?.pulls?.sync?.cursorField, "updated_at");
  assert.equal(
    spec.resources?.pulls?.sync?.checkpointKey,
    "github:pulls:cursor"
  );
});

test("parseMappingSpecText rejects sync block missing modelName", () => {
  assert.throws(
    () =>
      parseMappingSpecText(`
adapter:
  name: github
  version: "1.0.0"
  source:
    openapi: ./openapi.yaml
webhooks: {}
resources:
  pulls:
    endpoint: "GET /repos/{owner}/{repo}/pulls"
    path: /github/repos/{{owner}}/pulls/{{id}}/metadata.json
    sync:
      cursorField: updated_at
`),
    /modelName/i
  );
});
