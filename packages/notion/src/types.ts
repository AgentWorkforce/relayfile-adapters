import type { BulkWriteFile, FileSemantics } from '@relayfile/sdk';

export const NOTION_PROVIDER_NAME = 'notion';
export const NOTION_PATH_ROOT = '/notion';
export const DEFAULT_NOTION_API_BASE_URL = 'https://api.notion.com';
export const DEFAULT_NOTION_API_VERSION = '2022-06-28';
export const DEFAULT_NOTION_MARKDOWN_API_VERSION = '2026-03-11';
export const DEFAULT_NOTION_PAGE_SIZE = 100;

export type JsonPrimitive = boolean | number | null | string;
export type JsonValue = JsonArray | JsonObject | JsonPrimitive;
export interface JsonObject {
  [key: string]: JsonValue | undefined;
}
export type JsonArray = JsonValue[];

export interface ProxyRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  baseUrl: string;
  endpoint: string;
  connectionId: string;
  headers?: Record<string, string>;
  body?: unknown;
  query?: Record<string, string>;
}

export interface ProxyResponse {
  status: number;
  headers: Record<string, string>;
  data: unknown;
}

export interface NotionConnectionProvider {
  readonly name: string;
  proxy?(request: ProxyRequest): Promise<ProxyResponse>;
  healthCheck?(connectionId: string): Promise<boolean>;
}

export interface NotionAdapterConfig {
  apiBaseUrl?: string;
  apiVersion?: string;
  markdownApiVersion?: string;
  token?: string;
  connectionId?: string;
  databaseIds?: string[];
  pageIds?: string[];
  defaultPageSize?: number;
  fetchComments?: boolean;
  fetchBlockJson?: boolean;
  enableMarkdown?: boolean;
}

export interface NotionRequestOptions {
  apiVersion?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
}

export interface NotionPaginatedRequestOptions extends NotionRequestOptions {
  pageSize?: number;
  startCursor?: string;
}

export type NotionParent =
  | { type: 'database_id'; database_id: string }
  | { type: 'page_id'; page_id: string }
  | { type: 'block_id'; block_id: string }
  | { type: 'workspace'; workspace: true };

export interface NotionAnnotations {
  bold: boolean;
  italic: boolean;
  strikethrough: boolean;
  underline: boolean;
  code: boolean;
  color: string;
}

export interface NotionTextContent {
  content: string;
  link: { url: string } | null;
}

export interface NotionRichTextBase {
  plain_text: string;
  href?: string | null;
  annotations: NotionAnnotations;
}

export interface NotionTextRichText extends NotionRichTextBase {
  type: 'text';
  text: NotionTextContent;
}

export interface NotionEquationRichText extends NotionRichTextBase {
  type: 'equation';
  equation: { expression: string };
}

export interface NotionMentionRichText extends NotionRichTextBase {
  type: 'mention';
  mention: Record<string, unknown>;
}

export type NotionRichText = NotionEquationRichText | NotionMentionRichText | NotionTextRichText;

export interface NotionUser {
  object: 'user';
  id: string;
  type?: string;
  name?: string | null;
  avatar_url?: string | null;
  person?: { email?: string } | null;
}

export interface NotionSelectOption {
  id?: string;
  name: string;
  color?: string;
}

export interface NotionDateValue {
  start: string;
  end?: string | null;
  time_zone?: string | null;
}

export interface NotionFileAsset {
  type: 'external' | 'file' | string;
  name?: string;
  external?: { url: string };
  file?: { url: string; expiry_time?: string };
  caption?: NotionRichText[];
}

export type NotionPropertyType =
  | 'title'
  | 'rich_text'
  | 'number'
  | 'select'
  | 'multi_select'
  | 'status'
  | 'date'
  | 'people'
  | 'files'
  | 'checkbox'
  | 'url'
  | 'email'
  | 'phone_number'
  | 'formula'
  | 'relation'
  | 'rollup'
  | 'created_time'
  | 'created_by'
  | 'last_edited_time'
  | 'last_edited_by';

export interface NotionPropertyBase<TType extends NotionPropertyType> {
  id: string;
  type: TType;
}

export type NotionPageProperty =
  | (NotionPropertyBase<'title'> & { title: NotionRichText[] })
  | (NotionPropertyBase<'rich_text'> & { rich_text: NotionRichText[] })
  | (NotionPropertyBase<'number'> & { number: number | null })
  | (NotionPropertyBase<'select'> & { select: NotionSelectOption | null })
  | (NotionPropertyBase<'multi_select'> & { multi_select: NotionSelectOption[] })
  | (NotionPropertyBase<'status'> & { status: NotionSelectOption | null })
  | (NotionPropertyBase<'date'> & { date: NotionDateValue | null })
  | (NotionPropertyBase<'people'> & { people: NotionUser[] })
  | (NotionPropertyBase<'files'> & { files: NotionFileAsset[] })
  | (NotionPropertyBase<'checkbox'> & { checkbox: boolean })
  | (NotionPropertyBase<'url'> & { url: string | null })
  | (NotionPropertyBase<'email'> & { email: string | null })
  | (NotionPropertyBase<'phone_number'> & { phone_number: string | null })
  | (NotionPropertyBase<'relation'> & { relation: Array<{ id: string }> })
  | (NotionPropertyBase<'formula'> & { formula: Record<string, unknown> | null })
  | (NotionPropertyBase<'rollup'> & { rollup: Record<string, unknown> | null })
  | (NotionPropertyBase<'created_time'> & { created_time: string })
  | (NotionPropertyBase<'created_by'> & { created_by: NotionUser })
  | (NotionPropertyBase<'last_edited_time'> & { last_edited_time: string })
  | (NotionPropertyBase<'last_edited_by'> & { last_edited_by: NotionUser });

export interface NotionPropertySchema {
  id: string;
  name?: string;
  type: NotionPropertyType | string;
  [key: string]: unknown;
}

export interface NotionPage {
  object: 'page';
  id: string;
  parent: NotionParent;
  url?: string;
  public_url?: string | null;
  icon?: Record<string, unknown> | null;
  cover?: Record<string, unknown> | null;
  archived?: boolean;
  in_trash?: boolean;
  created_time?: string;
  last_edited_time?: string;
  created_by?: NotionUser;
  last_edited_by?: NotionUser;
  properties: Record<string, NotionPageProperty>;
}

export interface NotionDatabase {
  object: 'database';
  id: string;
  title?: NotionRichText[];
  description?: NotionRichText[];
  url?: string;
  archived?: boolean;
  in_trash?: boolean;
  created_time?: string;
  last_edited_time?: string;
  parent?: NotionParent;
  is_inline?: boolean;
  properties: Record<string, NotionPropertySchema>;
  data_sources?: Array<{ id: string; name?: string }>;
}

export type NotionBlockType =
  | 'paragraph'
  | 'heading_1'
  | 'heading_2'
  | 'heading_3'
  | 'bulleted_list_item'
  | 'numbered_list_item'
  | 'to_do'
  | 'toggle'
  | 'quote'
  | 'callout'
  | 'code'
  | 'divider'
  | 'image'
  | 'file'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'bookmark'
  | 'embed'
  | 'table'
  | 'table_row'
  | 'child_page'
  | 'child_database'
  | 'synced_block'
  | 'column'
  | 'column_list'
  | 'table_of_contents'
  | 'unsupported'
  | string;

export interface NotionBlock {
  object: 'block';
  id: string;
  type: NotionBlockType;
  has_children: boolean;
  archived?: boolean;
  in_trash?: boolean;
  created_time?: string;
  last_edited_time?: string;
  created_by?: NotionUser;
  last_edited_by?: NotionUser;
  parent?: NotionParent;
  children?: NotionBlock[];
  [key: string]: unknown;
}

export interface NotionComment {
  object: 'comment';
  id: string;
  parent: { type: 'page_id'; page_id: string } | { type: 'block_id'; block_id: string };
  discussion_id?: string;
  created_time?: string;
  last_edited_time?: string;
  created_by?: NotionUser;
  rich_text: NotionRichText[];
  attachments?: Array<Record<string, unknown>>;
}

export interface NotionListResponse<T> {
  object: 'list';
  results: T[];
  next_cursor: string | null;
  has_more: boolean;
  type?: string;
}

export interface NotionPageMarkdown {
  object: 'page_markdown';
  id: string;
  markdown: string;
  truncated: boolean;
  unknown_block_ids: string[];
}

export interface SerializedPropertyValue {
  id: string;
  type: NotionPropertyType | string;
  value: unknown;
  displayValue?: string;
  raw?: unknown;
}

export interface SerializedPropertySchema {
  id: string;
  name: string;
  type: string;
  config?: unknown;
}

export interface NotionNormalizedDatabase {
  object: 'database';
  id: string;
  title: string;
  description: string;
  url?: string;
  lastEditedTime?: string;
  properties: Record<string, SerializedPropertySchema>;
  dataSources?: Array<{ id: string; name?: string }>;
}

export interface NotionNormalizedPage {
  object: 'page';
  id: string;
  title: string;
  parent: NotionParent;
  databaseId?: string;
  url?: string;
  lastEditedTime?: string;
  createdTime?: string;
  archived?: boolean;
  inTrash?: boolean;
  properties: Record<string, SerializedPropertyValue>;
}

export interface NotionNormalizedBlock {
  object: 'block';
  id: string;
  type: string;
  hasChildren: boolean;
  parent?: NotionParent;
  lastEditedTime?: string;
  text?: string;
  data: Record<string, unknown>;
  childIds: string[];
}

export interface NotionNormalizedComment {
  object: 'comment';
  id: string;
  discussionId?: string;
  parent: NotionComment['parent'];
  createdTime?: string;
  lastEditedTime?: string;
  text: string;
  richText: NotionRichText[];
}

export interface NotionVfsFile extends BulkWriteFile {
  path: string;
  semantics?: FileSemantics;
}

export interface NotionFilterCondition {
  property?: string;
  type?: string;
  timestamp?: 'created_time' | 'last_edited_time';
  operator?: string;
  value?: JsonValue;
  and?: NotionFilterCondition[];
  or?: NotionFilterCondition[];
}

export interface NotionSortCondition {
  property?: string;
  timestamp?: 'created_time' | 'last_edited_time';
  direction?: 'ascending' | 'descending';
}

export interface NotionDatabaseQueryInput {
  filter?: NotionFilterCondition;
  sorts?: NotionSortCondition[];
  pageSize?: number;
  startCursor?: string;
}

export interface NotionSearchInput {
  query?: string;
  filter?: Record<string, unknown>;
  sort?: Record<string, unknown>;
  pageSize?: number;
  startCursor?: string;
}

export interface NotionSyncCursor {
  watermark: string;
}

export interface NotionSyncChangeSet {
  pages: NotionPage[];
  nextCursor: string;
}

export interface NotionWritebackRequest {
  action:
    | 'create_comment'
    | 'create_page'
    | 'update_page_markdown'
    | 'update_page_properties';
  method: 'POST' | 'PATCH';
  endpoint: string;
  apiVersion?: string;
  body: Record<string, unknown>;
}
