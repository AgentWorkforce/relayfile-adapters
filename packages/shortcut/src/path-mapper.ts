import { SHORTCUT_OBJECT_TYPES, SHORTCUT_PATH_ROOT, type ShortcutPathObjectType } from "./types.js";

const COLLECTIONS: Record<ShortcutPathObjectType, string> = {
  category: "categories",
  "custom-field": "custom-fields",
  epic: "epics",
  group: "groups",
  iteration: "iterations",
  label: "labels",
  member: "members",
  milestone: "milestones",
  project: "projects",
  story: "stories",
  workflow: "workflows",
};

const NANGO_MODEL_MAP: Record<string, ShortcutPathObjectType> = {
  Category: "category",
  CustomField: "custom-field",
  Epic: "epic",
  Group: "group",
  Iteration: "iteration",
  Label: "label",
  Member: "member",
  Milestone: "milestone",
  Project: "project",
  Story: "story",
  Workflow: "workflow",
};

function required(value: string | number, label: string): string {
  const normalized = String(value).trim();
  if (!normalized) throw new Error(`Shortcut ${label} must be non-empty`);
  return normalized;
}

export function encodeShortcutPathSegment(value: string | number): string {
  return encodeURIComponent(required(value, "path segment"));
}

export function normalizeShortcutObjectType(value: string): ShortcutPathObjectType {
  const normalized = value.trim().toLowerCase().replace(/[_-]/g, "");
  const aliases: Record<string, ShortcutPathObjectType> = {
    category: "category",
    categories: "category",
    customfield: "custom-field",
    customfields: "custom-field",
    "custom-field": "custom-field",
    epic: "epic",
    epics: "epic",
    group: "group",
    groups: "group",
    iteration: "iteration",
    iterations: "iteration",
    label: "label",
    labels: "label",
    member: "member",
    members: "member",
    milestone: "milestone",
    milestones: "milestone",
    project: "project",
    projects: "project",
    story: "story",
    stories: "story",
    workflow: "workflow",
    workflows: "workflow",
  };
  const result = aliases[normalized];
  if (!result) throw new Error(`Unsupported Shortcut object type: ${value}`);
  return result;
}

export function tryNormalizeShortcutObjectType(value: string): ShortcutPathObjectType | null {
  try {
    return normalizeShortcutObjectType(value);
  } catch {
    return null;
  }
}

export function normalizeNangoShortcutModel(model: string): ShortcutPathObjectType | null {
  return NANGO_MODEL_MAP[model] ?? tryNormalizeShortcutObjectType(model);
}

export function shortcutCollectionPath(objectType: ShortcutPathObjectType): string {
  return `${SHORTCUT_PATH_ROOT}/${COLLECTIONS[objectType]}`;
}

export function shortcutIndexPath(objectType: ShortcutPathObjectType): string {
  return `${shortcutCollectionPath(objectType)}/_index.json`;
}

export function computeShortcutPath(objectType: ShortcutPathObjectType | string, id: string | number): string {
  const normalized = normalizeShortcutObjectType(objectType);
  return `${shortcutCollectionPath(normalized)}/${encodeShortcutPathSegment(id)}.json`;
}

export function shortcutByIdAliasPath(objectType: ShortcutPathObjectType | string, id: string | number): string {
  const normalized = normalizeShortcutObjectType(objectType);
  return `${shortcutCollectionPath(normalized)}/by-id/${encodeShortcutPathSegment(id)}.json`;
}

export function shortcutRootIndexPath(): string {
  return `${SHORTCUT_PATH_ROOT}/_index.json`;
}

export { COLLECTIONS, SHORTCUT_OBJECT_TYPES };
