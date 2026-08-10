import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { emitShortcutAuxiliaryFiles } from "./emit-auxiliary-files.js";
import { digest } from "./digest.js";
import {
  computeShortcutPath,
  normalizeShortcutObjectType,
  shortcutByIdAliasPath,
  shortcutIndexPath,
  shortcutRootIndexPath,
} from "./path-mapper.js";
import { resources } from "./resources.js";
import { normalizeShortcutWebhook } from "./webhook-normalizer.js";

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
  it("normalizes every action in a bundled webhook", () => {
    const body = JSON.stringify({
      id: "event-1",
      actions: [
        { id: 35, entity_type: "story", action: "update" },
        { id: 16, entity_type: "epic", action: "delete" },
        { id: 17, entity_type: "story-comment", action: "create" },
        { id: 18, entity_type: "story-task", action: "update" },
      ],
    });
    const normalized = normalizeShortcutWebhook(JSON.parse(body), {}, { connectionId: "conn" });
    assert.deepEqual(normalized.actions.map((action) => action.eventType), [
      "story.update",
      "epic.delete",
      "story-comment.create",
      "story-task.update",
    ]);
  });

  it("emits every writable resource with canonical records, indexes, and by-id aliases", async () => {
    const relay = client();
    const result = await emitShortcutAuxiliaryFiles(relay, {
      workspaceId: "workspace",
      categories: [{ id: "category-1", name: "Engineering" }],
      customFields: [{ id: "custom-field-1", name: "Priority" }],
      epics: [{ id: 16, name: "Archived epic", archived: true }],
      groups: [{ id: "group-1", name: "Product" }],
      iterations: [{ id: "iteration-1", name: "Sprint 1" }],
      labels: [{ id: "label-1", name: "Important" }],
      members: [{ id: "member-1", name: "Design partner" }],
      milestones: [{ id: "milestone-1", name: "Launch" }],
      projects: [{ id: "project-1", name: "Relayfile" }],
      stories: [{ id: 35, name: "Completed", completed: true, archived: true, workflow_state_id: 500000009 }],
      workflows: [{ id: "workflow-1", name: "Default" }],
    });
    assert.equal(result.errors.length, 0);
    assert.ok(relay.files.has(shortcutRootIndexPath()));
    assert.ok(relay.files.has(computeShortcutPath("story", 35)));
    assert.ok(relay.files.has(shortcutByIdAliasPath("story", 35)));
    assert.match(relay.files.get(computeShortcutPath("story", 35)) ?? "", /"completed": true/);
    const expectedIds: Record<string, string> = {
      categories: "category-1",
      "custom-fields": "custom-field-1",
      epics: "16",
      groups: "group-1",
      iterations: "iteration-1",
      labels: "label-1",
      members: "member-1",
      milestones: "milestone-1",
      projects: "project-1",
      stories: "35",
      workflows: "workflow-1",
    };
    for (const resource of resources) {
      const objectType = normalizeShortcutObjectType(resource.name);
      const id = expectedIds[resource.name] ?? `${objectType}-1`;
      assert.ok(relay.files.has(shortcutIndexPath(objectType)), `${resource.name} index missing`);
      assert.ok(relay.files.has(`${resource.path}/${id}.json`), `${resource.name} canonical missing`);
      assert.ok(relay.files.has(`${resource.path}/by-id/${id}.json`), `${resource.name} alias missing`);
    }
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
