import assert from "node:assert/strict";
import test from "node:test";

import { digest, type DigestContext } from "./digest.js";

test("digest distinguishes Cloudflare worker usage identifiers from worker scripts", async () => {
  const ctx: DigestContext = {
    provider: "cloudflare",
    window: { from: "2026-06-18T00:00:00.000Z", to: "2026-06-19T00:00:00.000Z" },
    async changeEvents() {
      return [
        {
          id: "evt-1",
          timestamp: "2026-06-18T08:00:00.000Z",
          action: "updated",
          canonicalPath: "/cloudflare/analytics/workers/scripts/relayfile.json",
        },
        {
          id: "evt-2",
          timestamp: "2026-06-18T09:00:00.000Z",
          action: "updated",
          canonicalPath: "/cloudflare/workers/scripts/relayfile.json",
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: "cloudflare",
    bullets: [
      {
        text: "Worker usage relayfile was updated",
        canonicalPath: "cloudflare/analytics/workers/scripts/relayfile.json",
      },
      {
        text: "Worker script relayfile was updated",
        canonicalPath: "cloudflare/workers/scripts/relayfile.json",
      },
    ],
  });
});

test("digest preserves Cloudflare terminal verbs instead of degrading to updated", async () => {
  const ctx: DigestContext = {
    provider: "cloudflare",
    window: { from: "2026-06-18T00:00:00.000Z", to: "2026-06-19T00:00:00.000Z" },
    async changeEvents() {
      return [
        {
          id: "evt-1",
          timestamp: "2026-06-18T08:00:00.000Z",
          action: "notification.archived",
          canonicalPath: "/cloudflare/notifications/policies/policy-1.json",
        },
        {
          id: "evt-2",
          timestamp: "2026-06-18T09:00:00.000Z",
          action: "job.completed",
          canonicalPath: "/cloudflare/queues/queue-1.json",
        },
        {
          id: "evt-3",
          timestamp: "2026-06-18T10:00:00.000Z",
          action: "incident.canceled",
          canonicalPath: "/cloudflare/notifications/events/event-1.json",
        },
        {
          id: "evt-4",
          timestamp: "2026-06-18T11:00:00.000Z",
          action: "config.merged",
          canonicalPath: "/cloudflare/pages/projects/project-1.json",
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: "cloudflare",
    bullets: [
      {
        text: "notification policy policy-1 was archived",
        canonicalPath: "cloudflare/notifications/policies/policy-1.json",
      },
      {
        text: "queue queue-1 was completed",
        canonicalPath: "cloudflare/queues/queue-1.json",
      },
      {
        text: "notification event event-1 was canceled",
        canonicalPath: "cloudflare/notifications/events/event-1.json",
      },
      {
        text: "Pages project project-1 was merged",
        canonicalPath: "cloudflare/pages/projects/project-1.json",
      },
    ],
  });
});
