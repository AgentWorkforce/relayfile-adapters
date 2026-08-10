export const SHORTCUT_PATH_ROOT = "/shortcut" as const;

export const SHORTCUT_OBJECT_TYPES = [
  "category",
  "custom-field",
  "epic",
  "group",
  "iteration",
  "label",
  "member",
  "milestone",
  "project",
  "story",
  "workflow",
] as const;
export type ShortcutPathObjectType = (typeof SHORTCUT_OBJECT_TYPES)[number];

export type ShortcutRecord = Record<string, unknown> & {
  id?: string | number;
  _deleted?: true;
};

export type ShortcutWebhookAction = {
  id: string | number;
  entity_type: string;
  action: string;
  name?: string;
  changes?: unknown;
  [key: string]: unknown;
};
