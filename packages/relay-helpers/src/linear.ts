import {
  readJsonFile,
  writeJsonFile,
} from '@relayfile/adapter-core/vfs-client';
import { linearByUuidAliasPath } from '@relayfile/adapter-linear/path-mapper';
import { encodeSegment } from './generic.js';
import { providerClient, type ProviderClient } from './provider-client.js';
import { created } from './receipt.js';
import type { LinearAgentActivity } from '@relayfile/adapter-linear/types';
import {
  createRelayTransportResolver,
  type RelayClientOptions,
} from './transport.js';

export interface LinearCreateIssueArgs {
  teamId: string;
  title: string;
  description?: string;
  assigneeId?: string;
  labelIds?: string[];
  projectId?: string;
  stateId?: string;
}

export interface LinearUpdateIssueArgs {
  title?: string;
  description?: string;
  assigneeId?: string;
  stateId?: string;
  projectId?: string;
  labelIds?: string[];
  addedLabelIds?: string[];
  removedLabelIds?: string[];
}

export interface LinearCreateLabelArgs {
  name: string;
  description?: string;
  color?: string;
  teamId?: string;
  parentId?: string;
}

export type LinearUpdateLabelArgs = Partial<Pick<LinearCreateLabelArgs, 'name' | 'description' | 'color' | 'parentId'>>;

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
  updateIssue(issueId: string, args: LinearUpdateIssueArgs): Promise<void>;
  /** Create a label. */
  createLabel(args: LinearCreateLabelArgs): Promise<{ id: string; url: string }>;
  /** Patch an existing label. */
  updateLabel(labelId: string, args: LinearUpdateLabelArgs): Promise<void>;
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
export function linearClient(opts: RelayClientOptions = {}): LinearClient {
  const base = providerClient('linear', opts);
  const resolveTransport = createRelayTransportResolver(opts);
  const issuePath = (issueId: string) => `${base.issues.path()}/${encodeSegment(issueId)}.json`;
  const labelPath = (labelId: string) => `${base.labels.path()}/${encodeSegment(labelId)}.json`;
  // Read lookup follows the adapter's stable UUID alias. Writeback keeps the
  // canonical issue item path until its contract is separately proven.
  const issueUuidPath = (issueId: string) => linearByUuidAliasPath(base.issues.path(), issueId);
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
      const path = issuePath(issueId);
      const transport = resolveTransport();
      if (transport) {
        await transport.write({ provider: 'linear', resource: 'issues', parameters: { issueId }, path, body: args });
      } else {
        await writeJsonFile(opts, 'linear', 'updateIssue', path, args);
      }
    },
    async createLabel(args: LinearCreateLabelArgs) {
      return created(await base.labels.write({}, args));
    },
    async updateLabel(labelId: string, args: Record<string, unknown>) {
      const path = labelPath(labelId);
      const transport = resolveTransport();
      if (transport) {
        await transport.write({ provider: 'linear', resource: 'labels', parameters: { labelId }, path, body: args });
      } else {
        await writeJsonFile(opts, 'linear', 'updateLabel', path, args);
      }
    },
    getIssue<T = Record<string, unknown>>(issueId: string): Promise<T> {
      const path = issueUuidPath(issueId);
      const transport = resolveTransport();
      return transport
        ? transport.read<T>({ provider: 'linear', resource: 'issues', parameters: { issueId }, path })
        : readJsonFile<T>(opts, 'linear', 'getIssue', path);
    },
    listIssues<T = Record<string, unknown>>(): Promise<T[]> {
      return base.issues.list<T>();
    }
  }) as LinearClient;
}
