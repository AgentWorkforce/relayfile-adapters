import {
  readJsonFile,
  writeJsonFile,
  type IntegrationClientOptions
} from '@relayfile/adapter-core/vfs-client';
import { encodeSegment } from './generic.js';
import { providerClient, type ProviderClient } from './provider-client.js';
import { created } from './receipt.js';
import type { LinearAgentActivity } from '@relayfile/adapter-linear/types';

export interface LinearCreateIssueArgs {
  teamId: string;
  title: string;
  description?: string;
  assigneeId?: string;
  labelIds?: string[];
  projectId?: string;
  stateId?: string;
}

export interface LinearClient extends ProviderClient<'linear'> {
  /** Post an activity to a Linear Agent Session. */
  agentActivity(sessionId: string, activity: LinearAgentActivity): Promise<{ id: string; url: string }>;
  /** Send a response activity to a Linear Agent Session. */
  respond(sessionId: string, body: string): Promise<{ id: string; url: string }>;
  /** Send a quick thought activity so Linear knows the agent is working. */
  acknowledge(sessionId: string): Promise<{ id: string; url: string }>;
  /** Comment on an issue. */
  comment(issueId: string, body: string): Promise<{ id: string; url: string }>;
  /** Create an issue. */
  createIssue(args: LinearCreateIssueArgs): Promise<{ id: string; url: string }>;
  /** Patch an existing issue. */
  updateIssue(
    issueId: string,
    args: { title?: string; description?: string; assigneeId?: string; stateId?: string }
  ): Promise<void>;
  /** Read one issue by id. */
  getIssue<T = Record<string, unknown>>(issueId: string): Promise<T>;
  /** List issues. */
  listIssues<T = Record<string, unknown>>(): Promise<T[]>;
}

/**
 * Ergonomic Linear client over the writeback-path catalog. Recovers the
 * `ctx.linear.comment(...)` shape removed from the runtime, plus the uniform
 * resource-keyed access (`.issues`, `.comments`) every provider client has.
 */
export function linearClient(opts: IntegrationClientOptions = {}): LinearClient {
  const base = providerClient('linear', opts);
  const issuePath = (issueId: string) => `${base.issues.path()}/${encodeSegment(issueId)}.json`;
  const agentActivity = async (sessionId: string, activity: LinearAgentActivity) =>
    created(await base['agent-activities'].write({ sessionId }, activity));
  return Object.assign(base, {
    agentActivity,
    async respond(sessionId: string, body: string) {
      return agentActivity(sessionId, { type: 'response', body });
    },
    async acknowledge(sessionId: string) {
      return agentActivity(sessionId, { type: 'thought', body: 'Acknowledged.' });
    },
    async comment(issueId: string, body: string) {
      return created(await base.comments.write({ issueId }, { body }));
    },
    async createIssue(args: LinearCreateIssueArgs) {
      return created(await base.issues.write({}, args));
    },
    async updateIssue(issueId: string, args: Record<string, unknown>) {
      await writeJsonFile(opts, 'linear', 'updateIssue', issuePath(issueId), args);
    },
    getIssue<T = Record<string, unknown>>(issueId: string): Promise<T> {
      return readJsonFile<T>(opts, 'linear', 'getIssue', issuePath(issueId));
    },
    listIssues<T = Record<string, unknown>>(): Promise<T[]> {
      return base.issues.list<T>();
    }
  }) as LinearClient;
}
