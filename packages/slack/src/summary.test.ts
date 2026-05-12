import assert from "node:assert/strict";
import test from "node:test";

import { buildSummary } from "./summary.js";

test("buildSummary derives Slack actor and channel tags from message payloads", () => {
  assert.deepEqual(
    buildSummary({
      text: "Customer escalation posted to ops",
      user: "U123",
      user_name: "relay-bot",
      channel: {
        id: "C456",
        name: "ops-alerts",
      },
      channel_type: "channel",
    }),
    {
      title: "Customer escalation posted to ops",
      actor: {
        id: "U123",
        displayName: "relay-bot",
      },
      tags: ["channel:C456", "channel_name:ops-alerts", "channel_type:channel"],
    },
  );
});
