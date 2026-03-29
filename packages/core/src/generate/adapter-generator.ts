import type { ServiceSpec } from "../ingest/types.js";
import type { MappingSpec } from "../spec/types.js";

export function generateAdapterModule(
  spec: MappingSpec,
  serviceSpec: ServiceSpec
): string {
  const serializedSpec = JSON.stringify(spec, null, 2);
  const serializedSummary = JSON.stringify(
    {
      title: serviceSpec.title,
      version: serviceSpec.version,
      sourceKind: serviceSpec.sourceKind,
      endpoints: serviceSpec.endpoints.map((endpoint) => endpoint.key),
      webhooks: Object.keys(serviceSpec.webhookSchemas),
    },
    null,
    2
  );

  return `/* eslint-disable */
// Generated from ${serviceSpec.sourceKind}: ${serviceSpec.sourceLocation}

export const mappingSpec = ${serializedSpec} as const;
export const serviceSummary = ${serializedSummary} as const;

type WebhookEvent = {
  eventType: string;
  objectType: string;
  payload: Record<string, unknown>;
};

type WritebackMatch = {
  name: string;
  endpoint: string;
  params: Record<string, string>;
} | null;

export function computePath(event: WebhookEvent): string {
  const mapping = resolveWebhookMapping(event);
  return interpolate(mapping.path, event.payload);
}

export function normalizeWebhook(event: WebhookEvent): Record<string, unknown> {
  const mapping = resolveWebhookMapping(event);
  if (!mapping.extract || mapping.extract.length === 0) {
    return event.payload;
  }

  const output: Record<string, unknown> = {};
  for (const field of mapping.extract) {
    const value = get(event.payload, field);
    if (value !== undefined) {
      output[field] = value;
    }
  }
  return output;
}

export function matchWriteback(path: string): WritebackMatch {
  const writebacks = mappingSpec.writebacks ?? {};
  for (const [name, mapping] of Object.entries(writebacks)) {
    if (!globMatch(mapping.match, path)) {
      continue;
    }
    const params = captureWritebackParams(mapping.match, mapping.endpoint, path);
    return { name, endpoint: mapping.endpoint, params };
  }
  return null;
}

function resolveWebhookMapping(event: WebhookEvent) {
  const root = event.eventType.split(".")[0] ?? event.eventType;
  return (
    mappingSpec.webhooks[event.eventType] ??
    mappingSpec.webhooks[event.objectType] ??
    mappingSpec.webhooks[root]
  );
}

function get(input: unknown, field: string): unknown {
  const segments = field.split(".");
  let cursor = input;
  for (const segment of segments) {
    if (!cursor || typeof cursor !== "object") {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

function interpolate(template: string, payload: Record<string, unknown>): string {
  return template.replace(/\\{\\{\\s*([^}]+?)\\s*\\}\\}/g, (_match, field) => {
    const value = get(payload, field);
    if (value === undefined || value === null) {
      throw new Error(\`Missing template field "\${field}"\`);
    }
    return encodeURIComponent(String(value));
  });
}

function globMatch(pattern: string, value: string): boolean {
  const escaped = pattern.split("*").map(escapeRegex).join(".*");
  return new RegExp(\`^\${escaped}$\`).test(value);
}

function captureWritebackParams(
  matchPattern: string,
  endpoint: string,
  actualPath: string
): Record<string, string> {
  const regex = new RegExp(
    \`^\${matchPattern.split("*").map(escapeRegex).join("(.+?)")}$\`
  );
  const captures = actualPath.match(regex)?.slice(1) ?? [];
  const params = [...endpoint.matchAll(/\\{([^}]+)\\}/g)].map((item) => item[1]);
  return Object.fromEntries(params.map((param, index) => [param, decodeURIComponent(captures[index] ?? "")]));
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^\\\${}()|[\\\\]\\\\]/g, "\\\\$&");
}
`;
}
