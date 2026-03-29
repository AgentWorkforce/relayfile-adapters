import {
  DEFAULT_NOTION_API_BASE_URL,
  DEFAULT_NOTION_API_VERSION,
  DEFAULT_NOTION_MARKDOWN_API_VERSION,
  DEFAULT_NOTION_PAGE_SIZE,
} from './types.js';
import type {
  NotionAdapterConfig,
  NotionConnectionProvider,
  NotionListResponse,
  NotionPaginatedRequestOptions,
  NotionRequestOptions,
  ProxyResponse,
} from './types.js';

export class NotionApiError extends Error {
  readonly status: number;
  readonly payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = 'NotionApiError';
    this.status = status;
    this.payload = payload;
  }
}

export class NotionApiClient {
  readonly config: Required<
    Pick<NotionAdapterConfig, 'apiBaseUrl' | 'apiVersion' | 'defaultPageSize' | 'enableMarkdown' | 'fetchBlockJson' | 'fetchComments'>
  > &
    Pick<NotionAdapterConfig, 'connectionId' | 'databaseIds' | 'markdownApiVersion' | 'pageIds' | 'token'>;

  constructor(
    private readonly provider?: NotionConnectionProvider,
    config: NotionAdapterConfig = {},
  ) {
    this.config = {
      apiBaseUrl: config.apiBaseUrl ?? DEFAULT_NOTION_API_BASE_URL,
      apiVersion: config.apiVersion ?? DEFAULT_NOTION_API_VERSION,
      markdownApiVersion: config.markdownApiVersion ?? DEFAULT_NOTION_MARKDOWN_API_VERSION,
      token: config.token,
      connectionId: config.connectionId,
      databaseIds: config.databaseIds,
      pageIds: config.pageIds,
      defaultPageSize: config.defaultPageSize ?? DEFAULT_NOTION_PAGE_SIZE,
      fetchComments: config.fetchComments ?? true,
      fetchBlockJson: config.fetchBlockJson ?? true,
      enableMarkdown: config.enableMarkdown ?? true,
    };
  }

  async request<T>(
    method: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT',
    endpoint: string,
    options: NotionRequestOptions = {},
  ): Promise<T> {
    const queryString = buildQueryString(options.query);
    const resolvedEndpoint = queryString ? `${endpoint}?${queryString}` : endpoint;
    const notionVersion = options.apiVersion ?? this.config.apiVersion;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.requireTokenIfNoProxy()}`,
      'Notion-Version': notionVersion,
    };
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    if (this.provider?.proxy && this.config.connectionId) {
      const proxyHeaders = { ...headers };
      delete proxyHeaders.Authorization;
      const response = await this.provider.proxy({
        method,
        baseUrl: this.config.apiBaseUrl,
        endpoint,
        connectionId: this.config.connectionId,
        headers: proxyHeaders,
        body: options.body,
        query: normalizeQuery(options.query),
      });
      return this.unwrapProxyResponse<T>(response, method, resolvedEndpoint);
    }

    const response = await fetch(`${this.config.apiBaseUrl}${resolvedEndpoint}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
    const payload = await readResponseBody(response);
    if (!response.ok) {
      throw new NotionApiError(buildErrorMessage(payload, method, resolvedEndpoint), response.status, payload);
    }
    return payload as T;
  }

  async paginate<T>(
    method: 'GET' | 'POST',
    endpoint: string,
    options: NotionPaginatedRequestOptions = {},
  ): Promise<T[]> {
    const results: T[] = [];
    let cursor = options.startCursor;

    for (;;) {
      const pageSize = options.pageSize ?? this.config.defaultPageSize;
      const requestOptions =
        method === 'GET'
          ? {
              ...options,
              query: {
                ...options.query,
                page_size: pageSize,
                start_cursor: cursor,
              },
            }
          : {
              ...options,
              body: {
                ...(isRecord(options.body) ? options.body : {}),
                page_size: pageSize,
                start_cursor: cursor,
              },
            };
      const page = await this.request<NotionListResponse<T>>(method, endpoint, requestOptions);
      results.push(...page.results);
      if (!page.has_more || !page.next_cursor) {
        break;
      }
      cursor = page.next_cursor;
    }

    return results;
  }

  healthCheck(): Promise<boolean> {
    if (this.provider?.healthCheck && this.config.connectionId) {
      return this.provider.healthCheck(this.config.connectionId);
    }
    return Promise.resolve(Boolean(this.config.token));
  }

  private unwrapProxyResponse<T>(response: ProxyResponse, method: string, endpoint: string): T {
    if (response.status >= 400) {
      throw new NotionApiError(buildErrorMessage(response.data, method, endpoint), response.status, response.data);
    }
    return response.data as T;
  }

  private requireTokenIfNoProxy(): string {
    if (this.provider?.proxy && this.config.connectionId) {
      return this.config.token ?? 'proxy-authenticated';
    }
    if (!this.config.token) {
      throw new Error('NotionApiClient requires either config.token or provider.proxy + connectionId');
    }
    return this.config.token;
  }
}

function buildQueryString(query?: Record<string, string | number | boolean | undefined>): string {
  if (!query) {
    return '';
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) {
      params.set(key, String(value));
    }
  }
  return params.toString();
}

function normalizeQuery(query?: Record<string, string | number | boolean | undefined>): Record<string, string> | undefined {
  if (!query) {
    return undefined;
  }
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) {
      normalized[key] = String(value);
    }
  }
  return normalized;
}

async function readResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return response.json();
  }
  return response.text();
}

function buildErrorMessage(payload: unknown, method: string, endpoint: string): string {
  if (isRecord(payload) && typeof payload.message === 'string') {
    return payload.message;
  }
  return `Notion API ${method} ${endpoint} failed`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
