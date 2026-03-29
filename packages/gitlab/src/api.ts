import type { ConnectionProvider, GitLabAdapterConfig, ProxyMethod, ProxyResponse } from './types.js';

function normalizeHeaders(headers: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    normalized[key.toLowerCase()] = value;
  }
  return normalized;
}

function parseNextPage(headers: Record<string, string>): number | null {
  const normalized = normalizeHeaders(headers);
  const xNextPage = normalized['x-next-page'];
  if (xNextPage) {
    const page = Number.parseInt(xNextPage, 10);
    return Number.isFinite(page) && page > 0 ? page : null;
  }

  const linkHeader = normalized.link;
  if (!linkHeader) {
    return null;
  }

  const nextMatch = linkHeader
    .split(',')
    .map((part) => part.trim())
    .find((part) => /rel="?next"?/.test(part));

  if (!nextMatch) {
    return null;
  }

  const pageMatch = nextMatch.match(/[?&]page=(\d+)/);
  if (!pageMatch) {
    return null;
  }

  return Number.parseInt(pageMatch[1], 10);
}

export class GitLabApiClient {
  constructor(
    private readonly provider: ConnectionProvider,
    private readonly config: GitLabAdapterConfig,
  ) {}

  projectId(projectPath: string): string {
    return encodeURIComponent(projectPath);
  }

  async request<T>(
    method: ProxyMethod,
    endpoint: string,
    options: {
      body?: unknown;
      headers?: Record<string, string>;
      query?: Record<string, string>;
    } = {},
  ): Promise<T> {
    const response = await this.provider.proxy({
      method,
      baseUrl: this.config.baseUrl,
      endpoint,
      connectionId: this.config.connectionId,
      headers: options.headers,
      body: options.body,
      query: options.query,
    });

    this.ensureOk(method, endpoint, response);
    return response.data as T;
  }

  async get<T>(endpoint: string, query?: Record<string, string>): Promise<T> {
    return this.request<T>('GET', endpoint, { query });
  }

  async paginate<T>(
    endpoint: string,
    query: Record<string, string> = {},
    options: { limit?: number } = {},
  ): Promise<T[]> {
    const items: T[] = [];
    let page = Number.parseInt(query.page ?? '1', 10) || 1;
    const perPage = query.per_page ?? String(this.config.perPage);

    for (;;) {
      const response = await this.provider.proxy({
        method: 'GET',
        baseUrl: this.config.baseUrl,
        endpoint,
        connectionId: this.config.connectionId,
        query: {
          ...query,
          page: String(page),
          per_page: perPage,
        },
      });

      this.ensureOk('GET', endpoint, response);
      const pageItems = Array.isArray(response.data) ? (response.data as T[]) : [];
      items.push(...pageItems);

      if (options.limit && items.length >= options.limit) {
        return items.slice(0, options.limit);
      }

      const nextPage = parseNextPage(response.headers);
      if (!nextPage) {
        return items;
      }

      page = nextPage;
    }
  }

  private ensureOk(method: ProxyMethod, endpoint: string, response: ProxyResponse): void {
    if (response.status >= 200 && response.status < 300) {
      return;
    }

    const detail =
      typeof response.data === 'string'
        ? response.data
        : response.data && typeof response.data === 'object'
          ? JSON.stringify(response.data)
          : 'Unknown provider error';

    throw new Error(`${method} ${endpoint} failed with ${response.status}: ${detail}`);
  }
}
