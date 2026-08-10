import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { emitShortcutAuxiliaryFiles } from "./emit-auxiliary-files.js";
import { digest } from "./digest.js";
import { layoutPromptFile } from "./layout-prompt.js";
import {
  computeShortcutPath,
  computeShortcutRecordPath,
  normalizeShortcutObjectType,
  parseShortcutPath,
  shortcutByAssigneeAliasPath,
  shortcutByIdAliasPath,
  shortcutByStateAliasPath,
  shortcutByTitleAliasPath,
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
  it("normalizes supported direct and nested actions while keeping trigger events catalogued", () => {
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
      "story.update",
      "story.update",
    ]);
  });

  it("rejects malformed and unsupported webhook actions consistently", () => {
    assert.throws(() => normalizeShortcutWebhook({ action: { id: 1, entity_type: "story", action: "archive" } }));
    assert.throws(() => normalizeShortcutWebhook({ action: { id: 1, entity_type: "unknown", action: "update" } }));
    assert.throws(() => normalizeShortcutWebhook({ actions: [{ id: 1, entity_type: "story" }] }));
  });

  it("round-trips canonical, by-id, and Story alias paths", () => {
    for (const [objectType, id] of [["story", "story/with spaces"] as const, ["epic", "epic/with spaces"] as const]) {
      const canonical = computeShortcutRecordPath(objectType, { id, name: "Roadmap / Q3" });
      const byId = shortcutByIdAliasPath(objectType, id);
      const byTitle = shortcutByTitleAliasPath(objectType, "Roadmap / Q3", id);
      const byState = shortcutByStateAliasPath(objectType, "In Progress", id);
      const byAssignee = shortcutByAssigneeAliasPath(objectType, "member-1", id);
      assert.deepEqual(parseShortcutPath(canonical), { objectType, id, alias: "canonical" });
      assert.deepEqual(parseShortcutPath(byId), { objectType, id, alias: "by-id" });
      assert.deepEqual(parseShortcutPath(byTitle), { objectType, id, alias: "by-title" });
      assert.deepEqual(parseShortcutPath(byState), { objectType, id, alias: "by-state" });
      assert.deepEqual(parseShortcutPath(byAssignee), { objectType, id, alias: "by-assignee" });
    }
    assert.throws(() => computeShortcutPath("story", "_index"));
    assert.throws(() => shortcutByIdAliasPath("story", "_index"));
  });

  it("emits a navigable layout manifest", () => {
    const layout = layoutPromptFile();
    assert.ok(layout.content.length >= 1000);
    assert.match(layout.content, /by-state/);
    assert.match(layout.content, /slug__id/);
    assert.match(layout.content, /jq/);
    assert.match(layout.content, /_index\.json/);
  });

  it("emits every writable resource with canonical records, indexes, and by-id aliases", async () => {
    for (const resource of resources) {
      assert.equal(resource.pathPattern.test(`${resource.path}/_index.json`), false, `${resource.name} index must not be writable`);
    }
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
    assert.ok(relay.files.has(computeShortcutRecordPath("story", { id: 35, name: "Completed" })));
    assert.ok(relay.files.has(shortcutByIdAliasPath("story", 35)));
    assert.ok(relay.files.has(shortcutByStateAliasPath("story", 500000009, 35)));
    assert.match(relay.files.get(computeShortcutRecordPath("story", { id: 35, name: "Completed" })) ?? "", /"completed": true/);
    assert.equal(
      relay.files.get(computeShortcutRecordPath("story", { id: 35, name: "Completed" })),
      relay.files.get(shortcutByIdAliasPath("story", 35)),
    );
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
    const expectedNames: Record<string, string> = {
      categories: "Engineering",
      "custom-fields": "Priority",
      epics: "Archived epic",
      groups: "Product",
      iterations: "Sprint 1",
      labels: "Important",
      members: "Design partner",
      milestones: "Launch",
      projects: "Relayfile",
      stories: "Completed",
      workflows: "Default",
    };
    for (const resource of resources) {
      const objectType = normalizeShortcutObjectType(resource.name);
      const id = expectedIds[resource.name] ?? `${objectType}-1`;
      assert.ok(relay.files.has(shortcutIndexPath(objectType)), `${resource.name} index missing`);
      assert.ok(relay.files.has(computeShortcutRecordPath(objectType, { id, name: expectedNames[resource.name] })), `${resource.name} canonical missing`);
      assert.ok(relay.files.has(shortcutByIdAliasPath(objectType, id)), `${resource.name} alias missing`);
    }
  });

  it("keeps index rows and aliases collision-safe across webhook-sized updates", async () => {
    const relay = client();
    await emitShortcutAuxiliaryFiles(relay, {
      workspaceId: "workspace",
      stories: [
        { id: 35, name: "Roadmap / Q3", workflow_state_id: 500000009, owner_ids: ["member-1"], updated_at: "2026-08-01T00:00:00.000Z" },
        { id: 36, name: "Roadmap Q3", workflow_state_id: 500000009, owner_ids: ["member-1"], updated_at: "2026-08-02T00:00:00.000Z" },
      ],
    });
    const firstIndex = JSON.parse(relay.files.get(shortcutIndexPath("story")) ?? "[]") as Array<{ id: string }>;
    assert.deepEqual(firstIndex.map((row) => row.id), ["36", "35"]);
    assert.ok(relay.files.has(shortcutByAssigneeAliasPath("story", "member-1", 35, true)));
    assert.ok(relay.files.has(shortcutByTitleAliasPath("story", "Roadmap / Q3", 35, true)));
    assert.ok(relay.files.has(shortcutByStateAliasPath("story", 500000009, 35, true)));
    assert.ok(relay.files.has(shortcutByTitleAliasPath("story", "Roadmap Q3", 36, true)));
    assert.ok(relay.files.has(shortcutByStateAliasPath("story", 500000009, 36, true)));
    const stableAlias = shortcutByTitleAliasPath("story", "Roadmap / Q3", 35, true);
    await emitShortcutAuxiliaryFiles(relay, {
      workspaceId: "workspace",
      stories: [{ id: 35, name: "Roadmap / Q3", workflow_state_id: 500000009, owner_ids: ["member-1"], updated_at: "2026-08-02T12:00:00.000Z" }],
    });
    assert.ok(relay.files.has(stableAlias), "collision suffix changed during partial re-emission");
    await emitShortcutAuxiliaryFiles(relay, {
      workspaceId: "workspace",
      stories: [{ id: 35, name: "Renamed", workflow_state_id: 500000010, owner_ids: ["member-2"], updated_at: "2026-08-03T00:00:00.000Z" }],
    });
    const secondIndex = JSON.parse(relay.files.get(shortcutIndexPath("story")) ?? "[]") as Array<{ id: string }>;
    assert.deepEqual(secondIndex.map((row) => row.id), ["35", "36"]);
    assert.ok(!relay.files.has(shortcutByTitleAliasPath("story", "Roadmap / Q3", 35, true)));
    assert.ok(relay.files.has(shortcutByAssigneeAliasPath("story", "member-2", 35)));

    const uniqueRelay = client();
    await emitShortcutAuxiliaryFiles(uniqueRelay, {
      workspaceId: "workspace",
      stories: [{ id: 40, name: "Unique", workflow_state_id: 500000011, owner_ids: ["member-4"] }],
    });
    await emitShortcutAuxiliaryFiles(uniqueRelay, {
      workspaceId: "workspace",
      stories: [{ id: 41, name: "Unique", workflow_state_id: 500000011, owner_ids: ["member-4"] }, { id: 40, name: "Unique", workflow_state_id: 500000011, owner_ids: ["member-4"] }],
    });
    assert.ok(uniqueRelay.files.has(shortcutByTitleAliasPath("story", "Unique", 40, true)));
    assert.ok(!uniqueRelay.files.has(shortcutByTitleAliasPath("story", "Unique", 40)));
    await emitShortcutAuxiliaryFiles(uniqueRelay, {
      workspaceId: "workspace",
      stories: [{ id: 40, _deleted: true }],
    });
    assert.ok(uniqueRelay.files.has(shortcutByTitleAliasPath("story", "Unique", 41)));
    assert.ok(uniqueRelay.files.has(shortcutByStateAliasPath("story", 500000011, 41)));
    assert.ok(uniqueRelay.files.has(shortcutByAssigneeAliasPath("story", "member-4", 41)));
    assert.ok(!uniqueRelay.files.has(shortcutByTitleAliasPath("story", "Unique", 41, true)));
    assert.ok(!uniqueRelay.files.has(shortcutByStateAliasPath("story", 500000011, 41, true)));
    assert.ok(!uniqueRelay.files.has(shortcutByAssigneeAliasPath("story", "member-4", 41, true)));
    assert.ok(!uniqueRelay.files.has(shortcutByTitleAliasPath("story", "Unique", 40)));
    assert.ok(!uniqueRelay.files.has(shortcutByTitleAliasPath("story", "Unique", 40, true)));
  });

  it("reports delete failures when the client cannot delete files", async () => {
    const result = await emitShortcutAuxiliaryFiles({
      async writeFile() {},
    }, {
      workspaceId: "workspace",
      stories: [{ id: 35, _deleted: true }],
    });
    assert.ok(result.errors.some((error) => error.path.includes("stories/35.json")));
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
          {
            id: "story-36",
            timestamp: "2026-08-10T12:02:00.000Z",
            action: "update",
            canonicalPath: "/shortcut/stories/36.json",
            content: { completed: true },
          },
          {
            id: "story-37",
            timestamp: "2026-08-10T12:03:00.000Z",
            action: "update",
            canonicalPath: "/shortcut/stories/37.json",
            content: { state: "canceled" },
          },
        ];
      },
    });

    assert.deepEqual(section?.bullets.map((bullet) => bullet.text), [
      "35 was completed",
      "16 was archived",
      "36 was completed",
      "37 was canceled",
    ]);
  });
});
