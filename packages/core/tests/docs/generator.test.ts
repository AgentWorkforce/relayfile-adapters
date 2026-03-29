import assert from "node:assert/strict";
import test from "node:test";
import YAML from "yaml";
import { SpecGenerator } from "../../src/docs/generator.js";

test("SpecGenerator emits OpenAPI with security and x-webhooks", () => {
  const generator = new SpecGenerator();
  const yaml = generator.generate(
    {
      endpoints: [
        {
          method: "GET",
          path: "/widgets/{id}",
          parameters: [
            { name: "id", in: "path", required: true, type: "string" },
          ],
          responseShape: {
            id: "string",
            name: "string",
          },
        },
      ],
      webhooks: [
        {
          event: "widget.created",
          payloadShape: { id: "string" },
        },
      ],
      auth: {
        type: "api-key",
        location: "header",
        headerName: "X-API-Key",
      },
    },
    {
      apiName: "widgets",
      docsSource: {
        url: "https://docs.example.com/api",
      },
    }
  );

  const document = YAML.parse(yaml) as Record<string, unknown>;
  assert.equal(document.openapi, "3.0.3");
  assert.ok((document.paths as Record<string, unknown>)["/widgets/{id}"]);
  assert.ok(
    ((document.components as Record<string, Record<string, unknown>>).securitySchemes ?? {})
      .DefaultAuth
  );
  assert.ok((document["x-webhooks"] as Record<string, unknown>)["widget.created"]);
  assert.ok(document["x-docs-source"]);
});
