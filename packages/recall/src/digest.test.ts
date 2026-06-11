import assert from "node:assert/strict";
import test from "node:test";

import { digest, type DigestContext } from "./digest.js";

test("digest returns deterministic Recall bullets sorted by event time and id", async () => {
  const ctx: DigestContext = {
    provider: "recall",
    window: { from: "2026-05-12T00:00:00.000Z", to: "2026-05-13T00:00:00.000Z" },
    async changeEvents(filter) {
      assert.deepEqual(filter, { providers: ["recall"] });
      return [
        {
          id: "evt-2",
          timestamp: "2026-05-12T09:00:00.000Z",
          action: "updated",
          canonicalPath: "recall/recordings/rec_2.json",
        },
        {
          id: "evt-1",
          timestamp: "2026-05-12T08:00:00.000Z",
          action: "created",
          canonicalPath: "/recall/recordings/rec_1.json",
        },
      ];
    },
  };

  const first = await digest(ctx);
  const second = await digest(ctx);

  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    provider: "recall",
    bullets: [
      {
        text: "recording rec_1 was created",
        canonicalPath: "recall/recordings/rec_1.json",
      },
      {
        text: "recording rec_2 was updated",
        canonicalPath: "recall/recordings/rec_2.json",
      },
    ],
  });
});

test("digest excludes Recall alias and structural paths", async () => {
  const ctx: DigestContext = {
    provider: "recall",
    window: { from: "2026-05-12T00:00:00.000Z", to: "2026-05-13T00:00:00.000Z" },
    async changeEvents() {
      return [
        {
          id: "evt-1",
          timestamp: "2026-05-12T08:00:00.000Z",
          action: "created",
          canonicalPath: "recall/LAYOUT.md",
        },
        {
          id: "evt-2",
          timestamp: "2026-05-12T08:01:00.000Z",
          action: "created",
          canonicalPath: "recall/recordings/_index.json",
        },
        {
          id: "evt-3",
          timestamp: "2026-05-12T08:02:00.000Z",
          action: "created",
          canonicalPath: "recall/recordings/by-day/2026-05-12/_index.json",
        },
      ];
    },
  };

  assert.equal(await digest(ctx), null);
});
