import { renderBlocksToMarkdown } from './renderer.js';
import type { NotionApiClient } from '../client.js';
import type { NotionBlock, NotionPageMarkdown } from '../types.js';

export interface UpdatePageMarkdownInput {
  pageId: string;
  markdown: string;
  allowDeletingContent?: boolean;
}

export async function retrievePageMarkdown(
  client: NotionApiClient,
  pageId: string,
  includeTranscript = false,
): Promise<NotionPageMarkdown> {
  return client.request<NotionPageMarkdown>('GET', `/v1/pages/${encodeURIComponent(pageId)}/markdown`, {
    apiVersion: client.config.markdownApiVersion,
    query: includeTranscript ? { include_transcript: true } : undefined,
  });
}

export async function updatePageMarkdown(
  client: NotionApiClient,
  input: UpdatePageMarkdownInput,
): Promise<NotionPageMarkdown> {
  return client.request<NotionPageMarkdown>('PATCH', `/v1/pages/${encodeURIComponent(input.pageId)}/markdown`, {
    apiVersion: client.config.markdownApiVersion,
    body: {
      type: 'replace_content',
      replace_content: {
        new_str: input.markdown,
        allow_deleting_content: input.allowDeletingContent ?? true,
      },
    },
  });
}

export async function resolvePageMarkdown(
  client: NotionApiClient,
  pageId: string,
  blocks?: NotionBlock[],
): Promise<NotionPageMarkdown> {
  if (client.config.enableMarkdown) {
    try {
      return await retrievePageMarkdown(client, pageId);
    } catch (error) {
      if (!blocks) {
        throw error;
      }
    }
  }

  return {
    object: 'page_markdown',
    id: pageId,
    markdown: renderBlocksToMarkdown(blocks ?? []),
    truncated: false,
    unknown_block_ids: [],
  };
}
