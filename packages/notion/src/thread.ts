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
  readResource(workspace: string, path: string): Promise<{ data: unknown }>;
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
  const commentsPath = toCommentsPath(input.event.resource.path);
  if (!commentsPath) {
    return emptyThreadExpansion();
  }

  const resource = await input.client.readResource(input.workspace, commentsPath);
  const items = readArray(resource.data).map((item) => normalizeThreadItem(item));
  return buildArrayThreadExpansion(items, input.threadOptions);
}

function toCommentsPath(path: string): string | null {
  if (/\/comments\.json$/u.test(path)) return path;
  if (/\/content\.md$/u.test(path)) return path.replace(/\/content\.md$/u, '/comments.json');
  if (/\.json$/u.test(path) && /\/notion\/(?:databases\/[^/]+\/pages|pages)\//u.test(path)) {
    return path.replace(/\.json$/u, '/comments.json');
  }
  return null;
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
  const authorRecord = readRecord(record?.created_by) ?? readRecord(record?.createdBy) ?? record;
  const authorId = readString(authorRecord?.id) ?? 'unknown';
  const displayName = redactThreadText(readString(authorRecord?.name) ?? authorId) || authorId;
  return {
    id: readString(record?.id) ?? 'thread-item',
    author: { id: authorId, displayName },
    createdAt: normalizeTimestamp(readString(record?.created_at)) ?? '1970-01-01T00:00:00.000Z',
    body: redactThreadText(readBodyText(record) ?? ''),
    kind: 'comment',
  };
}

function readBodyText(record: Record<string, unknown> | undefined): string | undefined {
  if (!record) return undefined;
  const direct = readString(record.rich_text) ?? readString(record.text);
  if (direct) return direct;
  const richText = readArray(record.rich_text);
  if (!richText) return undefined;
  return richText
    .map((entry) => {
      const item = readRecord(entry);
      return readString(item?.plain_text) ?? readString(item?.text) ?? readString(item?.content) ?? '';
    })
    .join(' ')
    .trim();
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
