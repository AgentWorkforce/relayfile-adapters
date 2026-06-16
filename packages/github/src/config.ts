export const GITHUB_API_BASE_URL = "https://api.github.com";
import type {
  GitHubAdapterConfig,
  GitHubMaterializationFilter,
  GitHubMaterializationMode,
  GitHubMaterializationPolicy,
  GitHubMaterializationResource,
  GitHubMaterializationRule,
  GitHubResourceMaterializationPolicy,
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
  'deployment_status.created', // a deployment's status changed — `deployment_status.state` is success / failure / error / pending / in_progress / … (powers deploy-watch agents)
] as const;

export const DEFAULT_CONFIG: GitHubAdapterConfig = {
  baseUrl: 'https://api.github.com',
  defaultBranch: 'main',
  fetchFileContents: true,
  lazy: false,
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
    materialization: requireMaterializationPolicy(config.materialization, lazy),
    maxFileSizeBytes: requirePositiveInteger(
      config.maxFileSizeBytes ?? DEFAULT_CONFIG.maxFileSizeBytes,
      'maxFileSizeBytes',
    ),
    supportedEvents,
  };
}

function requireMaterializationPolicy(value: unknown, lazy: boolean): GitHubMaterializationPolicy {
  if (value === undefined) {
    return {
      default: lazy ? 'lazy' : 'eager',
      webhookWritesForLazyRepos: true,
    };
  }

  const policy = requirePlainObject(value, 'materialization');
  return {
    default: requireMaterializationMode(policy.default ?? (lazy ? 'lazy' : 'eager'), 'materialization.default'),
    webhookWritesForLazyRepos: requireBoolean(
      policy.webhookWritesForLazyRepos ?? true,
      'materialization.webhookWritesForLazyRepos',
    ),
    rules: policy.rules === undefined ? undefined : requireMaterializationRules(policy.rules),
  };
}

function requireMaterializationRules(value: unknown): GitHubMaterializationRule[] {
  if (!Array.isArray(value)) {
    throw new Error('materialization.rules must be an array');
  }

  return value.map((rule, index) => requireMaterializationRule(rule, `materialization.rules[${index}]`));
}

function requireMaterializationRule(value: unknown, fieldName: string): GitHubMaterializationRule {
  const rule = requirePlainObject(value, fieldName);
  return {
    repos: rule.repos === undefined ? undefined : requireStringArray(rule.repos, `${fieldName}.repos`),
    resources: rule.resources === undefined ? undefined : requireMaterializationResources(rule.resources, `${fieldName}.resources`),
    filter: rule.filter === undefined ? undefined : requireMaterializationFilter(rule.filter, `${fieldName}.filter`),
    since: rule.since === undefined ? undefined : requireNonEmptyString(rule.since, `${fieldName}.since`),
    incremental: rule.incremental === undefined ? undefined : requireBoolean(rule.incremental, `${fieldName}.incremental`),
    eager: rule.eager === undefined ? undefined : requireBoolean(rule.eager, `${fieldName}.eager`),
    issues: rule.issues === undefined ? undefined : requireResourceMaterializationPolicy(rule.issues, `${fieldName}.issues`),
    pulls: rule.pulls === undefined ? undefined : requireResourceMaterializationPolicy(rule.pulls, `${fieldName}.pulls`),
  };
}

function requireResourceMaterializationPolicy(
  value: unknown,
  fieldName: string,
): GitHubMaterializationMode | GitHubResourceMaterializationPolicy {
  if (typeof value === 'string') {
    return requireMaterializationMode(value, fieldName);
  }

  const policy = requirePlainObject(value, fieldName);
  return {
    mode: policy.mode === undefined ? undefined : requireMaterializationMode(policy.mode, `${fieldName}.mode`),
    filter: policy.filter === undefined ? undefined : requireMaterializationFilter(policy.filter, `${fieldName}.filter`),
    since: policy.since === undefined ? undefined : requireNonEmptyString(policy.since, `${fieldName}.since`),
    incremental: policy.incremental === undefined ? undefined : requireBoolean(policy.incremental, `${fieldName}.incremental`),
  };
}

function requireMaterializationFilter(value: unknown, fieldName: string): GitHubMaterializationFilter {
  const filter = requirePlainObject(value, fieldName);
  return {
    state: filter.state === undefined ? undefined : requireState(filter.state, `${fieldName}.state`),
    labels: filter.labels === undefined ? undefined : requireStringArray(filter.labels, `${fieldName}.labels`),
    since: filter.since === undefined ? undefined : requireNonEmptyString(filter.since, `${fieldName}.since`),
  };
}

function requireMaterializationResources(value: unknown, fieldName: string): GitHubMaterializationResource[] {
  const allowed = new Set<GitHubMaterializationResource>(['issues', 'pulls']);

  return requireStringArray(value, fieldName).map((resource, index) => {
    if (!allowed.has(resource as GitHubMaterializationResource)) {
      throw new Error(`${fieldName}[${index}] must be "issues" or "pulls"`);
    }
    return resource as GitHubMaterializationResource;
  });
}

function requireMaterializationMode(value: unknown, fieldName: string): GitHubMaterializationMode {
  const mode = requireNonEmptyString(value, fieldName);
  if (mode === 'lazy' || mode === 'none') {
    return 'lazy';
  }
  if (mode === 'eager' || mode === 'all') {
    return 'eager';
  }
  throw new Error(`${fieldName} must be "lazy" or "eager"`);
}

function requireState(value: unknown, fieldName: string): 'open' | 'closed' | 'all' {
  const state = requireNonEmptyString(value, fieldName);
  if (state !== 'open' && state !== 'closed' && state !== 'all') {
    throw new Error(`${fieldName} must be "open", "closed", or "all"`);
  }
  return state;
}

function requireStringArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array of strings`);
  }

  return value.map((item, index) => requireNonEmptyString(item, `${fieldName}[${index}]`));
}

function requirePlainObject(value: unknown, fieldName: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${fieldName} must be an object`);
  }

  return value as Record<string, unknown>;
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
