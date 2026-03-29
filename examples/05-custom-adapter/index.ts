/**
 * Example 05 — Custom Adapter: Stripe
 *
 * Demonstrates: building a new adapter for an unsupported service using
 * just a YAML mapping spec (~30 lines) and a few lines of TypeScript.
 * No custom adapter class needed.
 *
 * Run: npx tsx examples/05-custom-adapter/index.ts
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { SchemaAdapter } from "@relayfile/adapter-core";
import type { MappingSpec } from "@relayfile/adapter-core";

// ---------------------------------------------------------------------------
// 1. Load the Stripe mapping spec from YAML
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
      return {
        status: 200,
        headers: {},
        data: { id: "re_mock123", status: "succeeded" },
      };
    },
  },
  spec,
  defaultConnectionId: "conn_stripe_live",
});

// ---------------------------------------------------------------------------
// 3. Simulate a charge.succeeded webhook from Stripe
// ---------------------------------------------------------------------------
const chargeWebhook = {
  id: "evt_1abc",
  type: "charge.succeeded",
  account: "acct_demo",
  data: {
    object: {
      id: "ch_3xyz",
      amount: 4999,
      currency: "usd",
      status: "succeeded",
      customer: "cus_abc",
      description: "Pro plan — monthly",
    },
  },
};

// ---------------------------------------------------------------------------
// 4. Run through the capabilities
// ---------------------------------------------------------------------------
async function main() {
  console.log("--- Example 05: Custom Stripe Adapter ---\n");
  console.log(`Adapter: ${adapter.name} v${adapter.version}`);
  console.log("Supported events:", adapter.supportedEvents());

  // Webhook → VFS path
  const webhookPath = adapter.computeWebhookPath({
    provider: "stripe",
    connectionId: "conn_stripe_live",
    eventType: "charge.succeeded",
    objectType: "charge",
    objectId: "ch_3xyz",
    payload: chargeWebhook,
  });
  console.log("\nWebhook VFS path:", webhookPath);

  // Ingest the webhook
  const result = await adapter.ingestWebhook("ws_demo", {
    provider: "stripe",
    connectionId: "conn_stripe_live",
    eventType: "charge.succeeded",
    objectType: "charge",
    objectId: "ch_3xyz",
    payload: chargeWebhook,
  });
  console.log("Ingest result:", JSON.stringify(result, null, 2));

  // Resource path
  const chargePath = adapter.computeResourcePath("get-charge", {
    charge_id: "ch_3xyz",
  });
  console.log("\nResource path:", chargePath);

  // Writeback: issue a refund
  const refundPath = "/stripe/charges/ch_3xyz/refunds/agent-refund.json";
  const match = adapter.matchWriteback(refundPath);
  console.log("\nWriteback match for", refundPath);
  console.log("  Rule:", match?.name);
  console.log("  Endpoint:", match?.endpointPath);

  console.log("\nIssuing refund via writeback...");
  await adapter.writeBack(
    "ws_demo",
    refundPath,
    JSON.stringify({
      amount: 4999,
      reason: "requested_by_customer",
      connectionId: "conn_stripe_live",
    }),
  );
  console.log("Refund writeback complete.\n");
}

main().catch(console.error);
