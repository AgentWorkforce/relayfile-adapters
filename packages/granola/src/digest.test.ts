import assert from "node:assert/strict";
import test from "node:test";

import { digest, type DigestContext } from "./digest.js";

test("digest returns deterministic Granola bullets sorted by event time and id", async () => {
  const ctx: DigestContext = {
    provider: "granola",
    window: { from: "2026-05-12T00:00:00.000Z", to: "2026-05-13T00:00:00.000Z" },
    async changeEvents(filter) {
      assert.deepEqual(filter, { providers: ["granola"] });
      return [
        {
          id: "evt-2",
          timestamp: "2026-05-12T09:00:00.000Z",
          action: "updated",
          canonicalPath: "granola/notes/not_2.json",
        },
        {
          id: "evt-3",
          timestamp: "2026-05-12T10:00:00.000Z",
          action: "archived",
          canonicalPath: "granola/folders/fol_3.json",
        },
        {
          id: "evt-1",
          timestamp: "2026-05-12T08:00:00.000Z",
          action: "created",
          canonicalPath: "/granola/notes/not_1.json",
        },
      ];
    },
  };

  const first = await digest(ctx);
  const second = await digest(ctx);

  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    provider: "granola",
    bullets: [
      {
        text: "note not_1 was created",
        canonicalPath: "granola/notes/not_1.json",
      },
      {
        text: "note not_2 was updated",
        canonicalPath: "granola/notes/not_2.json",
      },
      {
        text: "folder fol_3 was archived",
        canonicalPath: "granola/folders/fol_3.json",
      },
    ],
  });
});

test("digest excludes Granola alias and structural paths", async () => {
  const ctx: DigestContext = {
    provider: "granola",
    window: { from: "2026-05-12T00:00:00.000Z", to: "2026-05-13T00:00:00.000Z" },
    async changeEvents() {
      return [
        {
          id: "evt-1",
          timestamp: "2026-05-12T08:00:00.000Z",
          action: "created",
          canonicalPath: "granola/LAYOUT.md",
        },
        {
          id: "evt-2",
          timestamp: "2026-05-12T08:01:00.000Z",
          action: "created",
          canonicalPath: "granola/notes/_index.json",
        },
        {
          id: "evt-3",
          timestamp: "2026-05-12T08:02:00.000Z",
          action: "created",
          canonicalPath: "granola/notes/by-folder/fol_9/_index.json",
        },
      ];
    },
  };

  assert.equal(await digest(ctx), null);
});
