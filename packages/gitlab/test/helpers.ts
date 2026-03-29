import type { ConnectionProvider, ProxyRequest, ProxyResponse } from '../src/types.js';

export class MockProvider implements ConnectionProvider {
  readonly name = 'mock-gitlab';
  readonly requests: ProxyRequest[] = [];
  private readonly handlers = new Map<string, ProxyResponse | ((request: ProxyRequest) => ProxyResponse | Promise<ProxyResponse>)>();

  register(
    method: string,
    endpoint: string,
    response: ProxyResponse | ((request: ProxyRequest) => ProxyResponse | Promise<ProxyResponse>),
  ): void {
    this.handlers.set(`${method} ${endpoint}`, response);
  }

  async proxy(request: ProxyRequest): Promise<ProxyResponse> {
    this.requests.push(request);
    const handler = this.handlers.get(`${request.method} ${request.endpoint}`);
    if (!handler) {
      throw new Error(`No mock handler for ${request.method} ${request.endpoint}`);
    }

    return typeof handler === 'function' ? handler(request) : handler;
  }
}

export function ok(data: unknown, headers: Record<string, string> = {}): ProxyResponse {
  return { status: 200, headers, data };
}
