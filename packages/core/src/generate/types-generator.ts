import type { SchemaNode, ServiceSpec } from "../ingest/types.js";

export function generateTypeDefinitions(serviceSpec: ServiceSpec): string {
  const lines: string[] = [
    "/* eslint-disable */",
    `// Generated from ${serviceSpec.sourceKind}: ${serviceSpec.sourceLocation}`,
    "",
  ];

  for (const [name, schema] of Object.entries(serviceSpec.schemas)) {
    lines.push(renderNamedType(name, schema));
    lines.push("");
  }

  for (const [name, schema] of Object.entries(serviceSpec.webhookSchemas)) {
    lines.push(renderNamedType(`${toPascalCase(name)}Webhook`, schema));
    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
}

function renderNamedType(name: string, schema: SchemaNode): string {
  const typeName = toPascalCase(name);
  const body = renderType(schema, { rootName: typeName });

  if (schema.type === "object" && schema.properties) {
    return `export interface ${typeName} ${body}`;
  }

  return `export type ${typeName} = ${body};`;
}

function renderType(
  schema: SchemaNode,
  context: { rootName: string }
): string {
  if (schema.ref) {
    return toPascalCase(schema.ref.replace(/^#\/components\/schemas\//, ""));
  }

  const unions = schema.oneOf ?? schema.anyOf;
  if (unions && unions.length > 0) {
    return unions.map((item, index) => renderType(item, {
      rootName: `${context.rootName}${index + 1}`,
    })).join(" | ");
  }

  if (schema.allOf && schema.allOf.length > 0) {
    return schema.allOf.map((item, index) => renderType(item, {
      rootName: `${context.rootName}${index + 1}`,
    })).join(" & ");
  }

  if (schema.enum && schema.enum.length > 0) {
    return schema.enum.map((item) => JSON.stringify(item)).join(" | ");
  }

  let baseType: string;
  switch (schema.type) {
    case "array":
      baseType = `${renderType(schema.items ?? {}, { rootName: `${context.rootName}Item` })}[]`;
      break;
    case "boolean":
      baseType = "boolean";
      break;
    case "integer":
    case "number":
      baseType = "number";
      break;
    case "null":
      baseType = "null";
      break;
    case "object":
      baseType = renderObjectType(schema, context);
      break;
    case "string":
      baseType = "string";
      break;
    default:
      baseType = "unknown";
      break;
  }

  return schema.nullable ? `${baseType} | null` : baseType;
}

function renderObjectType(
  schema: SchemaNode,
  context: { rootName: string }
): string {
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const entries = Object.entries(properties);

  if (entries.length === 0 && schema.additionalProperties) {
    if (schema.additionalProperties === true) {
      return "Record<string, unknown>";
    }
    return `Record<string, ${renderType(schema.additionalProperties, {
      rootName: `${context.rootName}Value`,
    })}>`;
  }

  const lines = ["{"]; 
  for (const [key, value] of entries) {
    const optional = required.has(key) ? "" : "?";
    lines.push(
      `  ${JSON.stringify(key)}${optional}: ${renderType(value, {
        rootName: `${context.rootName}${toPascalCase(key)}`,
      })};`
    );
  }
  if (schema.additionalProperties && schema.additionalProperties !== true) {
    lines.push(
      `  [key: string]: ${renderType(schema.additionalProperties, {
        rootName: `${context.rootName}Value`,
      })};`
    );
  }
  lines.push("}");
  return lines.join("\n");
}

function toPascalCase(value: string): string {
  return value
    .replace(/^[^a-zA-Z]+/, "")
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((segment) => segment[0]!.toUpperCase() + segment.slice(1))
    .join("") || "Anonymous";
}
