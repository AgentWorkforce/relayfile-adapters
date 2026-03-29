import type { ConnectionProvider } from '@relayfile/sdk';
export type { ConnectionProvider, ProxyRequest, ProxyResponse } from '@relayfile/sdk';

import type { NormalizedWebhook } from './webhook-normalizer.js';
import type { SlackAdapterConfig, SlackChannelEvent, SlackEvent, SlackMessageEvent } from './types.js';
import {
  channelMetadataPath,
  computeSlackPath,
  createSlackMessageObjectId,
  createSlackReactionObjectId,
  createSlackThreadObjectId,
  createSlackThreadReplyObjectId,
  fileCommentPath,
  fileMetadataPath,
  messagePath,
  parseSlackReactionObjectId,
  threadPath,
  threadReplyPath,
  userMetadataPath,
} from './path-mapper.js';

export interface FileSemantics {
  properties?: Record<string, string>;
  relations?: string[];
  permissions?: string[];
  comments?: string[];
}

export interface IngestError {
  path: string;
  error: string;
}

export interface IngestResult {
  filesWritten: number;
  filesUpdated: number;
  filesDeleted: number;
  paths: string[];
  errors: IngestError[];
}

export interface WriteFileInput {
  workspaceId: string;
  path: string;
  baseRevision: string;
  content: string;
  contentType?: string;
  encoding?: 'base64' | 'utf-8';
  semantics?: FileSemantics;
  correlationId?: string;
}

export interface WriteFileResponse {
  opId?: string;
  status?: 'pending' | 'queued';
  targetRevision?: string;
}

export interface RelayFileClientLike {
  writeFile(input: WriteFileInput): Promise<WriteFileResponse>;
  readFile?(path: string): Promise<{ revision?: string } | undefined> | { revision?: string } | undefined;
  getWrittenRevision?(path: string): string | undefined;
}

export abstract class IntegrationAdapter {
  protected readonly client: RelayFileClientLike;
  protected readonly provider: ConnectionProvider;

  abstract readonly name: string;
  abstract readonly version: string;

  protected constructor(client: RelayFileClientLike, provider: ConnectionProvider) {
    this.client = client;
    this.provider = provider;
  }

  abstract ingestWebhook(workspaceId: string, event: NormalizedWebhook): Promise<IngestResult>;
  abstract computePath(objectType: string, objectId: string): string;
  abstract computeSemantics(
    objectType: string,
    objectId: string,
    payload: Record<string, unknown>,
  ): FileSemantics;

  supportedEvents?(): string[];
}

type CanonicalSlackObjectType =
  | 'channel'
  | 'file'
  | 'file_comment'
  | 'message'
  | 'reaction'
  | 'thread'
  | 'thread_reply'
  | 'user';

interface MaterializedSlackObject {
  objectType: CanonicalSlackObjectType;
  objectId: string;
  path: string;
  payload: Record<string, unknown>;
}

const SUPPORTED_EVENTS = [
  'channel.archived',
  'channel.created',
  'channel.member_joined',
  'channel.member_left',
  'channel.renamed',
  'channel.unarchived',
  'message.created',
  'message.deleted',
  'message.updated',
  'reaction.added',
  'reaction.removed',
] as const;

const USER_MENTION_PATTERN = /<@([A-Z0-9]+)(?:\|[^>]+)?>/g;
const CHANNEL_MENTION_PATTERN = /<#([A-Z0-9]+)(?:\|[^>]+)?>/g;
const SPECIAL_MENTION_PATTERN = /<!([^>]+)>/g;
const SLACK_LINK_PATTERN = /<((?:https?:\/\/|mailto:)[^>|]+)(?:\|[^>]+)?>/g;
const RAW_LINK_PATTERN = /\bhttps?:\/\/[^\s<>()]+/g;

export class SlackAdapter extends IntegrationAdapter {
  readonly name = 'slack';
  readonly version = '0.1.0';

  constructor(
    client: RelayFileClientLike,
    provider: ConnectionProvider,
    private readonly config: SlackAdapterConfig,
  ) {
    super(client, provider);
  }

  override supportedEvents(): string[] {
    return [...SUPPORTED_EVENTS];
  }

  override computePath(objectType: string, objectId: string): string {
    return computeSlackPath(objectType, objectId);
  }

  override computeSemantics(
    objectType: string,
    objectId: string,
    payload: Record<string, unknown>,
  ): FileSemantics {
    const textFragments = collectTextFragments(payload);
    const joinedText = textFragments.join('\n');
    const mentions = extractMentions(joinedText);
    const links = extractLinks(joinedText);
    const reactionSummaries = extractReactions(payload);
    const channelId = readString(payload.channel);
    const userId = readString(payload.user);
    const itemUserId = readString(payload.item_user);
    const threadTs = readString(payload.thread_ts);
    const messageTs = readString(payload.ts) ?? readString(payload.event_ts);
    const eventType = readString(payload.type) ?? objectType;
    const isThread = objectType === 'thread' || objectType === 'thread_reply' || !!threadTs;
    const threadDepth =
      objectType === 'thread_reply' || (threadTs && messageTs && threadTs !== messageTs) ? '1' : isThread ? '0' : '0';
    const relations = new Set<string>();
    const permissions = new Set<string>();
    const comments = new Set<string>();

    if (channelId) {
      relations.add(`channel:${channelId}`);
    }
    if (userId) {
      relations.add(`user:${userId}`);
    }
    if (itemUserId) {
      relations.add(`subject_user:${itemUserId}`);
    }
    if (mentions.users.size > 0) {
      for (const mention of mentions.users) {
        relations.add(`mentions:user:${mention}`);
        comments.add(`mention:user:${mention}`);
      }
    }
    if (mentions.channels.size > 0) {
      for (const mention of mentions.channels) {
        relations.add(`mentions:channel:${mention}`);
        comments.add(`mention:channel:${mention}`);
      }
    }
    if (mentions.special.size > 0) {
      for (const mention of mentions.special) {
        relations.add(`mentions:special:${mention}`);
        comments.add(`mention:special:${mention}`);
      }
    }
    if (links.size > 0) {
      for (const link of links) {
        relations.add(`link:${link}`);
        comments.add(`link:${link}`);
      }
    }
    if (reactionSummaries.size > 0) {
      for (const reaction of reactionSummaries) {
        relations.add(`reaction:${reaction}`);
        comments.add(`reaction:${reaction}`);
      }
    }

    const channelType = readString(payload.channel_type);
    if (channelType === 'im') {
      permissions.add('scope:dm');
    } else if (channelType === 'mpim') {
      permissions.add('scope:mpim');
    } else if (channelType === 'group') {
      permissions.add('scope:private');
    } else if (channelType === 'channel') {
      permissions.add('scope:workspace');
    }

    const channelPayload = asRecord(payload.channel);
    if (channelPayload?.is_private === true) {
      permissions.add('scope:private');
    }
    if (channelPayload?.is_archived === true) {
      comments.add('channel:archived');
    }

    if (threadTs && channelId) {
      relations.add(`thread:${channelId}:${threadTs}`);
      comments.add(`thread_depth:${threadDepth}`);
      if (messageTs && threadTs !== messageTs) {
        relations.add(`reply_to:${channelId}:${threadTs}`);
      }
    }

    const properties: Record<string, string> = {
      event_type: eventType,
      object_id: objectId,
      object_type: objectType,
      reaction_count: String(reactionSummaries.size),
      link_count: String(links.size),
      mention_count: String(mentions.count),
      thread_depth: threadDepth,
    };

    setProperty(properties, 'channel_id', channelId);
    setProperty(properties, 'channel_type', channelType);
    setProperty(properties, 'item_user_id', itemUserId);
    setProperty(properties, 'message_ts', messageTs);
    setProperty(properties, 'subtype', readString(payload.subtype));
    setProperty(properties, 'thread_ts', threadTs);
    setProperty(properties, 'user_id', userId);

    return {
      properties,
      relations: [...relations],
      permissions: [...permissions],
      comments: [...comments],
    };
  }

  override async ingestWebhook(workspaceId: string, event: NormalizedWebhook): Promise<IngestResult> {
    const canonical = this.materializeEvent(event);
    const semantics = this.computeSemantics(canonical.objectType, canonical.objectId, canonical.payload);
    const content = stableStringify({
      provider: 'slack',
      connectionId: event.connectionId ?? this.config.connectionId ?? '',
      eventType: event.eventType,
      objectType: canonical.objectType,
      objectId: canonical.objectId,
      workspaceId,
      payload: canonical.payload,
    });

    const baseRevision = await this.getBaseRevision(canonical.path);
    const result: IngestResult = {
      filesWritten: baseRevision === '0' ? 1 : 0,
      filesUpdated: baseRevision === '0' ? 0 : 1,
      filesDeleted: 0,
      paths: [canonical.path],
      errors: [],
    };

    try {
      await this.client.writeFile({
        workspaceId,
        path: canonical.path,
        baseRevision,
        content,
        contentType: 'application/json',
        encoding: 'utf-8',
        semantics,
      });
    } catch (error) {
      result.filesWritten = 0;
      result.filesUpdated = 0;
      result.errors.push({
        path: canonical.path,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return result;
  }

  private materializeEvent(event: NormalizedWebhook): MaterializedSlackObject {
    const payload = event.payload ?? {};
    const inferredType = inferCanonicalObjectType(event, payload);
    const objectType = inferredType ?? normalizeObjectType(event.objectType);
    const objectId = this.resolveObjectId(objectType, event, payload);

    return {
      objectType,
      objectId,
      path: this.resolvePath(objectType, objectId, payload),
      payload,
    };
  }

  private resolveObjectId(
    objectType: CanonicalSlackObjectType,
    event: NormalizedWebhook,
    payload: Record<string, unknown>,
  ): string {
    switch (objectType) {
      case 'channel':
        return readString(payload.channel)
          ?? readString(asRecord(payload.channel)?.id)
          ?? event.objectId;
      case 'message': {
        const channelId = readString(payload.channel);
        const messageTs = readString(payload.ts) ?? readString(payload.event_ts);
        if (channelId && messageTs) {
          return createSlackMessageObjectId(channelId, messageTs);
        }
        return event.objectId;
      }
      case 'thread': {
        const channelId = readString(payload.channel);
        const threadTs = readString(payload.thread_ts) ?? readString(payload.ts);
        if (channelId && threadTs) {
          return createSlackThreadObjectId(channelId, threadTs);
        }
        return event.objectId;
      }
      case 'thread_reply': {
        const channelId = readString(payload.channel);
        const threadTs = readString(payload.thread_ts);
        const replyTs = readString(payload.ts);
        if (channelId && threadTs && replyTs) {
          return createSlackThreadReplyObjectId(channelId, threadTs, replyTs);
        }
        return event.objectId;
      }
      case 'reaction': {
        const objectId = this.resolveReactionObjectId(payload);
        return objectId ?? event.objectId;
      }
      case 'user':
        return readString(payload.user) ?? event.objectId;
      case 'file':
        return readString(payload.file) ?? event.objectId;
      case 'file_comment':
        return readString(payload.file_comment) ?? event.objectId;
    }
  }

  private resolvePath(
    objectType: CanonicalSlackObjectType,
    objectId: string,
    payload: Record<string, unknown>,
  ): string {
    if (objectType === 'message') {
      const channelId = readString(payload.channel);
      const messageTs = readString(payload.ts);
      if (channelId && messageTs) {
        return messagePath(channelId, messageTs);
      }
    }

    if (objectType === 'thread') {
      const channelId = readString(payload.channel);
      const threadTs = readString(payload.thread_ts) ?? readString(payload.ts);
      if (channelId && threadTs) {
        return threadPath(channelId, threadTs);
      }
    }

    if (objectType === 'thread_reply') {
      const channelId = readString(payload.channel);
      const threadTs = readString(payload.thread_ts);
      const replyTs = readString(payload.ts);
      if (channelId && threadTs && replyTs) {
        return threadReplyPath(channelId, threadTs, replyTs);
      }
    }

    if (objectType === 'channel') {
      const channelId = readString(payload.channel) ?? readString(asRecord(payload.channel)?.id);
      if (channelId) {
        return channelMetadataPath(channelId);
      }
    }

    if (objectType === 'user') {
      const userId = readString(payload.user);
      if (userId) {
        return userMetadataPath(userId);
      }
    }

    if (objectType === 'file') {
      const fileId = readString(payload.file);
      if (fileId) {
        return fileMetadataPath(fileId);
      }
    }

    if (objectType === 'file_comment') {
      const fileCommentId = readString(payload.file_comment);
      if (fileCommentId) {
        return fileCommentPath(fileCommentId);
      }
    }

    if (objectType === 'reaction') {
      const reactionId = this.resolveReactionObjectId(payload);
      if (reactionId) {
        const parsed = parseSlackReactionObjectId(reactionId);
        if (parsed) {
          return computeSlackPath('reaction', reactionId);
        }
      }
    }

    return this.computePath(objectType, objectId);
  }

  private resolveReactionObjectId(payload: Record<string, unknown>): string | null {
    const item = asRecord(payload.item);
    const reaction = readString(payload.reaction);
    const userId = readString(payload.user);

    if (!item || !reaction || !userId) {
      return null;
    }

    const itemType = readString(item.type);
    if (itemType === 'message') {
      const channelId = readString(item.channel);
      const messageTs = readString(item.ts);
      const threadTs = readString(payload.thread_ts);
      if (!channelId || !messageTs) {
        return null;
      }

      if (threadTs && threadTs !== messageTs) {
        return createSlackReactionObjectId({
          targetType: 'thread_reply',
          channelId,
          threadTs,
          replyTs: messageTs,
          reaction,
          userId,
        });
      }

      if (threadTs && threadTs === messageTs) {
        return createSlackReactionObjectId({
          targetType: 'thread',
          channelId,
          threadTs,
          reaction,
          userId,
        });
      }

      return createSlackReactionObjectId({
        targetType: 'message',
        channelId,
        messageTs,
        reaction,
        userId,
      });
    }

    if (itemType === 'file') {
      const fileId = readString(item.file);
      return fileId
        ? createSlackReactionObjectId({ targetType: 'file', fileId, reaction, userId })
        : null;
    }

    if (itemType === 'file_comment') {
      const fileCommentId = readString(item.file_comment);
      return fileCommentId
        ? createSlackReactionObjectId({ targetType: 'file_comment', fileCommentId, reaction, userId })
        : null;
    }

    return null;
  }

  private async getBaseRevision(path: string): Promise<string> {
    if (typeof this.client.getWrittenRevision === 'function') {
      return this.client.getWrittenRevision(path) ?? '0';
    }

    if (typeof this.client.readFile === 'function') {
      const existing = await this.client.readFile(path);
      return existing?.revision ?? '0';
    }

    return '0';
  }
}

function normalizeObjectType(objectType: string): CanonicalSlackObjectType {
  switch (objectType) {
    case 'channel':
    case 'file':
    case 'file_comment':
    case 'message':
    case 'reaction':
    case 'thread':
    case 'thread_reply':
    case 'user':
      return objectType;
    default:
      return 'message';
  }
}

function inferCanonicalObjectType(
  event: NormalizedWebhook,
  payload: Record<string, unknown>,
): CanonicalSlackObjectType | null {
  const explicit = normalizeSlackEventType(event.eventType);
  if (explicit === 'reaction') {
    return 'reaction';
  }
  if (explicit === 'channel') {
    return 'channel';
  }

  if (payload.type === 'message') {
    const threadTs = readString(payload.thread_ts);
    const ts = readString(payload.ts);
    if (threadTs && ts) {
      return threadTs === ts ? 'thread' : 'thread_reply';
    }
    return 'message';
  }

  if (payload.type === 'reaction_added' || payload.type === 'reaction_removed') {
    return 'reaction';
  }

  if (typeof payload.type === 'string' && payload.type.startsWith('channel_')) {
    return 'channel';
  }

  return null;
}

function normalizeSlackEventType(eventType: string): 'channel' | 'message' | 'reaction' | null {
  if (eventType.startsWith('reaction.')) {
    return 'reaction';
  }
  if (eventType.startsWith('channel.')) {
    return 'channel';
  }
  if (eventType.startsWith('message.')) {
    return 'message';
  }
  return null;
}

function collectTextFragments(payload: Record<string, unknown>): string[] {
  const fragments = new Set<string>();
  addIfString(fragments, payload.text);

  const attachments = asArray(payload.attachments);
  for (const attachment of attachments) {
    const record = asRecord(attachment);
    if (!record) {
      continue;
    }
    addIfString(fragments, record.fallback);
    addIfString(fragments, record.footer);
    addIfString(fragments, record.pretext);
    addIfString(fragments, record.text);
    addIfString(fragments, record.title);
    addIfString(fragments, record.title_link);
  }

  const blocks = asArray(payload.blocks);
  for (const block of blocks) {
    collectNestedStrings(block, fragments, 2);
  }

  return [...fragments];
}

function collectNestedStrings(value: unknown, target: Set<string>, depth: number): void {
  if (depth < 0) {
    return;
  }
  if (typeof value === 'string') {
    target.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectNestedStrings(item, target, depth - 1);
    }
    return;
  }
  if (value && typeof value === 'object') {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      collectNestedStrings(nested, target, depth - 1);
    }
  }
}

function extractMentions(text: string): {
  users: Set<string>;
  channels: Set<string>;
  special: Set<string>;
  count: number;
} {
  const users = collectMatches(text, USER_MENTION_PATTERN);
  const channels = collectMatches(text, CHANNEL_MENTION_PATTERN);
  const special = collectMatches(text, SPECIAL_MENTION_PATTERN);

  return {
    users,
    channels,
    special,
    count: users.size + channels.size + special.size,
  };
}

function extractLinks(text: string): Set<string> {
  const links = new Set<string>();
  for (const pattern of [SLACK_LINK_PATTERN, RAW_LINK_PATTERN]) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      links.add(match[1] ?? match[0]);
    }
  }
  return links;
}

function extractReactions(payload: Record<string, unknown>): Set<string> {
  const reactions = new Set<string>();
  const singleReaction = readString(payload.reaction);
  if (singleReaction) {
    reactions.add(singleReaction);
  }

  for (const entry of asArray(payload.reactions)) {
    const record = asRecord(entry);
    const name = readString(record?.name);
    if (!name) {
      continue;
    }

    const count = readNumber(record?.count);
    reactions.add(count === null ? name : `${name}:${count}`);
  }

  return reactions;
}

function collectMatches(text: string, pattern: RegExp): Set<string> {
  const values = new Set<string>();
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const value = match[1]?.trim();
    if (value) {
      values.add(value);
    }
  }
  return values;
}

function setProperty(target: Record<string, string>, key: string, value: string | null): void {
  if (value) {
    target[key] = value;
  }
}

function addIfString(target: Set<string>, value: unknown): void {
  if (typeof value === 'string' && value.trim()) {
    target.add(value);
  }
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value), null, 2);
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortValue(item));
  }
  if (value && typeof value === 'object') {
    const sortedEntries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    const result: Record<string, unknown> = {};
    for (const [key, nested] of sortedEntries) {
      result[key] = sortValue(nested);
    }
    return result;
  }
  return value;
}

export type { SlackChannelEvent, SlackEvent, SlackMessageEvent };
