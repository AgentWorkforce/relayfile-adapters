import { notionDatabasePageCommentsPath, notionStandalonePageCommentsPath } from '../path-mapper.js';
import { richTextToPlainText } from '../pages/properties.js';
import type { FileSemantics } from '@relayfile/sdk';
import type { NotionApiClient } from '../client.js';
import type { NotionComment, NotionNormalizedComment, NotionVfsFile } from '../types.js';

export async function listComments(client: NotionApiClient, pageOrBlockId: string): Promise<NotionComment[]> {
  return client.paginate<NotionComment>('GET', '/v1/comments', {
    query: {
      block_id: pageOrBlockId,
    },
  });
}

export function normalizeComment(comment: NotionComment): NotionNormalizedComment {
  return {
    object: 'comment',
    id: comment.id,
    discussionId: comment.discussion_id,
    parent: comment.parent,
    createdTime: comment.created_time,
    lastEditedTime: comment.last_edited_time,
    text: richTextToPlainText(comment.rich_text),
    richText: comment.rich_text,
  };
}

export function buildCommentsFile(
  comments: NotionComment[],
  context: { databaseId?: string; pageId: string },
): NotionVfsFile {
  const path = context.databaseId
    ? notionDatabasePageCommentsPath(context.databaseId, context.pageId)
    : notionStandalonePageCommentsPath(context.pageId);
  return {
    path,
    contentType: 'application/json; charset=utf-8',
    content: `${JSON.stringify(comments.map(normalizeComment), null, 2)}\n`,
    semantics: buildCommentSemantics(comments, context),
  };
}

function buildCommentSemantics(
  comments: NotionComment[],
  context: { databaseId?: string; pageId: string },
): FileSemantics {
  const properties: Record<string, string> = {
    provider: 'notion',
    'provider.object_id': context.pageId,
    'provider.object_type': 'comment',
    'notion.page_id': context.pageId,
  };
  if (context.databaseId) {
    properties['notion.database_id'] = context.databaseId;
  }
  return {
    properties,
    relations: [context.pageId],
    comments: comments.map((comment) => comment.id),
  };
}
