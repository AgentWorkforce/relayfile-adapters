import { ReadOnlyFieldError, classifyWrite } from '@relayfile/adapter-core';
import { DEFAULT_NOTION_MARKDOWN_API_VERSION } from './types.js';
import { deserializePropertyMap } from './pages/properties.js';
import { resources } from './resources.js';
import type { JsonValue, NotionWritebackRequest } from './types.js';

export { ReadOnlyFieldError } from '@relayfile/adapter-core';

/**
 * Extract a Notion id from a path segment.
 *
 * Path-mapper emits segments in two shapes:
 *   - `<slug>--<id-suffix>` when a title is available (the common case).
 *     `id-suffix` is the dehyphenated 32-char hex form of the UUID — see
 *     `path-mapper.ts:idSuffix()`. We reformat back to canonical 8-4-4-4-12.
 *   - bare `<id>` when no title is available. We pass it through (decoded)
 *     and let the API validate.
 *
 * Legacy 8-char suffixes are rejected explicitly so the caller gets a clear
 * "re-sync required" signal instead of an opaque downstream 400.
 */
function extractNotionId(segment: string): string {
  const decoded = decodeURIComponent(segment);

  // slug--<32-hex>: reverse the path-mapper encoding to canonical UUID.
  const slugged32 = /--([0-9a-f]{32})$/i.exec(decoded);
  if (slugged32) return formatUuid(slugged32[1]);

  // slug--<8-hex>: legacy form, can't be reversed losslessly.
  if (/--[0-9a-f]{8}$/i.test(decoded)) {
    throw new Error(
      `Notion path "${segment}" uses a legacy 8-char id suffix that cannot be ` +
        `losslessly resolved. Run \`relayfile pull\` to re-sync paths.`,
    );
  }

  // Bare 32-char hex: dehyphenated UUID. Reformat for the API.
  const bareHex = /^([0-9a-f]{32})$/i.exec(decoded);
  if (bareHex) return formatUuid(bareHex[1]);

  // Anything else (canonical UUIDs, synthetic test ids, percent-encoded ids)
  // passes through as-is. The Notion API will validate.
  return decoded;
}

/**
 * Reformat a 32-char hex string back to canonical UUID `8-4-4-4-12` form.
 * Inverse of the dehyphenation done by `path-mapper.idSuffix()`.
 */
function formatUuid(hex32: string): string {
  return `${hex32.slice(0, 8)}-${hex32.slice(8, 12)}-${hex32.slice(12, 16)}-${hex32.slice(16, 20)}-${hex32.slice(20, 32)}`;
}

/**
 * Resolve a relayfile writeback into a Notion REST request.
 *
 * Routes:
 *   - PATCH /notion/databases/<db>/pages/<slug>--<id>.json       → page properties
 *   - PATCH /notion/pages/<slug>--<id>.json                       → page properties (top-level)
 *   - PATCH /notion/databases/<db>/pages/<slug>--<id>/content.md  → page markdown
 *   - PATCH /notion/pages/<slug>--<id>/content.md                  → page markdown (top-level)
 *   - POST  /notion/databases/<db>/pages/<slug>--<id>/comments.json → comment create
 *   - POST  /notion/pages/<slug>--<id>/comments.json               → comment create (top-level)
 *   - POST  /notion/databases/<db>/pages/<draft>.json               → create page in database
 *   - POST  /notion/databases/<db>/pages                            → create page in database
 *
 * Throws when no rule matches the path.
 */
export function resolveWritebackRequest(path: string, content: string): NotionWritebackRequest {
  const route = classifyWrite(path, resources);
  const databasePageMatch = path.match(/^\/notion\/databases\/([^/]+)\/pages\/([^/]+)\.json$/);
  if (route?.resource.name === 'pages' && databasePageMatch) {
    if (route.kind === 'create') {
      return buildCreatePageWriteback(extractNotionId(databasePageMatch[1]), content);
    }
    if (route.kind === 'patch') {
      return buildPagePropertiesWriteback(extractNotionId(databasePageMatch[2]), content);
    }
  }

  const standalonePageMatch = path.match(/^\/notion\/pages\/([^/]+)\.json$/);
  if (standalonePageMatch) {
    return buildPagePropertiesWriteback(extractNotionId(standalonePageMatch[1]), content);
  }

  const databaseContentMatch = path.match(/^\/notion\/databases\/([^/]+)\/pages\/([^/]+)\/content\.md$/);
  if (databaseContentMatch) {
    return buildMarkdownWriteback(extractNotionId(databaseContentMatch[2]), content);
  }

  const standaloneContentMatch = path.match(/^\/notion\/pages\/([^/]+)\/content\.md$/);
  if (standaloneContentMatch) {
    return buildMarkdownWriteback(extractNotionId(standaloneContentMatch[1]), content);
  }

  const databaseCommentsMatch = path.match(/^\/notion\/databases\/([^/]+)\/pages\/([^/]+)\/comments\.json$/);
  if (databaseCommentsMatch) {
    return buildCommentWriteback(extractNotionId(databaseCommentsMatch[2]), content);
  }

  const standaloneCommentsMatch = path.match(/^\/notion\/pages\/([^/]+)\/comments\.json$/);
  if (standaloneCommentsMatch) {
    return buildCommentWriteback(extractNotionId(standaloneCommentsMatch[1]), content);
  }

  throw new Error(`No Notion writeback rule matched ${path}`);
}

export function resolveDeleteRequest(path: string): NotionWritebackRequest {
  const route = classifyWrite(path, resources, { fsEvent: 'delete' });
  const databasePageMatch = path.match(/^\/notion\/databases\/([^/]+)\/pages\/([^/]+)\.json$/);
  if (route?.resource.name === 'pages' && route.kind === 'delete' && databasePageMatch?.[2]) {
    return buildArchivePageWriteback(extractNotionId(databasePageMatch[2]));
  }

  const standalonePageMatch = path.match(/^\/notion\/pages\/([^/]+)\.json$/);
  if (standalonePageMatch?.[1]) {
    return buildArchivePageWriteback(extractNotionId(standalonePageMatch[1]));
  }

  throw new Error(`No Notion delete writeback rule matched ${path}`);
}

/**
 * Build a `PATCH /v1/pages/{id}` request to update a page's properties,
 * archived flag, icon, or cover. The payload must include a `properties`
 * object; everything else is optional.
 */
function buildPagePropertiesWriteback(pageId: string, content: string): NotionWritebackRequest {
  const payload = parseJson(content);
  rejectReadOnlyFields(payload);
  const properties = extractSerializedProperties(payload);
  return {
    action: 'update_page_properties',
    method: 'PATCH',
    endpoint: `/v1/pages/${encodeURIComponent(pageId)}`,
    body: {
      properties,
      archived: readBoolean(payload, 'archived'),
      icon: readObject(payload, 'icon'),
      cover: readObject(payload, 'cover'),
    },
  };
}

/**
 * Build a `PATCH /v1/pages/{id}/markdown` request that replaces the page
 * body. Always uses `replace_content` semantics — partial markdown patches
 * are not supported by this entrypoint.
 */
function buildMarkdownWriteback(pageId: string, markdown: string): NotionWritebackRequest {
  return {
    action: 'update_page_markdown',
    method: 'PATCH',
    endpoint: `/v1/pages/${encodeURIComponent(pageId)}/markdown`,
    apiVersion: DEFAULT_NOTION_MARKDOWN_API_VERSION,
    body: {
      type: 'replace_content',
      replace_content: {
        new_str: markdown,
        allow_deleting_content: true,
      },
    },
  };
}

/**
 * Build a `POST /v1/comments` request creating a comment on the page.
 *
 * Accepts three payload shapes:
 *   - a plain string: becomes a single rich_text run with that content.
 *   - a JSON object with optional `discussionId`, `richText`, and/or `text`.
 *   - a JSON array: the last entry is treated as the comment to post (so an
 *     agent can append to a comments.json file and have writeback fire on
 *     the new entry).
 */
function buildCommentWriteback(pageId: string, content: string): NotionWritebackRequest {
  const parsed = safeParseJson(content);
  if (typeof parsed === 'string') {
    return {
      action: 'create_comment',
      method: 'POST',
      endpoint: '/v1/comments',
      body: {
        parent: { page_id: pageId },
        rich_text: [
          {
            type: 'text',
            text: { content: parsed, link: null },
          },
        ],
      },
    };
  }

  const comment = Array.isArray(parsed) ? parsed.at(-1) : parsed;
  if (!isRecord(comment)) {
    throw new Error('comments.json writeback expects a JSON object, JSON array, or plain string');
  }

  return {
    action: 'create_comment',
    method: 'POST',
    endpoint: '/v1/comments',
    body: {
      parent: { page_id: pageId },
      discussion_id: typeof comment.discussionId === 'string' ? comment.discussionId : undefined,
      rich_text:
        Array.isArray(comment.richText) && comment.richText.length > 0
          ? comment.richText
          : [
              {
                type: 'text',
                text: { content: typeof comment.text === 'string' ? comment.text : JSON.stringify(comment), link: null },
              },
            ],
    },
  };
}

/**
 * Build a `POST /v1/pages` request creating a new page in the given
 * database. The payload must include `properties`; optional `children`
 * (block array) and `markdown` (string) populate the new page's body.
 * If `markdown` is present we use the markdown API version.
 */
function buildCreatePageWriteback(databaseId: string, content: string): NotionWritebackRequest {
  const payload = parseJson(content);
  rejectReadOnlyFields(payload);
  const properties = extractSerializedProperties(payload);
  const children = Array.isArray(payload.children) ? payload.children : undefined;
  const markdown = typeof payload.markdown === 'string' ? payload.markdown : undefined;

  return {
    action: 'create_page',
    method: 'POST',
    endpoint: '/v1/pages',
    apiVersion: markdown ? DEFAULT_NOTION_MARKDOWN_API_VERSION : undefined,
    body: {
      parent: { database_id: databaseId },
      properties,
      children,
      markdown,
    },
  };
}

function buildArchivePageWriteback(pageId: string): NotionWritebackRequest {
  return {
    action: 'delete_page',
    method: 'PATCH',
    endpoint: `/v1/pages/${encodeURIComponent(pageId)}`,
    body: {
      archived: true,
    },
  };
}

/**
 * Convert a writeback payload's `properties` object from the relayfile
 * file shape (with `id`, `type`, `value`) back into Notion's API shape via
 * `deserializePropertyMap`. Throws if the payload is missing the
 * `properties` object entirely.
 */
function extractSerializedProperties(payload: Record<string, unknown>): Record<string, unknown> {
  const properties = readObject(payload, 'properties');
  if (!properties) {
    throw new Error('Writeback payload must include a properties object');
  }
  const propertyEntries = Object.fromEntries(
    Object.entries(properties).map(([key, value]) => {
      if (!isRecord(value)) {
        throw new Error(`Property ${key} must be an object`);
      }
      return [key, value];
    }),
  );
  return deserializePropertyMap(propertyEntries);
}

/** Parse `content` as a JSON object, throwing if it isn't an object. */
function parseJson(content: string): Record<string, unknown> {
  const parsed = safeParseJson(content);
  if (!isRecord(parsed)) {
    throw new Error('Expected JSON object payload');
  }
  return parsed;
}

/**
 * Parse `content` as JSON, falling back to the trimmed raw string when
 * parsing fails. Lets a caller accept both `'"hello"'` and `hello` for
 * plain-text comment bodies.
 */
function safeParseJson(content: string): JsonValue | string {
  try {
    return JSON.parse(content) as JsonValue;
  } catch {
    return content.trim();
  }
}

/** Return the value at `key` if it is a non-null, non-array object. */
function readObject(record: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = record[key];
  return isRecord(value) ? value : undefined;
}

/** Return the value at `key` if it is a boolean, otherwise `undefined`. */
function readBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  return typeof record[key] === 'boolean' ? (record[key] as boolean) : undefined;
}

/** Type guard: is the value a non-array, non-null object? */
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

const READ_ONLY_FIELDS = new Set([
  'id',
  'createdAt',
  'updatedAt',
  'created_time',
  'last_edited_time',
  'url',
  'identifier',
  'provider',
  'objectType',
  'objectId',
  'workspaceId',
  'connectionId',
  '_webhook',
  '_connection',
]);

function rejectReadOnlyFields(payload: Record<string, unknown>): void {
  for (const key of Object.keys(payload)) {
    if (READ_ONLY_FIELDS.has(key)) {
      throw new ReadOnlyFieldError(key);
    }
  }
}

