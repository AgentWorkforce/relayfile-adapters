import YAML from "yaml";
import type { MappingSpec } from "../spec/types.js";
import type {
  DocsLlmConfig,
  DocsSourceConfig,
  DocsSyncConfig,
  ExtractedAPI,
  ExtractedEndpoint,
  ExtractedWebhook,
} from "./types.js";

export interface MappingGeneratorOptions {
  serviceName: string;
  docsSource?: DocsSourceConfig;
  sync?: DocsSyncConfig;
  llm?: DocsLlmConfig;
}

export class MappingGenerator {
  generate(extracted: ExtractedAPI, options: MappingGeneratorOptions): string {
    return YAML.stringify(this.generateObject(extracted, options), {
      lineWidth: 0,
    });
  }

  generateObject(
    extracted: ExtractedAPI,
    options: MappingGeneratorOptions
  ): MappingSpec {
    const webhooks = Object.fromEntries(
      extracted.webhooks.map((webhook) => [
        webhook.event,
        {
          path: inferWebhookPath(options.serviceName, webhook),
        },
      ])
    );

    const resources = Object.fromEntries(
      extracted.endpoints
        .filter((endpoint) => endpoint.method.toUpperCase() === "GET")
        .map((endpoint) => [
          inferResourceName(endpoint),
          {
            endpoint: `${endpoint.method.toUpperCase()} ${endpoint.path}`,
            path: inferResourcePath(options.serviceName, endpoint),
          },
        ])
    );

    return {
      adapter: {
        name: options.serviceName,
        version: "1.0.0",
        source: {
          docs: options.docsSource,
          sync: options.sync,
          llm: options.llm
            ? {
                provider: options.llm.provider,
                endpoint: options.llm.endpoint,
                model: options.llm.model,
                maxTokens: options.llm.maxTokens,
                concurrency: options.llm.concurrency,
                chunkSize: options.llm.chunkSize,
              }
            : undefined,
        },
      },
      webhooks,
      resources,
      writebacks: {},
    };
  }
}

function inferWebhookPath(serviceName: string, webhook: ExtractedWebhook): string {
  const slug = slugify(webhook.event);
  const idField =
    webhook.idField ??
    inferIdentifierField(webhook.payloadShape) ??
    "id";
  return `/${serviceName}/events/${slug}/{{${idField}}}.json`;
}

function inferResourcePath(
  serviceName: string,
  endpoint: ExtractedEndpoint
): string {
  const rawSegments = endpoint.path.split("/").filter(Boolean);
  const segments = rawSegments.map((segment) =>
    segment.startsWith("{") && segment.endsWith("}")
      ? `{{${segment.slice(1, -1)}}}`
      : slugify(segment)
  );

  const last = segments[segments.length - 1];
  if (!last) {
    return `/${serviceName}/index.json`;
  }

  if (last.startsWith("{{")) {
    return `/${serviceName}/${segments.join("/")}/metadata.json`;
  }

  return `/${serviceName}/${segments.join("/")}/index.json`;
}

function inferResourceName(endpoint: ExtractedEndpoint): string {
  const segments = endpoint.path
    .split("/")
    .filter(Boolean)
    .filter((segment) => !(segment.startsWith("{") && segment.endsWith("}")));

  return slugify([endpoint.method.toLowerCase(), ...segments].join("-"));
}

function inferIdentifierField(shape: Record<string, unknown> | undefined): string | undefined {
  if (!shape) {
    return undefined;
  }
  const candidates = ["id", "data.id", "event.id", "object.id"];
  return candidates.find((candidate) => hasPath(shape, candidate));
}

function hasPath(value: Record<string, unknown>, path: string): boolean {
  const [head, ...rest] = path.split(".");
  if (!(head in value)) {
    return false;
  }
  if (rest.length === 0) {
    return true;
  }
  const child = value[head];
  return typeof child === "object" && child !== null && !Array.isArray(child)
    ? hasPath(child as Record<string, unknown>, rest.join("."))
    : false;
}

function slugify(value: string): string {
  return value
    .replace(/[{}]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}
