import { DEFAULT_NOTION_MARKDOWN_API_VERSION } from './types.js';
import { deserializePropertyMap } from './pages/properties.js';
import type { JsonValue, NotionWritebackRequest } from './types.js';

export function resolveWritebackRequest(path: string, content: string): NotionWritebackRequest {
  const databasePageMatch = path.match(/^\/notion\/databases\/([^/]+)\/pages\/([^/]+)\.json$/);
  if (databasePageMatch) {
    return buildPagePropertiesWriteback(databasePageMatch[2], content);
  }

  const standalonePageMatch = path.match(/^\/notion\/pages\/([^/]+)\.json$/);
  if (standalonePageMatch) {
    return buildPagePropertiesWriteback(standalonePageMatch[1], content);
  }

  const databaseContentMatch = path.match(/^\/notion\/databases\/([^/]+)\/pages\/([^/]+)\/content\.md$/);
  if (databaseContentMatch) {
    return buildMarkdownWriteback(databaseContentMatch[2], content);
  }

  const standaloneContentMatch = path.match(/^\/notion\/pages\/([^/]+)\/content\.md$/);
  if (standaloneContentMatch) {
    return buildMarkdownWriteback(standaloneContentMatch[1], content);
  }

  const databaseCommentsMatch = path.match(/^\/notion\/databases\/([^/]+)\/pages\/([^/]+)\/comments\.json$/);
  if (databaseCommentsMatch) {
    return buildCommentWriteback(databaseCommentsMatch[2], content);
  }

  const standaloneCommentsMatch = path.match(/^\/notion\/pages\/([^/]+)\/comments\.json$/);
  if (standaloneCommentsMatch) {
    return buildCommentWriteback(standaloneCommentsMatch[1], content);
  }

  const createDatabasePageMatch = path.match(/^\/notion\/databases\/([^/]+)\/pages\/?$/);
  if (createDatabasePageMatch) {
    return buildCreatePageWriteback(createDatabasePageMatch[1], content);
  }

  throw new Error(`No Notion writeback rule matched ${path}`);
}

function buildPagePropertiesWriteback(pageId: string, content: string): NotionWritebackRequest {
  const payload = parseJson(content);
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

function buildCreatePageWriteback(databaseId: string, content: string): NotionWritebackRequest {
  const payload = parseJson(content);
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

function parseJson(content: string): Record<string, unknown> {
  const parsed = safeParseJson(content);
  if (!isRecord(parsed)) {
    throw new Error('Expected JSON object payload');
  }
  return parsed;
}

function safeParseJson(content: string): JsonValue | string {
  try {
    return JSON.parse(content) as JsonValue;
  } catch {
    return content.trim();
  }
}

function readObject(record: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = record[key];
  return isRecord(value) ? value : undefined;
}

function readBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  return typeof record[key] === 'boolean' ? (record[key] as boolean) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
