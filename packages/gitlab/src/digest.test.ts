import assert from "node:assert/strict";
import test from "node:test";

import { digest, type DigestContext } from "./digest.js";

test("digest returns deterministic GitLab bullets sorted by event time and id", async () => {
  const ctx: DigestContext = {
    provider: "gitlab",
    window: { from: "2026-05-12T00:00:00.000Z", to: "2026-05-13T00:00:00.000Z" },
    async changeEvents(filter) {
      assert.deepEqual(filter, { providers: ["gitlab"] });
      return [
        {
          id: "evt-2",
          timestamp: "2026-05-12T09:00:00.000Z",
          action: "merged",
          canonicalPath: "gitlab/projects/acme/api/merge_requests/14__ship-it/meta.json",
        },
        {
          id: "evt-1",
          timestamp: "2026-05-12T08:00:00.000Z",
          action: "opened",
          canonicalPath: "/gitlab/projects/acme/api/issues/42__fix-login/meta.json",
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: "gitlab",
    bullets: [
      {
        text: "issue #42 was opened",
        canonicalPath: "gitlab/projects/acme/api/issues/42__fix-login/meta.json",
      },
      {
        text: "MR !14 was merged",
        canonicalPath: "gitlab/projects/acme/api/merge_requests/14__ship-it/meta.json",
      },
    ],
  });
});

test("digest ignores GitLab aliases and cleanup paths", async () => {
  const ctx: DigestContext = {
    provider: "gitlab",
    window: { from: "2026-05-12T00:00:00.000Z", to: "2026-05-13T00:00:00.000Z" },
    async changeEvents() {
      return [
        {
          id: "evt-alias",
          timestamp: "2026-05-12T08:00:00.000Z",
          action: "updated",
          canonicalPath: "gitlab/projects/acme/api/issues/by-state/open/42.json",
        },
        {
          id: "evt-proj-alias",
          timestamp: "2026-05-12T08:01:00.000Z",
          action: "updated",
          canonicalPath: "gitlab/projects/by-id/123.json",
        },
        {
          id: "evt-tag-cleanup",
          timestamp: "2026-05-12T08:02:00.000Z",
          action: "deleted",
          canonicalPath: "gitlab/projects/acme/api/tags/refs/tags/release-1.0.0.json",
        },
      ];
    },
  };

  assert.equal(await digest(ctx), null);
});

test("digest derives terminal verb from GitLab content payload", async () => {
  const ctx: DigestContext = {
    provider: "gitlab",
    window: { from: "2026-05-12T00:00:00.000Z", to: "2026-05-13T00:00:00.000Z" },
    async changeEvents() {
      return [
        {
          id: "evt-1",
          timestamp: "2026-05-12T08:00:00.000Z",
          action: "updated",
          canonicalPath: "gitlab/projects/acme/api/merge_requests/44__release/meta.json",
          content: {
            payload: {
              merged: true,
            },
          },
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: "gitlab",
    bullets: [
      {
        text: "MR !44 was merged",
        canonicalPath: "gitlab/projects/acme/api/merge_requests/44__release/meta.json",
      },
    ],
  });
});
