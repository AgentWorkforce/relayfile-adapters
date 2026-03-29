import assert from "node:assert/strict";
import test from "node:test";
import { APIExtractor } from "../../src/docs/extractor.js";

test("APIExtractor parses structured JSON responses from the LLM", async () => {
  const extractor = new APIExtractor({
    provider: "custom",
    endpoint: "https://llm.example.test/extract",
    concurrency: 1,
    fetchImpl: async (input, init) => {
      assert.equal(String(input), "https://llm.example.test/extract");
      assert.equal(init?.method, "POST");
      return new Response(
        JSON.stringify({
          output: {
            text: JSON.stringify({
              title: "Widgets API",
              endpoints: [
                {
                  method: "GET",
                  path: "/widgets/{id}",
                  parameters: [
                    {
                      name: "id",
                      in: "path",
                      type: "string",
                      required: true,
                    },
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
                  payloadShape: {
                    id: "string",
                    type: "widget.created",
                  },
                },
              ],
              auth: {
                type: "bearer",
              },
            }),
          },
        }),
        { status: 200 }
      );
    },
  });

  const extracted = await extractor.extract([
    {
      url: "https://docs.example.com/api",
      title: "Widgets",
      content: "GET /widgets/{id}",
    },
  ]);

  assert.equal(extracted.endpoints.length, 1);
  assert.equal(extracted.endpoints[0]?.method, "GET");
  assert.equal(extracted.webhooks[0]?.event, "widget.created");
  assert.equal(extracted.auth?.type, "bearer");
});
