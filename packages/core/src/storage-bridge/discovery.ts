import {
  ReadOnlyFieldError,
  type AdapterResourceConfig,
  type AdapterResourceOperation,
} from "../runtime/file-native-router.js";
import type { JsonValue } from "./event.js";

export {
  ReadOnlyFieldError,
  type AdapterResourceConfig,
  type AdapterResourceOperation,
};

export interface JsonSchemaObject {
  readonly $schema?: string;
  readonly type?: string | readonly string[];
  readonly readOnly?: boolean;
  readonly properties?: Record<string, JsonSchemaObject>;
  readonly items?: JsonSchemaObject;
  readonly anyOf?: readonly JsonSchemaObject[];
  readonly oneOf?: readonly JsonSchemaObject[];
  readonly allOf?: readonly JsonSchemaObject[];
  readonly additionalProperties?: boolean | JsonSchemaObject;
  readonly [key: string]: unknown;
}

export function findResourceByPath(
  resources: readonly AdapterResourceConfig[],
  path: string,
): AdapterResourceConfig | undefined {
  const normalizedPath = path.endsWith(".json") ? path : path.replace(/\/$/, "");
  return resources.find((resource) => resource.pathPattern.test(normalizedPath));
}

export function assertReadOnlyFieldsRejected(
  schema: JsonSchemaObject,
  patch: Record<string, unknown>,
): void {
  const readOnlyFields = collectReadOnlyFields(schema);
  const rejected = readOnlyFields.filter((field) => hasPath(patch, field));
  if (rejected.length > 0) {
    throw new ReadOnlyFieldError(rejected[0]!);
  }
}

export function collectReadOnlyFields(
  schema: JsonSchemaObject,
  prefix = "",
): string[] {
  const fields: string[] = [];
  for (const [name, child] of Object.entries(schema.properties ?? {})) {
    const path = prefix ? `${prefix}.${name}` : name;
    if (child.readOnly) fields.push(path);
    fields.push(...collectReadOnlyFields(child, path));
  }
  for (const branch of [
    ...(schema.anyOf ?? []),
    ...(schema.oneOf ?? []),
    ...(schema.allOf ?? []),
  ]) {
    fields.push(...collectReadOnlyFields(branch, prefix));
  }
  return [...new Set(fields)];
}

export function isJsonRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasPath(value: Record<string, unknown>, path: string): boolean {
  const parts = path.split(".");
  let cursor: unknown = value;
  for (const part of parts) {
    if (!isPlainRecord(cursor) || !(part in cursor)) return false;
    cursor = cursor[part];
  }
  return true;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
