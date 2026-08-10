import { aliasCollisionSuffix, slugifyAlias } from "@relayfile/adapter-core";
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

const RESERVED_CANONICAL_IDS = new Set(["_index"]);

function required(value: string | number, label: string): string {
  const normalized = String(value).trim();
  if (!normalized) throw new Error(`Shortcut ${label} must be non-empty`);
  return normalized;
}

function requiredRecordId(value: string | number): string {
  const normalized = required(value, "record id");
  if (RESERVED_CANONICAL_IDS.has(normalized)) {
    throw new Error(`Shortcut record id is reserved: ${normalized}`);
  }
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
  return `${shortcutCollectionPath(normalized)}/${encodeShortcutPathSegment(requiredRecordId(id))}.json`;
}

/** Compose the human-readable flat canonical path used for titled records. */
export function computeShortcutRecordPath(
  objectType: ShortcutPathObjectType | string,
  record: Record<string, unknown>,
): string {
  const idValue = record.id;
  if (typeof idValue !== "string" && typeof idValue !== "number") {
    throw new Error("Shortcut record must include a string or numeric id");
  }
  const id = requiredRecordId(idValue);
  const title = typeof record.name === "string"
    ? record.name
    : typeof record.title === "string"
      ? record.title
      : "";
  if (!title.trim()) return computeShortcutPath(objectType, id);
  const normalized = normalizeShortcutObjectType(objectType);
  return `${shortcutCollectionPath(normalized)}/${encodeShortcutPathSegment(`${slugifyAlias(title)}__${id}`)}.json`;
}

export function shortcutByIdAliasPath(
  objectType: ShortcutPathObjectType | string,
  id: string | number,
  colliding = false,
): string {
  const normalized = normalizeShortcutObjectType(objectType);
  const normalizedId = requiredRecordId(id);
  const slug = slugifyAlias(normalizedId);
  const collisionSuffix = colliding ? `-${aliasCollisionSuffix(normalizedId)}` : "";
  return `${shortcutCollectionPath(normalized)}/by-id/${encodeShortcutPathSegment(`${slug}${collisionSuffix}__${normalizedId}`)}.json`;
}

export function shortcutLegacyByIdAliasPath(objectType: ShortcutPathObjectType | string, id: string | number): string {
  const normalized = normalizeShortcutObjectType(objectType);
  return `${shortcutCollectionPath(normalized)}/by-id/${encodeShortcutPathSegment(requiredRecordId(id))}.json`;
}

export function shortcutByTitleAliasPath(
  objectType: ShortcutPathObjectType | string,
  title: string,
  id: string | number,
  colliding = false,
): string {
  return shortcutNaturalAliasPath(objectType, "by-title", title, id, colliding);
}

export function shortcutByStateAliasPath(
  objectType: ShortcutPathObjectType | string,
  state: string | number,
  id: string | number,
  colliding = false,
): string {
  return shortcutNaturalAliasPath(objectType, "by-state", state, id, colliding);
}

export function shortcutByAssigneeAliasPath(
  objectType: ShortcutPathObjectType | string,
  assigneeId: string | number,
  id: string | number,
  colliding = false,
): string {
  return shortcutNaturalAliasPath(objectType, "by-assignee", assigneeId, id, colliding);
}

export function shortcutByCreatorAliasPath(
  objectType: ShortcutPathObjectType | string,
  creatorId: string | number,
  id: string | number,
  colliding = false,
): string {
  return shortcutNaturalAliasPath(objectType, "by-creator", creatorId, id, colliding);
}

export function shortcutByPriorityAliasPath(
  objectType: ShortcutPathObjectType | string,
  priority: string | number,
  id: string | number,
  colliding = false,
): string {
  return shortcutNaturalAliasPath(objectType, "by-priority", priority, id, colliding);
}

function shortcutNaturalAliasPath(
  objectType: ShortcutPathObjectType | string,
  aliasKind: "by-title" | "by-state" | "by-assignee" | "by-creator" | "by-priority",
  value: string | number,
  id: string | number,
  colliding: boolean,
): string {
  const normalized = normalizeShortcutObjectType(objectType);
  const normalizedId = requiredRecordId(id);
  const slug = slugifyAlias(required(value, "alias value"));
  const collisionSuffix = colliding ? `-${aliasCollisionSuffix(normalizedId)}` : "";
  return `${shortcutCollectionPath(normalized)}/${aliasKind}/${encodeShortcutPathSegment(`${slug}${collisionSuffix}__${normalizedId}`)}.json`;
}

export function shortcutRootIndexPath(): string {
  return `${SHORTCUT_PATH_ROOT}/_index.json`;
}

export interface ParsedShortcutPath {
  objectType: ShortcutPathObjectType;
  id: string;
  alias: "canonical" | "by-id" | "by-title" | "by-state" | "by-assignee" | "by-creator" | "by-priority";
}

export function parseShortcutPath(path: string): ParsedShortcutPath | null {
  try {
    const segments = path.replace(/^\/+|\/+$/gu, "").split("/");
    if (segments.length !== 3 && segments.length !== 4) return null;
    if (segments[0] !== SHORTCUT_PATH_ROOT.slice(1)) return null;
    const collection = segments[1];
    const objectType = Object.entries(COLLECTIONS).find(([, value]) => value === collection)?.[0] as ShortcutPathObjectType | undefined;
    if (!objectType) return null;
    const leaf = segments.at(-1) ?? "";
    if (!leaf.endsWith(".json")) return null;
    const filename = decodeURIComponent(leaf.slice(0, -5));
    if (segments.length === 3) {
      if (filename === "_index") return null;
      const separator = filename.lastIndexOf("__");
      const id = separator > 0 ? filename.slice(separator + 2) : filename;
      return { objectType, id: requiredRecordId(id), alias: "canonical" };
    }
    const alias = segments[2] as ParsedShortcutPath["alias"];
    if (!["by-id", "by-title", "by-state", "by-assignee", "by-creator", "by-priority"].includes(alias)) return null;
    const separator = filename.lastIndexOf("__");
    if (separator <= 0 || separator === filename.length - 2) return null;
    return { objectType, id: requiredRecordId(filename.slice(separator + 2)), alias };
  } catch {
    return null;
  }
}

export { COLLECTIONS, SHORTCUT_OBJECT_TYPES };
