/**
 * Example 05 — Custom Adapter: Stripe
 *
 * Demonstrates: building a new adapter for an unsupported service using
 * just a YAML mapping spec (~30 lines) and a few lines of TypeScript.
 *
 * Mapping spec format: see docs/MAPPING_YAML_SPEC.md
 * Stripe spec: ./stripe.mapping.yaml
 *
 * Run: npx tsx examples/05-custom-adapter/index.ts
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { SchemaAdapter } from "@relayfile/adapter-core";
import type { MappingSpec } from "@relayfile/adapter-core";

// ---------------------------------------------------------------------------
// 1. Load the Stripe mapping spec from YAML (see docs/MAPPING_YAML_SPEC.md)
// ---------------------------------------------------------------------------
const mappingPath = fileURLToPath(
  new URL("./stripe.mapping.yaml", import.meta.url),
);
const spec = parseYaml(readFileSync(mappingPath, "utf-8")) as MappingSpec;

// ---------------------------------------------------------------------------
// 2. Create the adapter — that's it!
// ---------------------------------------------------------------------------
const adapter = new SchemaAdapter({
  client: {
    async ingestWebhook() {
      return { status: "queued", id: "q_stripe" };
    },
  },
  provider: {
    name: "stripe",
    async proxy(req) {
      console.log("  [proxy →]", req.method, req.endpoint);
      return { status: 200, headers: {}, data: { id: "re_mock123" } };
    },
  },
  spec,
  defaultConnectionId: "conn_stripe_live",
});

// ---------------------------------------------------------------------------
// 3. Run through capabilities
// ---------------------------------------------------------------------------
async function main() {
  console.log("--- Example 05: Custom Stripe Adapter ---\n");
  console.log(`Adapter: ${adapter.name} v${adapter.version}`);
  console.log("Events:", adapter.supportedEvents());

  const webhookPath = adapter.computeWebhookPath({
    provider: "stripe",
    connectionId: "conn_stripe_live",
    eventType: "charge.succeeded",
    objectType: "charge",
    objectId: "ch_3xyz",
    payload: {
      id: "evt_1abc", type: "charge.succeeded", account: "acct_demo",
      data: { object: { id: "ch_3xyz", amount: 4999, currency: "usd" } },
    },
  });
  console.log("\nWebhook VFS path:", webhookPath);

  const chargePath = adapter.computeResourcePath("get-charge", { charge_id: "ch_3xyz" });
  console.log("Resource path:", chargePath);

  const refundPath = "/stripe/charges/ch_3xyz/refunds/agent-refund.json";
  const match = adapter.matchWriteback(refundPath);
  console.log("\nWriteback:", match?.name, "→", match?.method, match?.endpointPath);

  console.log("\nIssuing refund via writeback...");
  await adapter.writeBack("ws_demo", refundPath, JSON.stringify({
    amount: 4999, reason: "requested_by_customer", connectionId: "conn_stripe_live",
  }));
  console.log("Done.\n");
}

main().catch(console.error);
