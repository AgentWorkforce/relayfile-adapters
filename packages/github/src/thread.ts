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
  const prRoot = extractPullRequestRoot(input.event.resource.path);
  if (!prRoot) {
    return emptyThreadExpansion();
  }

  const page = await paginateUnionResources(
    input,
    [`${prRoot}/reviews`, `${prRoot}/comments`],
    input.threadOptions,
  );

  return await buildListedThreadExpansion(input, page);
}

function extractPullRequestRoot(path: string): string | null {
  const match = path.match(/^(.+\/pulls\/[^/]+)(?:\/meta\.json|\/reviews\/[^/]+\.json|\/comments\/[^/]+\.json)$/u);
  return match?.[1] ?? null;
}

async function paginateUnionResources(
  input: ThreadFetchInput,
  paths: string[],
  options?: ThreadExpansionOptions,
): Promise<{ items: Array<{ path: string }>; nextCursor: string | null }> {
  const decoded = decodeOpaqueCursor(options?.cursor);
  const limit = normalizeThreadLimit(options?.limit);
  const items: Array<{ path: string }> = [];
  const startSource = readNumericCursorValue(decoded?.source) ?? 0;
  const startCursor = readString(decoded?.cursor);

  for (let index = startSource; index < paths.length && items.length < limit; index += 1) {
    const page = await input.client.queryResources(input.workspace, {
      path: paths[index],
      ...(index === startSource && startCursor ? { cursor: startCursor } : {}),
      limit: limit - items.length,
    });
    items.push(...page.items);

    if (page.nextCursor) {
      return {
        items,
        nextCursor: encodeOpaqueCursor({ source: index, cursor: page.nextCursor }),
      };
    }
  }

  return { items, nextCursor: null };
}

async function buildListedThreadExpansion(
  input: ThreadFetchInput,
  page: { items: Array<{ path: string }>; nextCursor: string | null },
): Promise<ThreadExpansion> {
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
  const id =
    readString(record?.id)
    ?? readString(record?.gid)
    ?? readString(record?.uuid)
    ?? readString(readRecord(record?.message)?.id)
    ?? path
    ?? 'thread-item';
  const author = normalizeThreadAuthor(record);
  const body = redactThreadText(
    readBodyText(record)
    ?? readString(readRecord(record?.message)?.text)
    ?? readString(readRecord(record?.comment)?.body)
    ?? '',
  );
  const createdAt =
    normalizeTimestamp(
      readString(record?.createdAt)
      ?? readString(record?.created_at)
      ?? readString(record?.submitted_at)
      ?? readString(record?.created)
      ?? readString(record?.ts),
    )
    ?? '1970-01-01T00:00:00.000Z';

  return { id, author, createdAt, body, kind: inferThreadItemKind(record, path, body) };
}

function normalizeThreadAuthor(record: Record<string, unknown> | undefined): ThreadItem['author'] {
  const candidate = readRecord(record?.author) ?? readRecord(record?.user) ?? readRecord(record?.actor) ?? record;
  const id =
    readString(candidate?.id)
    ?? readString(candidate?.gid)
    ?? readString(candidate?.user_id)
    ?? readString(candidate?.accountId)
    ?? 'unknown';
  const displayName = redactThreadText(
    readString(candidate?.displayName)
    ?? readString(candidate?.display_name)
    ?? readString(candidate?.name)
    ?? id,
  ) || id;
  return { id, displayName };
}

function readBodyText(record: Record<string, unknown> | undefined): string | undefined {
  if (!record) {
    return undefined;
  }
  return readString(record.body) ?? readString(record.text) ?? readString(record.state);
}

function inferThreadItemKind(
  record: Record<string, unknown> | undefined,
  path: string | undefined,
  body: string,
): ThreadItem['kind'] {
  const explicit = readString(record?.kind) ?? readString(record?.type);
  if (explicit === 'reply' || explicit === 'thread_reply') {
    return 'reply';
  }
  if (path?.includes('/comments/')) {
    return 'comment';
  }
  return body ? 'comment' : 'system';
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

function encodeOpaqueCursor(value: Record<string, unknown>): string {
  return base64UrlEncode(JSON.stringify(value));
}

function decodeOpaqueCursor(cursor: string | undefined): Record<string, unknown> | null {
  if (!cursor?.trim()) {
    return null;
  }

  try {
    const decoded = JSON.parse(base64UrlDecode(cursor.trim())) as unknown;
    return readRecord(decoded) ?? null;
  } catch {
    return null;
  }
}

function readNumericCursorValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.trunc(value);
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : undefined;
  }
  return undefined;
}

function base64UrlEncode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
