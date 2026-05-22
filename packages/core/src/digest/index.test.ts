import assert from "node:assert/strict";
import test from "node:test";

import {
  createDigestHandler,
  type DigestContext,
} from "./index.js";

test("createDigestHandler emits sorted bullets and filters alias/index/layout paths", async () => {
  const digest = createDigestHandler({
    provider: "alpha",
    identify: (path) => path.split("/").at(-1) ?? path,
    actionRules: [
      { verbs: "create|created", pastTense: "was created" },
      { verbs: "delete|deleted", pastTense: "was deleted" },
    ],
  });

  const ctx: DigestContext = {
    provider: "alpha",
    window: { from: "2026-01-01T00:00:00.000Z", to: "2026-01-02T00:00:00.000Z" },
    async changeEvents(filter) {
      assert.deepEqual(filter, { providers: ["alpha"] });
      return [
        { id: "2", timestamp: "2026-01-01T09:00:00.000Z", action: "updated", canonicalPath: "/alpha/issues/by-id/ISS-1.json" },
        { id: "1", timestamp: "2026-01-01T08:00:00.000Z", action: "created", canonicalPath: "/alpha/issues/ISS-1.json" },
        { id: "3", timestamp: "2026-01-01T10:00:00.000Z", action: "deleted", canonicalPath: "/alpha/issues/_index.json" },
        { id: "4", timestamp: "2026-01-01T11:00:00.000Z", action: "deleted", canonicalPath: "/alpha/LAYOUT.md" },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: "alpha",
    bullets: [
      {
        text: "ISS-1.json was created",
        canonicalPath: "alpha/issues/ISS-1.json",
      },
    ],
  });
});

test("createDigestHandler supports provider aliases with alias.mode=any", async () => {
  const digest = createDigestHandler({
    provider: "beta",
    identify: (path) => path,
    alias: {
      mode: "any",
      segments: ["by-folder"],
    },
    actionRules: [
      { verbs: "archive|archived", pastTense: "was archived" },
    ],
  });

  const ctx: DigestContext = {
    provider: "beta",
    window: { from: "2026-01-01T00:00:00.000Z", to: "2026-01-02T00:00:00.000Z" },
    async changeEvents() {
      return [
        { id: "1", timestamp: "2026-01-01T08:00:00.000Z", action: "archived", canonicalPath: "/beta/notes/not_1.json" },
        { id: "2", timestamp: "2026-01-01T09:00:00.000Z", action: "archived", canonicalPath: "/beta/notes/by-folder/fol_1/_index.json" },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: "beta",
    bullets: [
      {
        text: "beta/notes/not_1.json was archived",
        canonicalPath: "beta/notes/not_1.json",
      },
    ],
  });
});

test("createDigestHandler supports custom acceptEvent and classify hooks", async () => {
  const digest = createDigestHandler({
    provider: "gamma",
    identify: (path) => path,
    actionRules: [{ verbs: "create|created", pastTense: "was created" }],
    acceptEvent: (event, canonicalPath) =>
      canonicalPath !== "gamma/skip/me.json" && event.id !== "skip-id",
    classify: (event, canonicalPath) => {
      if (canonicalPath.endsWith("/terminal.json")) return "was closed";
      if ((event.action ?? "") === "noop") return "was updated";
      return null;
    },
  });

  const ctx: DigestContext = {
    provider: "gamma",
    window: { from: "2026-01-01T00:00:00.000Z", to: "2026-01-02T00:00:00.000Z" },
    async changeEvents() {
      return [
        { id: "skip-id", timestamp: "2026-01-01T08:00:00.000Z", action: "created", canonicalPath: "/gamma/items/a.json" },
        { id: "ok-1", timestamp: "2026-01-01T09:00:00.000Z", action: "created", canonicalPath: "/gamma/skip/me.json" },
        { id: "ok-2", timestamp: "2026-01-01T10:00:00.000Z", action: "created", canonicalPath: "/gamma/items/terminal.json" },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: "gamma",
    bullets: [
      {
        text: "gamma/items/terminal.json was closed",
        canonicalPath: "gamma/items/terminal.json",
      },
    ],
  });
});
