type ThreadExpansionOptions = {
  cursor?: string;
  limit?: number;
};

type ThreadItem = {
  id: string;
  author: {
    id: string;
    displayName: string;
  };
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
  getResourceAtEvent(
    eventId: string,
    options: { workspace: string; path: string },
  ): Promise<{ data: unknown }>;
  queryResources(
    workspace: string,
    options: {
      provider?: string;
      relation?: string;
      properties?: Record<string, string>;
      cursor?: string;
      limit?: number;
    },
  ): Promise<{ items: Array<{ path: string }>; nextCursor: string | null }>;
  readResource(
    workspace: string,
    path: string,
  ): Promise<{ path: string; data: unknown }>;
};

type ThreadFetchInput = {
  client: ThreadClient;
  workspace: string;
  event: {
    id: string;
    resource: {
      path: string;
    };
  };
  threadOptions?: ThreadExpansionOptions;
};

const DEFAULT_THREAD_LIMIT = 25;
const MAX_THREAD_LIMIT = 100;

export async function fetchThread(input: ThreadFetchInput): Promise<ThreadExpansion> {
  const issuePath = await resolveIssuePath(input);
  if (!issuePath) {
    return emptyThreadExpansion();
  }

  const page = await input.client.queryResources(input.workspace, {
    provider: 'linear',
    relation: issuePath,
    properties: { 'linear.object_type': 'comment' },
    ...(input.threadOptions?.cursor ? { cursor: input.threadOptions.cursor } : {}),
    limit: normalizeThreadLimit(input.threadOptions?.limit),
  });

  return await buildListedThreadExpansion(input, page);
}

async function resolveIssuePath(input: ThreadFetchInput): Promise<string | null> {
  const path = input.event.resource.path;
  if (/^\/linear\/issues\/[^/]+\.json$/u.test(path)) {
    return path;
  }

  const resource = await input.client.getResourceAtEvent(input.event.id, {
    workspace: input.workspace,
    path,
  });
  const comment = readRecord(resource.data);
  const issue = readRecord(comment?.issue);
  const issueId = readString(issue?.id) ?? readString(comment?.issue_id);
  if (!issueId) {
    return null;
  }

  const humanReadable =
    readString(issue?.identifier)
    ?? readString(issue?.title)
    ?? readString(comment?.issue_identifier)
    ?? readString(comment?.issue_title);
  return buildLinearIssuePath(issueId, humanReadable);
}

function buildLinearIssuePath(issueId: string, humanReadable?: string): string {
  const encodedId = encodeURIComponent(issueId);
  const normalizedHumanReadable = humanReadable?.trim();
  if (!normalizedHumanReadable) {
    return `/linear/issues/${encodedId}.json`;
  }

  const slug = /^[A-Z][A-Z0-9]+-\d+$/u.test(normalizedHumanReadable)
    ? normalizedHumanReadable
    : slugifyPathSegment(normalizedHumanReadable);
  return slug
    ? `/linear/issues/${slug}__${encodedId}.json`
    : `/linear/issues/${encodedId}.json`;
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
  return {
    level: 'thread',
    items: [],
    hasMore: false,
  };
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
      ?? readString(record?.createdDate)
      ?? readString(record?.created)
      ?? readString(record?.ts)
      ?? readString(record?.timestamp)
      ?? readString(record?.date)
      ?? readString(readRecord(record?.message)?.createdAt)
      ?? readString(readRecord(record?.message)?.created_at),
    )
    ?? '1970-01-01T00:00:00.000Z';

  return {
    id,
    author,
    createdAt,
    body,
    kind: inferThreadItemKind(record, path, body),
  };
}

function normalizeThreadAuthor(record: Record<string, unknown> | undefined): ThreadItem['author'] {
  const candidate =
    readRecord(record?.author)
    ?? readRecord(record?.user)
    ?? readRecord(record?.actor)
    ?? readRecord(record?.from)
    ?? readRecord(record?.created_by)
    ?? readRecord(record?.createdBy)
    ?? readRecord(record?.CreatedBy)
    ?? readRecord(readRecord(record?.message)?.author)
    ?? readRecord(readRecord(record?.message)?.from)
    ?? readRecord(readRecord(record?.message)?.user)
    ?? record;

  const id =
    readString(candidate?.id)
    ?? readString(candidate?.gid)
    ?? readString(candidate?.user_id)
    ?? readString(candidate?.agentId)
    ?? readString(candidate?.agent_id)
    ?? readString(candidate?.accountId)
    ?? readString(candidate?.Id)
    ?? 'unknown';
  const displayName = redactThreadText(
    readString(candidate?.displayName)
    ?? readString(candidate?.display_name)
    ?? readString(candidate?.DisplayName)
    ?? readString(candidate?.name)
    ?? readString(candidate?.agentName)
    ?? readString(candidate?.agent_name)
    ?? readString(candidate?.Name)
    ?? id,
  ) || id;

  return { id, displayName };
}

function readBodyText(record: Record<string, unknown> | undefined): string | undefined {
  if (!record) {
    return undefined;
  }

  const direct =
    readString(record.body)
    ?? readString(record.text)
    ?? readString(record.plain_text)
    ?? readString(record.plainText)
    ?? readString(record.html_body)
    ?? readString(record.htmlBody)
    ?? readString(record.rich_text)
    ?? readString(record.richText)
    ?? readString(record.comment_text)
    ?? readString(record.description)
    ?? readString(record.note);
  if (direct) {
    return direct;
  }

  const textArray = readArray(record.rich_text) ?? readArray(record.richText);
  if (textArray && textArray.length > 0) {
    return textArray
      .map((entry) => {
        const item = readRecord(entry);
        return readString(item?.plain_text) ?? readString(item?.text) ?? readString(item?.content) ?? '';
      })
      .join(' ')
      .trim();
  }

  return undefined;
}

function inferThreadItemKind(
  record: Record<string, unknown> | undefined,
  path: string | undefined,
  body: string,
): ThreadItem['kind'] {
  const explicit =
    readString(record?.kind)
    ?? readString(record?.type)
    ?? readString(record?.resource_subtype)
    ?? readString(readRecord(record?.message)?.type);
  if (explicit === 'reply' || explicit === 'thread_reply') {
    return 'reply';
  }
  if (explicit === 'system' || explicit === 'story') {
    return body ? 'comment' : 'system';
  }
  if (explicit === 'comment' || explicit === 'note') {
    return 'comment';
  }
  if (path?.includes('/replies/')) {
    return 'reply';
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

function slugifyPathSegment(value: string): string {
  const ascii = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x00-\x7F]+/g, '');
  return ascii
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
