import assert from "node:assert/strict";
import test from "node:test";

import { digest, type DigestContext } from "./digest.js";

test("resolved alert updates remain readable and use terminal digest wording", async () => {
  const ctx: DigestContext = {
    provider: "posthog",
    window: {
      from: "2026-07-25T00:00:00.000Z",
      to: "2026-07-26T00:00:00.000Z",
    },
    async changeEvents() {
      return [
        {
          id: "evt-1",
          timestamp: "2026-07-25T08:33:00.000Z",
          action: "file.updated",
          canonicalPath:
            "/posthog/projects/17/alert-events/checkout-errors__42.json",
          content: {
            id: "42",
            title: "Checkout errors",
            state: "resolved",
            event_type: "posthog.alert.resolved",
          },
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: "posthog",
    bullets: [
      {
        text: "alert Checkout errors was resolved",
        canonicalPath:
          "posthog/projects/17/alert-events/checkout-errors__42.json",
      },
    ],
  });
});
