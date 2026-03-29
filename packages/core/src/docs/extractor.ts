import type {
  DocPage,
  DocsLlmConfig,
  ExtractedAPI,
  ExtractedEndpoint,
  ExtractedError,
  ExtractedParameter,
  ExtractedWebhook,
} from "./types.js";

export interface APIExtractorOptions extends DocsLlmConfig {
  fetchImpl?: typeof fetch;
}

const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    endpoints: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          method: { type: "string" },
          path: { type: "string" },
          summary: { type: "string" },
          description: { type: "string" },
          parameters: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                name: { type: "string" },
                in: { type: "string" },
                type: { type: "string" },
                required: { type: "boolean" },
                description: { type: "string" },
              },
              required: ["name", "in", "type", "required"],
            },
          },
          requestShape: { type: "object" },
          responseShape: { type: "object" },
        },
        required: ["method", "path", "parameters"],
      },
    },
    webhooks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          event: { type: "string" },
          summary: { type: "string" },
          deliveryFormat: { type: "string" },
          idField: { type: "string" },
          payloadShape: { type: "object" },
        },
        required: ["event"],
      },
    },
    auth: {
      type: "object",
      additionalProperties: false,
      properties: {
        type: { type: "string" },
        headerName: { type: "string" },
        location: { type: "string" },
        name: { type: "string" },
      },
    },
    rateLimits: {
      type: "array",
      items: { type: "string" },
    },
    errors: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          status: { type: "string" },
          description: { type: "string" },
          shape: { type: "object" },
        },
      },
    },
  },
  required: ["endpoints", "webhooks"],
} as const;

export class APIExtractor {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: APIExtractorOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async extract(pages: DocPage[]): Promise<ExtractedAPI> {
    const chunks = createChunks(pages, this.options.chunkSize ?? 12_000);
    const results = await mapWithConcurrency(
      chunks,
      Math.max(this.options.concurrency ?? 3, 1),
      async (chunk) => this.extractChunk(chunk)
    );

    return results.reduce<ExtractedAPI>(
      (merged, current) => mergeExtractions(merged, current),
      { endpoints: [], webhooks: [] }
    );
  }

  private async extractChunk(chunk: string): Promise<ExtractedAPI> {
    const provider = resolveProvider(this.options);
    const response = await this.fetchImpl(provider.endpoint, {
      method: "POST",
      headers: provider.headers,
      body: JSON.stringify(provider.body(chunk, this.options)),
    });
    if (!response.ok) {
      throw new Error(
        `LLM extraction failed: ${response.status} ${response.statusText}`
      );
    }

    const raw = await response.json();
    const text = provider.read(raw);
    const parsed = parseJsonObject(text);
    return normalizeExtraction(parsed);
  }
}

function resolveProvider(options: APIExtractorOptions): {
  endpoint: string;
  headers: Record<string, string>;
  body: (chunk: string, config: APIExtractorOptions) => Record<string, unknown>;
  read: (value: unknown) => string;
} {
  const provider =
    options.provider ??
    (options.endpoint?.includes("openai") ? "openai" : "anthropic");

  if (provider === "openai") {
    const endpoint = options.endpoint ?? "https://api.openai.com/v1/chat/completions";
    const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is required for docs extraction");
    }
    return {
      endpoint,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
        ...(options.headers ?? {}),
      },
      body: (chunk) => ({
        model: options.model ?? "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Extract API structure from documentation and return only JSON matching the provided schema.",
          },
          {
            role: "user",
            content: buildPrompt(chunk),
          },
        ],
      }),
      read: (value) => {
        const record = asRecord(value);
        const choices = Array.isArray(record?.choices) ? record.choices : [];
        const first = asRecord(choices[0]);
        const message = asRecord(first?.message);
        return readMessageText(message?.content);
      },
    };
  }

  if (provider === "custom") {
    const endpoint = options.endpoint;
    if (!endpoint) {
      throw new Error("Custom extraction provider requires an endpoint");
    }
    return {
      endpoint,
      headers: {
        "content-type": "application/json",
        ...(options.headers ?? {}),
      },
      body: (chunk) => ({
        model: options.model,
        maxTokens: options.maxTokens ?? 4_096,
        schema: EXTRACTION_SCHEMA,
        prompt: buildPrompt(chunk),
      }),
      read: (value) => {
        const record = asRecord(value);
        return (
          readMessageText(record?.output) ??
          readMessageText(record?.content) ??
          readMessageText(record?.text) ??
          JSON.stringify(value)
        );
      },
    };
  }

  const endpoint = options.endpoint ?? "https://api.anthropic.com/v1/messages";
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is required for docs extraction");
  }
  return {
    endpoint,
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      ...(options.headers ?? {}),
    },
    body: (chunk) => ({
      model: options.model ?? "claude-3-5-sonnet-latest",
      max_tokens: options.maxTokens ?? 4_096,
      system:
        "Extract API structure from documentation and return JSON only. Match the provided schema exactly.",
      messages: [
        {
          role: "user",
          content: buildPrompt(chunk),
        },
      ],
    }),
    read: (value) => {
      const record = asRecord(value);
      const content = Array.isArray(record?.content) ? record.content : [];
      return content
        .map((item) => asRecord(item)?.text)
        .filter((item): item is string => typeof item === "string")
        .join("\n");
    },
  };
}

function buildPrompt(chunk: string): string {
  return [
    "You are extracting API structure from documentation.",
    "Return a JSON object that matches this schema exactly.",
    JSON.stringify(EXTRACTION_SCHEMA),
    "Only include endpoints and webhooks that are explicitly described in the docs.",
    "Use HTTP methods and absolute paths like GET /widgets/{id}.",
    "Represent request and response bodies as JSON-like object shapes.",
    "",
    "Documentation chunk:",
    chunk,
  ].join("\n");
}

function createChunks(pages: DocPage[], chunkSize: number): string[] {
  const chunks: string[] = [];
  let current = "";

  for (const page of pages) {
    const section = `# ${page.title}\nURL: ${page.url}\n\n${page.content}`;
    if (section.length > chunkSize) {
      for (const piece of splitLongText(section, chunkSize)) {
        if (current) {
          chunks.push(current);
          current = "";
        }
        chunks.push(piece);
      }
      continue;
    }

    if ((current + section).length > chunkSize) {
      chunks.push(current);
      current = section;
      continue;
    }

    current = current ? `${current}\n\n---\n\n${section}` : section;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks.length > 0 ? chunks : [""];
}

function splitLongText(text: string, chunkSize: number): string[] {
  const paragraphs = text.split(/\n{2,}/);
  const output: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if ((current + paragraph).length > chunkSize) {
      if (current) {
        output.push(current);
      }
      if (paragraph.length > chunkSize) {
        for (let index = 0; index < paragraph.length; index += chunkSize) {
          output.push(paragraph.slice(index, index + chunkSize));
        }
        current = "";
        continue;
      }
      current = paragraph;
      continue;
    }

    current = current ? `${current}\n\n${paragraph}` : paragraph;
  }

  if (current) {
    output.push(current);
  }

  return output;
}

async function mapWithConcurrency<TInput, TOutput>(
  input: TInput[],
  concurrency: number,
  worker: (value: TInput) => Promise<TOutput>
): Promise<TOutput[]> {
  const output = new Array<TOutput>(input.length);
  let cursor = 0;

  async function run(): Promise<void> {
    while (cursor < input.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await worker(input[index] as TInput);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, input.length) }, run));
  return output;
}

function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first < 0 || last < 0 || last <= first) {
      throw new Error("Extractor did not return JSON");
    }
    return JSON.parse(trimmed.slice(first, last + 1));
  }
}

function normalizeExtraction(value: unknown): ExtractedAPI {
  const record = asRecord(value);
  return {
    title: readOptionalString(record?.title),
    description: readOptionalString(record?.description),
    endpoints: (Array.isArray(record?.endpoints) ? record.endpoints : [])
      .map(normalizeEndpoint)
      .filter((endpoint): endpoint is ExtractedEndpoint => endpoint !== undefined),
    webhooks: (Array.isArray(record?.webhooks) ? record.webhooks : [])
      .map(normalizeWebhook)
      .filter((webhook): webhook is ExtractedWebhook => webhook !== undefined),
    auth: normalizeAuth(record?.auth),
    rateLimits: normalizeStringArray(record?.rateLimits),
    errors: normalizeErrors(record?.errors),
  };
}

function normalizeEndpoint(value: unknown): ExtractedEndpoint | undefined {
  const record = asRecord(value);
  const method = readOptionalString(record?.method)?.toUpperCase();
  const path = readOptionalString(record?.path);
  if (!method || !path) {
    return undefined;
  }

  return {
    method,
    path,
    summary: readOptionalString(record?.summary),
    description: readOptionalString(record?.description),
    parameters: (Array.isArray(record?.parameters) ? record.parameters : [])
      .map(normalizeParameter)
      .filter((item): item is ExtractedParameter => item !== undefined),
    requestShape: asShape(record?.requestShape),
    responseShape: asShape(record?.responseShape),
  };
}

function normalizeParameter(value: unknown): ExtractedParameter | undefined {
  const record = asRecord(value);
  const name = readOptionalString(record?.name);
  const location = readOptionalString(record?.in);
  const type = readOptionalString(record?.type);
  if (!name || !location || !type) {
    return undefined;
  }
  if (
    location !== "body" &&
    location !== "header" &&
    location !== "path" &&
    location !== "query"
  ) {
    return undefined;
  }
  return {
    name,
    in: location,
    type,
    required: record?.required !== false,
    description: readOptionalString(record?.description),
  };
}

function normalizeWebhook(value: unknown): ExtractedWebhook | undefined {
  const record = asRecord(value);
  const event = readOptionalString(record?.event);
  if (!event) {
    return undefined;
  }

  return {
    event,
    summary: readOptionalString(record?.summary),
    deliveryFormat: readOptionalString(record?.deliveryFormat),
    idField: readOptionalString(record?.idField),
    payloadShape: asShape(record?.payloadShape),
  };
}

function normalizeAuth(value: unknown): ExtractedAPI["auth"] {
  const record = asRecord(value);
  const type = readOptionalString(record?.type);
  if (
    type !== "api-key" &&
    type !== "basic" &&
    type !== "bearer" &&
    type !== "none" &&
    type !== "oauth2"
  ) {
    return undefined;
  }
  const location = readOptionalString(record?.location);
  return {
    type,
    headerName: readOptionalString(record?.headerName),
    location:
      location === "cookie" || location === "header" || location === "query"
        ? location
        : undefined,
    name: readOptionalString(record?.name),
  };
}

function normalizeErrors(value: unknown): ExtractedError[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const errors = value
    .map((item) => {
      const record = asRecord(item);
      return {
        status: readOptionalString(record?.status),
        description: readOptionalString(record?.description),
        shape: asShape(record?.shape),
      };
    })
    .filter((item) => item.status || item.description || item.shape);
  return errors.length > 0 ? errors : undefined;
}

function mergeExtractions(left: ExtractedAPI, right: ExtractedAPI): ExtractedAPI {
  const endpoints = new Map<string, ExtractedEndpoint>();
  for (const endpoint of [...left.endpoints, ...right.endpoints]) {
    const key = `${endpoint.method.toUpperCase()} ${endpoint.path}`;
    const existing = endpoints.get(key);
    endpoints.set(key, existing ? mergeEndpoint(existing, endpoint) : endpoint);
  }

  const webhooks = new Map<string, ExtractedWebhook>();
  for (const webhook of [...left.webhooks, ...right.webhooks]) {
    const existing = webhooks.get(webhook.event);
    webhooks.set(
      webhook.event,
      existing ? mergeWebhook(existing, webhook) : webhook
    );
  }

  return {
    title: left.title ?? right.title,
    description: left.description ?? right.description,
    endpoints: [...endpoints.values()],
    webhooks: [...webhooks.values()],
    auth: left.auth?.type === "none" ? right.auth : left.auth ?? right.auth,
    rateLimits: dedupeStrings([...(left.rateLimits ?? []), ...(right.rateLimits ?? [])]),
    errors: mergeErrors(left.errors ?? [], right.errors ?? []),
  };
}

function mergeEndpoint(
  left: ExtractedEndpoint,
  right: ExtractedEndpoint
): ExtractedEndpoint {
  const parameters = new Map<string, ExtractedParameter>();
  for (const parameter of [...left.parameters, ...right.parameters]) {
    const key = `${parameter.in}:${parameter.name}`;
    const existing = parameters.get(key);
    parameters.set(
      key,
      existing
        ? {
            ...existing,
            required: existing.required || parameter.required,
            description: existing.description ?? parameter.description,
          }
        : parameter
    );
  }

  return {
    method: left.method,
    path: left.path,
    summary: left.summary ?? right.summary,
    description: left.description ?? right.description,
    parameters: [...parameters.values()],
    requestShape: mergeShape(left.requestShape, right.requestShape),
    responseShape: mergeShape(left.responseShape, right.responseShape),
  };
}

function mergeWebhook(
  left: ExtractedWebhook,
  right: ExtractedWebhook
): ExtractedWebhook {
  return {
    event: left.event,
    summary: left.summary ?? right.summary,
    deliveryFormat: left.deliveryFormat ?? right.deliveryFormat,
    idField: left.idField ?? right.idField,
    payloadShape: mergeShape(left.payloadShape, right.payloadShape),
  };
}

function mergeErrors(left: ExtractedError[], right: ExtractedError[]): ExtractedError[] {
  const byStatus = new Map<string, ExtractedError>();
  for (const error of [...left, ...right]) {
    const key = error.status ?? error.description ?? JSON.stringify(error.shape ?? {});
    const existing = byStatus.get(key);
    byStatus.set(key, {
      status: existing?.status ?? error.status,
      description: existing?.description ?? error.description,
      shape: mergeShape(existing?.shape, error.shape),
    });
  }
  return [...byStatus.values()];
}

function mergeShape(
  left: Record<string, unknown> | undefined,
  right: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }

  const output: Record<string, unknown> = { ...left };
  for (const [key, value] of Object.entries(right)) {
    const existing = output[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      output[key] = mergeShape(existing, value);
      continue;
    }
    if (Array.isArray(existing) && Array.isArray(value) && existing.length > 0 && value.length > 0) {
      output[key] = [mergeArrayItem(existing[0], value[0])];
      continue;
    }
    if (existing === undefined) {
      output[key] = value;
    }
  }
  return output;
}

function mergeArrayItem(left: unknown, right: unknown): unknown {
  if (isPlainObject(left) && isPlainObject(right)) {
    return mergeShape(left, right);
  }
  return left ?? right;
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const list = dedupeStrings(
    value.filter(
      (item): item is string =>
        typeof item === "string" && item.trim().length > 0
    )
  );
  return list.length > 0 ? list : undefined;
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function asShape(value: unknown): Record<string, unknown> | undefined {
  return isPlainObject(value) ? (value as Record<string, unknown>) : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isPlainObject(value) ? (value as Record<string, unknown>) : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readMessageText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        return asRecord(item)?.text;
      })
      .filter((item): item is string => typeof item === "string")
      .join("\n");
  }
  if (value && typeof value === "object") {
    const text = asRecord(value)?.text;
    return typeof text === "string" ? text : JSON.stringify(value);
  }
  return "";
}
