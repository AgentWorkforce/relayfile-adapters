export const GITHUB_API_BASE_URL = "https://api.github.com";
import { normalizeMaterializationPolicy } from '@relayfile/adapter-core';
import type {
  GitHubAdapterConfig,
  GitHubMaterializationResource,
} from './types.js';

/**
 * GitHub webhook events this adapter ingests. These are exactly the names a
 * persona author uses in `integrations.github.triggers[].on` (they flow into
 * `KNOWN_TRIGGER_CATALOG` via `adapter-core triggers generate`), so the inline
 * notes below double as authoring hints. Names are `<event>.<action>` (or just
 * `<event>` when GitHub sends no action, e.g. `push`) taken verbatim from
 * GitHub's webhook payloads — see
 * https://docs.github.com/en/webhooks/webhook-events-and-payloads
 *
 * Keep in sync with `DEFAULT_GITHUB_EVENTS` (types.ts) and the router's
 * `EVENT_MAP` (webhook/event-map.ts) — every event the router ingests should
 * be listed here so it lands in the trigger catalog.
 */
const DEFAULT_SUPPORTED_EVENTS = [
  'pull_request.opened', // a PR was opened — the usual entry point for review/CI agents
  'pull_request.synchronize', // new commits were pushed to an open PR (re-review / re-run CI)
  'pull_request.edited', // PR title/body/base metadata changed
  'pull_request.reopened', // a closed PR was reopened
  'pull_request.closed', // a PR was closed (check `merged` in the payload to tell merge from abandon)
  'pull_request_review.submitted', // someone (human or bot) submitted a review — has `review.state` (approved / changes_requested / commented)
  'pull_request_review.edited', // review body or metadata changed
  'pull_request_review.dismissed', // a submitted review was dismissed
  'pull_request_review_comment.created', // an inline review comment was added to a PR's diff
  'pull_request_review_thread.resolved', // a PR review thread was resolved
  'issue_comment.created', // a comment was added to an issue conversation
  'push', // commits were pushed to a branch or tag (no action suffix; routed to ingestPushCommits)
  'issues.opened', // an issue was opened
  'issues.edited', // issue title/body/metadata changed
  'issues.labeled', // a label was added to an existing issue
  'issues.unlabeled', // a label was removed from an existing issue
  'issues.reopened', // a closed issue was reopened
  'issues.closed', // an issue was closed
  'check_run.completed', // a CI check finished — `check_run.conclusion` is success / failure / timed_out / cancelled / …
  'status', // a classic commit status changed — refreshes parent PR gate metadata without overwriting commit records
  'deployment_status.created', // a deployment's status changed — `deployment_status.state` is success / failure / error / pending / in_progress / … (powers deploy-watch agents)
] as const;
export const GITHUB_MATERIALIZATION_RESOURCES = ['issues', 'pulls', 'commits'] as const satisfies readonly GitHubMaterializationResource[];
const GITHUB_MATERIALIZATION_STATES = ['open', 'closed', 'all'] as const;
export const GITHUB_DEFAULT_MAX_COMMITS = 500;

export const DEFAULT_CONFIG: GitHubAdapterConfig = {
  baseUrl: 'https://api.github.com',
  defaultBranch: 'main',
  fetchFileContents: true,
  lazy: false,
  maxCommits: GITHUB_DEFAULT_MAX_COMMITS,
  maxFileSizeBytes: 1024 * 1024,
  supportedEvents: [...DEFAULT_SUPPORTED_EVENTS],
};

export const GITHUB_ADAPTER_CONFIG_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'GitHub Adapter Config',
  type: 'object',
  additionalProperties: true,
  properties: {
    baseUrl: {
      type: 'string',
      format: 'uri',
      default: DEFAULT_CONFIG.baseUrl,
    },
    defaultBranch: {
      type: 'string',
      minLength: 1,
      default: DEFAULT_CONFIG.defaultBranch,
    },
    fetchFileContents: {
      type: 'boolean',
      default: DEFAULT_CONFIG.fetchFileContents,
    },
    lazy: {
      type: 'boolean',
      default: DEFAULT_CONFIG.lazy,
    },
    materialization: {
      type: 'object',
      additionalProperties: true,
      properties: {
        default: {
          type: 'string',
          enum: ['lazy', 'eager', 'none', 'all'],
          default: DEFAULT_CONFIG.lazy ? 'lazy' : 'eager',
        },
        webhookWritesForLazyRepos: {
          type: 'boolean',
          default: true,
        },
        rules: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: true,
          },
        },
      },
    },
    maxFileSizeBytes: {
      type: 'integer',
      minimum: 1,
      default: DEFAULT_CONFIG.maxFileSizeBytes,
    },
    maxCommits: {
      type: 'integer',
      minimum: 1,
      default: DEFAULT_CONFIG.maxCommits,
    },
    supportedEvents: {
      type: 'array',
      default: [...DEFAULT_CONFIG.supportedEvents],
      items: {
        type: 'string',
        minLength: 1,
        enum: [...DEFAULT_SUPPORTED_EVENTS],
      },
      uniqueItems: true,
    },
  },
} as const;

export function validateConfig<T extends Partial<GitHubAdapterConfig> & Record<string, unknown>>(
  config: T = {} as T,
): GitHubAdapterConfig & Omit<T, keyof GitHubAdapterConfig> {
  const lazy = requireBoolean(config.lazy ?? DEFAULT_CONFIG.lazy, 'lazy');
  const supportedEvents =
    config.supportedEvents === undefined
      ? [...DEFAULT_CONFIG.supportedEvents]
      : requireSupportedEvents(config.supportedEvents);

  return {
    ...config,
    baseUrl: requireNonEmptyString(config.baseUrl ?? DEFAULT_CONFIG.baseUrl, 'baseUrl'),
    defaultBranch: requireNonEmptyString(
      config.defaultBranch ?? DEFAULT_CONFIG.defaultBranch,
      'defaultBranch',
    ),
    fetchFileContents: requireBoolean(
      config.fetchFileContents ?? DEFAULT_CONFIG.fetchFileContents,
      'fetchFileContents',
    ),
    lazy,
    materialization: normalizeMaterializationPolicy(config.materialization, {
      defaultMode: lazy ? 'lazy' : 'eager',
      fieldName: 'materialization',
      preserveUndefined: true,
      resources: GITHUB_MATERIALIZATION_RESOURCES,
      stateValues: GITHUB_MATERIALIZATION_STATES,
      targetKey: 'repos',
      webhookWritesKey: 'webhookWritesForLazyRepos',
    }),
    maxCommits: requirePositiveInteger(
      config.maxCommits ?? DEFAULT_CONFIG.maxCommits,
      'maxCommits',
    ),
    maxFileSizeBytes: requirePositiveInteger(
      config.maxFileSizeBytes ?? DEFAULT_CONFIG.maxFileSizeBytes,
      'maxFileSizeBytes',
    ),
    supportedEvents,
  };
}

function requireSupportedEvents(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error('supportedEvents must be an array of strings');
  }

  return value.map((event, index) =>
    requireNonEmptyString(event, `supportedEvents[${index}]`),
  );
}

function requireNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a string`);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }

  return trimmed;
}

function requireBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${fieldName} must be a boolean`);
  }

  return value;
}

function requirePositiveInteger(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`${fieldName} must be a positive integer`);
  }

  return value;
}

export type { GitHubAdapterConfig } from './types.js';
