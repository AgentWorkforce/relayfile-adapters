import type { GitHubAdapterConfig } from './types.js';

const DEFAULT_SUPPORTED_EVENTS = [
  'pull_request.opened',
  'pull_request.synchronize',
  'pull_request.closed',
  'pull_request_review.submitted',
  'pull_request_review_comment.created',
  'issues.opened',
  'issues.closed',
  'check_run.completed',
] as const;

export const DEFAULT_CONFIG: GitHubAdapterConfig = {
  baseUrl: 'https://api.github.com',
  defaultBranch: 'main',
  fetchFileContents: true,
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
