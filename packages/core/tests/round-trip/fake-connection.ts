import type {
  ConnectionProvider,
  ProxyHeaders,
  ProxyMethod,
  ProxyQuery,
  ProxyRequest,
  ProxyResponse,
} from "@relayfile/sdk";

export interface HttpReplayRequest {
  method: ProxyMethod;
  baseUrl: string;
  endpoint: string;
  connectionId: string;
  headers?: ProxyHeaders;
  body?: unknown;
  query?: ProxyQuery;
}

export interface HttpReplayInteraction<TData = unknown> {
  id?: string;
  request: HttpReplayRequest;
  response: ProxyResponse<TData>;
}

export interface HttpReplayFixtureObject {
  version?: number;
  provider?: string;
  baseUrl?: string;
  connectionId?: string;
  interactions?: readonly HttpReplayInteraction[];
  requests?: readonly HttpReplayInteraction[];
  http?: readonly HttpReplayInteraction[];
}

export type HttpReplayFixture =
  | readonly HttpReplayInteraction[]
  | HttpReplayFixtureObject;

export interface FakeConnectionProvider extends ConnectionProvider {
  readonly calls: HttpReplayRequest[];
  readonly remaining: number;
  assertExhausted(): void;
}

export interface FakeConnectionOptions {
  name?: string;
}

export function createFakeConnection(
  fixture: HttpReplayFixture,
  options: FakeConnectionOptions = {}
): FakeConnectionProvider {
  const interactions = normalizeFixture(fixture);
  const calls: HttpReplayRequest[] = [];
  let nextInteractionIndex = 0;

  return {
    name: options.name ?? "fake-connection",
    calls,
    get remaining() {
      return interactions.length - nextInteractionIndex;
    },
    async proxy<T = unknown>(
      request: ProxyRequest
    ): Promise<ProxyResponse<T>> {
      const actual = sanitizeRequest(request);
      const interaction = interactions[nextInteractionIndex];
      calls.push(actual);

      if (!interaction) {
        throw new Error(
          [
            `Unexpected HTTP replay call #${calls.length}.`,
            `Received: ${stableStringify(actual)}`,
          ].join("\n")
        );
      }

      const expected = sanitizeRequest(interaction.request);
      if (!requestsMatch(expected, actual)) {
        throw new Error(
          [
            `HTTP replay call #${calls.length} did not match the fixture.`,
            `Expected: ${stableStringify(expected)}`,
            `Received: ${stableStringify(actual)}`,
          ].join("\n")
        );
      }

      nextInteractionIndex += 1;
      return cloneResponse(interaction.response) as ProxyResponse<T>;
    },
    async healthCheck() {
      return true;
    },
    assertExhausted() {
      if (nextInteractionIndex === interactions.length) {
        return;
      }

      const unused = interactions
        .slice(nextInteractionIndex)
        .map((interaction) => sanitizeRequest(interaction.request));
      throw new Error(
        [
          `HTTP replay fixture has ${unused.length} unused interaction(s).`,
          `Unused: ${stableStringify(unused)}`,
        ].join("\n")
      );
    },
  };
}

function normalizeFixture(fixture: HttpReplayFixture): HttpReplayInteraction[] {
  const interactions = Array.isArray(fixture)
    ? fixture
    : fixture.interactions ?? fixture.requests ?? fixture.http;
  const defaults = Array.isArray(fixture)
    ? {}
    : {
        baseUrl: fixture.baseUrl,
        connectionId: fixture.connectionId,
      };

  if (!interactions) {
    throw new Error(
      "HTTP replay fixture must be an array or an object with interactions, requests, or http."
    );
  }

  return interactions.map((interaction, index) =>
    normalizeInteraction(interaction, index, defaults)
  );
}

function normalizeInteraction(
  interaction: HttpReplayInteraction,
  index: number,
  defaults: Partial<Pick<HttpReplayRequest, "baseUrl" | "connectionId">>
): HttpReplayInteraction {
  if (!isRecord(interaction)) {
    throw new Error(`HTTP replay interaction #${index + 1} must be an object.`);
  }
  if (!isRecord(interaction.request)) {
    throw new Error(
      `HTTP replay interaction #${index + 1} must include request.`
    );
  }
  if (!isRecord(interaction.response)) {
    throw new Error(
      `HTTP replay interaction #${index + 1} must include response.`
    );
  }
  if (typeof interaction.response.status !== "number") {
    throw new Error(
      `HTTP replay interaction #${index + 1} response.status must be a number.`
    );
  }

  return {
    id: typeof interaction.id === "string" ? interaction.id : undefined,
    request: sanitizeRequest({
      ...defaults,
      ...interaction.request,
    } as HttpReplayRequest),
    response: {
      status: interaction.response.status,
      headers: normalizeHeaders(interaction.response.headers) ?? {},
      data: cloneValue(interaction.response.data),
    },
  };
}

function sanitizeRequest(request: ProxyRequest | HttpReplayRequest): HttpReplayRequest {
  const { endpoint, query } = splitEndpoint(request.endpoint);

  return stripUndefined({
    method: request.method,
    baseUrl: request.baseUrl,
    endpoint,
    connectionId: request.connectionId,
    headers: normalizeHeaders(request.headers),
    body: cloneValue(request.body),
    query: normalizeQuery({ ...query, ...(request.query ?? {}) }),
  });
}

function splitEndpoint(endpoint: string): {
  endpoint: string;
  query: ProxyQuery;
} {
  const [path, rawQuery] = endpoint.split("?", 2);
  if (!rawQuery) {
    return { endpoint, query: {} };
  }

  const query: ProxyQuery = {};
  const params = new URLSearchParams(rawQuery);
  params.forEach((value, key) => {
    query[key] = value;
  });

  return { endpoint: path, query };
}

function normalizeHeaders(headers: unknown): ProxyHeaders | undefined {
  if (!isRecord(headers)) {
    return undefined;
  }

  const normalized: ProxyHeaders = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") {
      normalized[key.toLowerCase()] = value;
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeQuery(query: unknown): ProxyQuery | undefined {
  if (!isRecord(query)) {
    return undefined;
  }

  const normalized: ProxyQuery = {};
  for (const [key, value] of Object.entries(query)) {
    const scalar = stringifyScalar(value);
    if (scalar !== undefined) {
      normalized[key] = scalar;
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function requestsMatch(
  expected: HttpReplayRequest,
  actual: HttpReplayRequest
): boolean {
  return stableStringify(expected) === stableStringify(actual);
}

function cloneResponse<TData>(response: ProxyResponse<TData>): ProxyResponse<TData> {
  return {
    status: response.status,
    headers: { ...response.headers },
    data: cloneValue(response.data),
  };
}

function cloneValue<TValue>(value: TValue): TValue {
  if (value === undefined || value === null || typeof value !== "object") {
    return value;
  }

  return JSON.parse(JSON.stringify(value)) as TValue;
}

function stringifyScalar(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  return undefined;
}

function stripUndefined<TValue extends Record<string, unknown>>(
  value: TValue
): TValue {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined)
  ) as TValue;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value) ?? "undefined";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
