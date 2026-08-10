import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";

import { emitShortcutAuxiliaryFiles } from "./emit-auxiliary-files.js";
import { digest } from "./digest.js";
import { computeShortcutPath, shortcutByIdAliasPath, shortcutRootIndexPath } from "./path-mapper.js";
import { normalizeShortcutWebhook, verifyShortcutWebhookSignature } from "./webhook-normalizer.js";

function client() {
  const files = new Map<string, string>();
  return {
    files,
    async writeFile(input: { path: string; content: string }) { files.set(input.path, input.content); },
    async deleteFile(input: { path: string }) { files.delete(input.path); },
    async readFile(input: { path: string }) {
      const content = files.get(input.path);
      return content === undefined ? null : { content };
    },
  };
}

describe("Shortcut adapter", () => {
  it("normalizes every action in a bundled webhook and verifies the provider signature", () => {
    const body = JSON.stringify({
      id: "event-1",
      actions: [
        { id: 35, entity_type: "story", action: "update" },
        { id: 16, entity_type: "epic", action: "delete" },
      ],
    });
    const signature = createHmac("sha256", "secret").update(body).digest("hex");
    const normalized = normalizeShortcutWebhook(JSON.parse(body), { "Payload-Signature": signature }, { connectionId: "conn" });
    assert.deepEqual(normalized.actions.map((action) => action.eventType), ["story.update", "epic.delete"]);
    assert.equal(verifyShortcutWebhookSignature(body, signature, "secret"), true);
    assert.equal(verifyShortcutWebhookSignature(body, signature, "wrong"), false);
  });

  it("emits canonical records, indexes, and by-id aliases while preserving terminal fields", async () => {
    const relay = client();
    const result = await emitShortcutAuxiliaryFiles(relay, {
      workspaceId: "workspace",
      stories: [{ id: 35, name: "Completed", completed: true, archived: true, workflow_state_id: 500000009 }],
    });
    assert.equal(result.errors.length, 0);
    assert.ok(relay.files.has(shortcutRootIndexPath()));
    assert.ok(relay.files.has(computeShortcutPath("story", 35)));
    assert.ok(relay.files.has(shortcutByIdAliasPath("story", 35)));
    assert.match(relay.files.get(computeShortcutPath("story", 35)) ?? "", /"completed": true/);
  });

  it("keeps Shortcut terminal mutations visible to the digest handler", async () => {
    const section = await digest({
      provider: "shortcut",
      window: {
        from: "2026-08-10T00:00:00.000Z",
        to: "2026-08-11T00:00:00.000Z",
      },
      async changeEvents() {
        return [
          {
            id: "story-35",
            timestamp: "2026-08-10T12:00:00.000Z",
            action: "completed",
            canonicalPath: "/shortcut/stories/35.json",
          },
          {
            id: "epic-16",
            timestamp: "2026-08-10T12:01:00.000Z",
            action: "archived",
            canonicalPath: "/shortcut/epics/16.json",
          },
        ];
      },
    });

    assert.deepEqual(section?.bullets.map((bullet) => bullet.text), [
      "35 was completed",
      "16 was archived",
    ]);
  });
});
