type ThreadExpansionOptions = {
  cursor?: string;
  limit?: number;
};

type ThreadItem = {
  id: string;
  author: { id: string; displayName: string };
  createdAt: string;
  body: string;
  kind: 'comment' | 'reply' | 'system';
};

type ThreadExpansion = {
  level: 'thread';
  items: ThreadItem[];
  hasMore: boolean;
  cursor?: string;
};

type ThreadClient = {
  queryResources(
    workspace: string,
    options: { path?: string; cursor?: string; limit?: number },
  ): Promise<{ items: Array<{ path: string }>; nextCursor: string | null }>;
  readResource(workspace: string, path: string): Promise<{ path: string; data: unknown }>;
};

type ThreadFetchInput = {
  client: ThreadClient;
  workspace: string;
  event: { resource: { path: string } };
  threadOptions?: ThreadExpansionOptions;
};

const DEFAULT_THREAD_LIMIT = 25;
const MAX_THREAD_LIMIT = 100;

export async function fetchThread(input: ThreadFetchInput): Promise<ThreadExpansion> {
  const repliesPath = extractRepliesPath(input.event.resource.path);
  if (!repliesPath) {
    return emptyThreadExpansion();
  }

  const page = await input.client.queryResources(input.workspace, {
    path: repliesPath,
    ...(input.threadOptions?.cursor ? { cursor: input.threadOptions.cursor } : {}),
    limit: normalizeThreadLimit(input.threadOptions?.limit),
  });

  const items = await Promise.all(
    page.items.map(async (entry) => {
      const resource = await input.client.readResource(input.workspace, entry.path);
      return normalizeThreadItem(resource.data, entry.path);
    }),
  );

  return {
    level: 'thread',
    items,
    hasMore: page.nextCursor !== null,
    ...(page.nextCursor ? { cursor: page.nextCursor } : {}),
  };
}

function extractRepliesPath(path: string): string | null {
  if (/^\/slack\/channels\/[^/]+\/threads\/[^/]+\/meta\.json$/u.test(path)) {
    return path.replace(/\/meta\.json$/u, '/replies');
  }

  const match = path.match(/^(\/slack\/channels\/[^/]+\/threads\/[^/]+)\/replies\/[^/]+\.json$/u);
  return match?.[1] ? `${match[1]}/replies` : null;
}

function emptyThreadExpansion(): ThreadExpansion {
  return { level: 'thread', items: [], hasMore: false };
}

function normalizeThreadLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) {
    return DEFAULT_THREAD_LIMIT;
  }
  const normalized = Math.trunc(limit);
  if (normalized < 1) {
    return DEFAULT_THREAD_LIMIT;
  }
  return Math.min(normalized, MAX_THREAD_LIMIT);
}

function normalizeThreadItem(value: unknown, path?: string): ThreadItem {
  const record = readRecord(value);
  const id = readString(record?.id) ?? path ?? 'thread-item';
  const authorRecord = readRecord(record?.user) ?? readRecord(record?.author) ?? record;
  const authorId = readString(authorRecord?.id) ?? 'unknown';
  const displayName = redactThreadText(readString(authorRecord?.name) ?? authorId) || authorId;
  const createdAt = normalizeTimestamp(readString(record?.ts)) ?? '1970-01-01T00:00:00.000Z';
  const body = redactThreadText(readString(record?.text) ?? '');
  return {
    id,
    author: { id: authorId, displayName },
    createdAt,
    body,
    kind: path?.includes('/replies/') ? 'reply' : 'comment',
  };
}

function normalizeTimestamp(value: string | undefined): string | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function redactThreadText(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[redacted-number]')
    .replace(/\b\d{9,}\b/g, '[redacted-number]')
    .replace(/\s+/g, ' ')
    .trim();
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
