import type { GitHubAdapter } from '../index.js';
import { EVENT_MAP, extractEventKey, extractRepoInfo, type IngestResult } from './event-map.js';

export type WebhookHeaders = Headers | Record<string, string | string[] | undefined>;
export type WebhookPayload = Record<string, unknown>;

export class WebhookRouter {
  constructor(private readonly adapter: GitHubAdapter) {}

  async route(headers: WebhookHeaders, payload: WebhookPayload): Promise<IngestResult> {
    const eventKey = extractEventKey(headers, payload);
    const handler = EVENT_MAP[eventKey];
    const repoInfo = extractRepoInfo(payload);

    if (!handler) {
      return {
        filesWritten: 0,
        filesUpdated: 0,
        filesDeleted: 0,
        paths: [],
        errors: [{ path: toRepoPath(repoInfo), error: 'unsupported event' }],
      };
    }

    return handler(this.adapter, payload);
  }

  isSupported(eventKey: string): boolean {
    return eventKey in EVENT_MAP;
  }

  getSupportedEvents(): string[] {
    return Object.keys(EVENT_MAP);
  }
}

export function createRouter(adapter: GitHubAdapter): WebhookRouter {
  return new WebhookRouter(adapter);
}

function toRepoPath(repoInfo: ReturnType<typeof extractRepoInfo>): string {
  if (!repoInfo.owner || !repoInfo.repo) {
    return '/github';
  }

  return `/github/repos/${repoInfo.owner}/${repoInfo.repo}`;
}
