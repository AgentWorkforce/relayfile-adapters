type ThreadExpansionOptions = { cursor?: string; limit?: number };
type ThreadItem = {
  id: string;
  author: { id: string; displayName: string };
  createdAt: string;
  body: string;
  kind: 'comment' | 'reply' | 'system';
};
type ThreadExpansion = { level: 'thread'; items: ThreadItem[]; hasMore: boolean; cursor?: string };
type ThreadClient = {
  getResourceAtEvent(
    eventId: string,
    options: { workspace: string; path: string },
  ): Promise<{ data: unknown }>;
  readResource(workspace: string, path: string): Promise<{ data: unknown }>;
};
type ThreadFetchInput = {
  client: ThreadClient;
  workspace: string;
  event: { id: string; resource: { path: string } };
  threadOptions?: ThreadExpansionOptions;
};

const DEFAULT_THREAD_LIMIT = 25;
const MAX_THREAD_LIMIT = 100;

export async function fetchThread(input: ThreadFetchInput): Promise<ThreadExpansion> {
  const issueResource = await readIssueResource(input);
  if (!issueResource) {
    return emptyThreadExpansion();
  }

  const issue = readRecord(issueResource.data);
  const fields = readRecord(issue?.fields);
  const commentBlock = readRecord(fields?.comment);
  const comments = readArray(commentBlock?.comments).map((item) => normalizeThreadItem(item));
  return buildArrayThreadExpansion(comments, input.threadOptions);
}

async function readIssueResource(input: ThreadFetchInput): Promise<{ data: unknown } | null> {
  const path = input.event.resource.path;
  if (/^\/jira\/issues\/[^/]+\.json$/u.test(path)) {
    return await input.client.getResourceAtEvent(input.event.id, {
      workspace: input.workspace,
      path,
    });
  }

  const match = path.match(/^\/jira\/issues\/([^/]+)\/comments\/[^/]+\.json$/u);
  return match?.[1] ? await input.client.readResource(input.workspace, `/jira/issues/${match[1]}.json`) : null;
}

function buildArrayThreadExpansion(items: ThreadItem[], options?: ThreadExpansionOptions): ThreadExpansion {
  const limit = normalizeThreadLimit(options?.limit);
  const offset = readNumericCursorValue(decodeOpaqueCursor(options?.cursor)?.offset) ?? 0;
  const nextOffset = offset + limit;
  return {
    level: 'thread',
    items: items.slice(offset, nextOffset),
    hasMore: nextOffset < items.length,
    ...(nextOffset < items.length ? { cursor: encodeOpaqueCursor({ offset: nextOffset }) } : {}),
  };
}

function emptyThreadExpansion(): ThreadExpansion {
  return { level: 'thread', items: [], hasMore: false };
}

function normalizeThreadLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return DEFAULT_THREAD_LIMIT;
  const normalized = Math.trunc(limit);
  if (normalized < 1) return DEFAULT_THREAD_LIMIT;
  return Math.min(normalized, MAX_THREAD_LIMIT);
}

function normalizeThreadItem(value: unknown): ThreadItem {
  const record = readRecord(value);
  const authorRecord = readRecord(record?.author) ?? record;
  const authorId = readString(authorRecord?.accountId) ?? readString(authorRecord?.id) ?? 'unknown';
  const displayName = redactThreadText(readString(authorRecord?.displayName) ?? authorId) || authorId;
  return {
    id: readString(record?.id) ?? 'thread-item',
    author: { id: authorId, displayName },
    createdAt: normalizeTimestamp(readString(record?.created)) ?? '1970-01-01T00:00:00.000Z',
    body: redactThreadText(readString(record?.body) ?? ''),
    kind: 'comment',
  };
}

function encodeOpaqueCursor(value: Record<string, unknown>): string {
  return base64UrlEncode(JSON.stringify(value));
}

function decodeOpaqueCursor(cursor: string | undefined): Record<string, unknown> | null {
  if (!cursor?.trim()) return null;
  try {
    const decoded = JSON.parse(base64UrlDecode(cursor.trim())) as unknown;
    return readRecord(decoded) ?? null;
  } catch {
    return null;
  }
}

function readNumericCursorValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.trunc(value);
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : undefined;
  }
  return undefined;
}

function normalizeTimestamp(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
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

function base64UrlEncode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
