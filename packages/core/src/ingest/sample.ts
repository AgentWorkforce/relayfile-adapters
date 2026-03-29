import { basename } from "node:path";
import { normalizeSchemaNode } from "./openapi.js";
import { readSourceText } from "./shared.js";
import type { SchemaNode, ServiceSpec } from "./types.js";

export async function loadSampleSpec(
  source: string | string[],
  cwd = process.cwd()
): Promise<ServiceSpec> {
  const samplePaths = Array.isArray(source) ? source : [source];
  const webhookSchemas: Record<string, SchemaNode> = {};

  for (const samplePath of samplePaths) {
    const text = await readSourceText(samplePath, cwd);
    const parsed = JSON.parse(text) as unknown;
    const eventName = inferEventName(parsed, samplePath);
    webhookSchemas[eventName] = inferSchemaFromSample(parsed);
  }

  return {
    title: "Webhook Samples",
    version: "0.0.0",
    sourceKind: "samples",
    sourceLocation: samplePaths.join(","),
    endpoints: [],
    schemas: {},
    webhookSchemas,
  };
}

export function inferSchemaFromSample(value: unknown): SchemaNode {
  if (value === null) {
    return { type: "null", raw: { type: "null" } };
  }
  if (Array.isArray(value)) {
    return normalizeSchemaNode({
      type: "array",
      items: value.length > 0 ? inferSchemaFromSample(value[0]).raw ?? {} : {},
    });
  }
  if (typeof value === "string") {
    return normalizeSchemaNode({ type: "string" });
  }
  if (typeof value === "number") {
    return normalizeSchemaNode({
      type: Number.isInteger(value) ? "integer" : "number",
    });
  }
  if (typeof value === "boolean") {
    return normalizeSchemaNode({ type: "boolean" });
  }
  if (typeof value === "object") {
    const properties = Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        inferSchemaFromSample(child).raw ?? {},
      ])
    );
    return normalizeSchemaNode({
      type: "object",
      properties,
      required: Object.keys(value),
    });
  }

  return normalizeSchemaNode({});
}

function inferEventName(value: unknown, samplePath: string): string {
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    if (typeof record.event === "object" && record.event !== null) {
      const eventType = (record.event as Record<string, unknown>).type;
      if (typeof eventType === "string" && eventType.trim()) {
        return eventType;
      }
    }
    if (typeof record.type === "string" && record.type.trim()) {
      return record.type;
    }
  }

  return basename(samplePath).replace(/\.(json|ya?ml)$/i, "");
}
