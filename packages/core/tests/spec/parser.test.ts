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
