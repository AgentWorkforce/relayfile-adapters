import { withProxyRetry } from '@relayfile/adapter-core/http';
import type {
  AgentReview as ProactiveAgentReview,
  ChangeRequestContext,
  ChangeRequestMergeState,
  ClaimCommentReq,
  IntegrationMeta,
  OpenChangeRequestReq,
  PathOrPayload,
  ProactiveReviewAdapter,
  RebaseReq,
  ReviewContext,
  ReviewResult,
  SelfBotIdentity,
  SelfBotKind,
  WriteResult,
} from '@relayfile/adapter-core';

import { GITHUB_API_BASE_URL } from '../config.js';
import { githubIssuePath, githubPullRequestPath, parseGitHubIssuePath, parseGitHubPullPath } from '../path-mapper.js';
import type {
  AgentReview as GitHubAgentReview,
  GitHubRequestProvider,
  JsonObject,
  JsonValue,
  ProxyRequest,
  ProxyResponse,
} from '../types.js';
import { GitHubWritebackHandler } from '../writeback.js';

const DEFAULT_PROVIDER_CONFIG_KEY = 'github-app-oauth';
const REVIEW_SELF_TRIGGER_EVENTS = [
  'pull_request.synchronize',
  'pull_request_review.submitted',
  'pull_request_review_comment.created',
  'issue_comment.created',
] as const;
const AUTOFIX_SELF_TRIGGER_EVENTS = ['pull_request.synchronize'] as const;

interface AdapterOptions {
  defaultConnectionId?: string;
  defaultProviderConfigKey?: string;
  resolveConnectionId?: (integration?: IntegrationMeta) => Promise<string> | string;
}

export class GithubProactiveReviewAdapter implements ProactiveReviewAdapter {
  readonly provider = 'github';
  private readonly writebackHandler: GitHubWritebackHandler;
  private readonly defaultConnectionId?: string;
  private readonly defaultProviderConfigKey: string;
  private readonly resolveConnectionId?: (integration?: IntegrationMeta) => Promise<string> | string;

  constructor(
    private readonly requestProvider: GitHubRequestProvider,
    options: AdapterOptions = {},
  ) {
    this.defaultConnectionId =
      options.defaultConnectionId ??
      firstString(requestProvider.connectionId, requestProvider.defaultConnectionId) ??
      undefined;
    this.defaultProviderConfigKey =
      options.defaultProviderConfigKey ??
      firstString(requestProvider.providerConfigKey, requestProvider.defaultProviderConfigKey) ??
      DEFAULT_PROVIDER_CONFIG_KEY;
    this.resolveConnectionId = options.resolveConnectionId;
    this.writebackHandler = new GitHubWritebackHandler(requestProvider, {
      defaultConnectionId: this.defaultConnectionId,
      defaultProviderConfigKey: this.defaultProviderConfigKey,
    });
  }

  deriveWorkItemKey(input: PathOrPayload): string | null {
    for (const path of inputPaths(input)) {
      const key = keyFromGithubPath(path);
      if (key) return key;
    }

    const payload = inputPayload(input);
    const context = this.classifyChangeRequest(payload);
    if (context) return context.key;

    const record = asRecord(payload);
    const issue = asRecord(record?.issue) ?? asRecord(payload);
    const repoInfo = repoPartsFromPayload(record, issue);
    const number = numberValue(issue?.number);
    if (!repoInfo || number === null) return null;
    return `github:${repoInfo.owner}/${repoInfo.repo}#${number}`;
  }

  classifyChangeRequest(payload: unknown): ChangeRequestContext | null {
    const record = asRecord(payload);
    if (!record) return null;
    const pr = asRecord(record.pull_request) ?? asRecord(payload);
    if (!pr) return null;
    const number = numberValue(pr?.number);
    if (number === null) return null;

    const base = asRecord(pr.base);
    const head = asRecord(pr.head);
    const baseRepo = asRecord(base?.repo);
    const repository = asRecord(record.repository) ?? baseRepo;
    const repoInfo = repoPartsFromPayload(record, pr) ?? repoPartsFromRepository(repository);
    if (!repoInfo) return null;

    return {
      provider: this.provider,
      key: `github-pr:${repoInfo.owner}/${repoInfo.repo}#${number}`,
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      number,
      title: firstString(pr.title) ?? undefined,
      url: firstString(pr.html_url, pr.url) ?? undefined,
      baseRef: firstString(base?.ref) ?? undefined,
      baseSha: firstString(base?.sha) ?? undefined,
      headRef: firstString(head?.ref) ?? undefined,
      headSha: firstString(head?.sha) ?? undefined,
      payload,
    };
  }

  classifyMergeState(detail: unknown): ChangeRequestMergeState {
    const record = asRecord(detail);
    const pr = asRecord(record?.pull_request) ?? record;
    const raw = firstString(pr?.mergeable_state, pr?.mergeableState);
    switch (raw) {
      case 'clean':
      case 'behind':
      case 'has_hooks':
      case 'unstable':
        return 'clean';
      case 'dirty':
        return 'dirty';
      case 'blocked':
      case 'draft':
        return 'blocked';
      case 'unknown':
        return 'unknown';
      default:
        if (pr?.mergeable === false) return 'dirty';
        if (pr?.mergeable === true) return 'clean';
        return 'unknown';
    }
  }

  selfBotIdentity(kind: SelfBotKind, integration?: IntegrationMeta): SelfBotIdentity | null {
    return selfBotIdentityFromIntegration(kind, integration);
  }

  selfTriggerEvents(kind: SelfBotKind): string[] {
    return kind === 'review'
      ? [...REVIEW_SELF_TRIGGER_EVENTS]
      : [...AUTOFIX_SELF_TRIGGER_EVENTS];
  }

  async postClaimComment(req: ClaimCommentReq): Promise<WriteResult> {
    const response = await this.proxy({
      integration: req.integration,
      request: {
        method: 'POST',
        baseUrl: GITHUB_API_BASE_URL,
        endpoint: `/repos/${req.owner}/${req.repo}/issues/${req.workItemNumber}/comments`,
        connectionId: '',
        headers: this.githubJsonHeaders(req.integration),
        body: { body: req.body },
      },
    });
    return writeResultFromProxy(response, 'GitHub issue claim comment failed');
  }

  async openChangeRequest(req: OpenChangeRequestReq): Promise<WriteResult> {
    const body: JsonObject = {
      title: req.title,
      head: req.head,
      base: req.base,
    };
    if (req.body !== undefined) body.body = req.body;
    if (req.draft !== undefined) body.draft = req.draft;
    if (req.maintainerCanModify !== undefined) {
      body.maintainer_can_modify = req.maintainerCanModify;
    }

    const response = await this.proxy({
      integration: req.integration,
      request: {
        method: 'POST',
        baseUrl: GITHUB_API_BASE_URL,
        endpoint: `/repos/${req.owner}/${req.repo}/pulls`,
        connectionId: '',
        headers: this.githubJsonHeaders(req.integration),
        body,
      },
    });
    return writeResultFromProxy(response, 'GitHub pull request creation failed');
  }

  async rebaseChangeRequest(req: RebaseReq): Promise<WriteResult> {
    const body: JsonObject = {};
    if (req.expectedHeadSha !== undefined) {
      body.expected_head_sha = req.expectedHeadSha;
    }
    const response = await this.proxy({
      integration: req.integration,
      request: {
        method: 'PUT',
        baseUrl: GITHUB_API_BASE_URL,
        endpoint: `/repos/${req.owner}/${req.repo}/pulls/${req.number}/update-branch`,
        connectionId: '',
        headers: this.githubJsonHeaders(req.integration),
        body,
      },
    });
    return writeResultFromProxy(response, 'GitHub pull request update branch failed');
  }

  async submitReview(req: ProactiveAgentReview, ctx: ReviewContext): Promise<ReviewResult> {
    try {
      const target = ctx.changeRequest;
      const owner = target?.owner;
      const repo = target?.repo;
      if (!owner || !repo) {
        throw new Error('GitHub review submission requires changeRequest.owner and changeRequest.repo');
      }
      const connectionId = await this.connectionId(ctx.integration);
      const review: GitHubAgentReview = {
        event: req.event,
        body: req.body,
        comments: req.comments.map((comment) => ({
          path: comment.path,
          line: comment.line,
          side: comment.side ?? 'RIGHT',
          body: comment.body,
          ...(comment.suggestion !== undefined ? { suggestion: comment.suggestion } : {}),
        })),
        metadata: {
          connectionId,
          providerConfigKey: this.providerConfigKey(ctx.integration),
          ...commitShaMetadata(ctx.diffRefs),
        },
      };
      const response = await this.writebackHandler.submitReview(
        owner,
        repo,
        target.number,
        review,
        this.requestProvider,
        connectionId,
      );
      if (response.status >= 400) {
        return {
          status: 'failed',
          error: formatProviderError(response, 'GitHub pull request review failed'),
        };
      }
      return {
        status: 'complete',
        providerRef: response.data,
      };
    } catch (error) {
      return {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  scopePaths(): { workItems: string; changeRequests: string } {
    return {
      workItems: '/github/repos/**/issues/**',
      changeRequests: '/github/repos/**/pulls/**',
    };
  }

  private async proxy(input: { integration?: IntegrationMeta; request: ProxyRequest }): Promise<ProxyResponse> {
    return withProxyRetry(this.requestProvider).proxy({
      ...input.request,
      connectionId: await this.connectionId(input.integration),
    });
  }

  private async connectionId(integration?: IntegrationMeta): Promise<string> {
    const explicit = firstString(integration?.connectionId);
    if (explicit) return explicit;
    if (this.resolveConnectionId) {
      const resolved = await this.resolveConnectionId(integration);
      const trimmed = resolved.trim();
      if (trimmed) return trimmed;
    }
    const fromProvider = await maybeProviderConnectionId(this.requestProvider);
    const resolved = firstString(fromProvider, this.defaultConnectionId);
    if (resolved) return resolved;
    throw new Error('Missing GitHub connection id');
  }

  private providerConfigKey(integration?: IntegrationMeta): string {
    return firstString(integration?.providerConfigKey) ?? this.defaultProviderConfigKey;
  }

  private githubJsonHeaders(integration?: IntegrationMeta): Record<string, string> {
    return {
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'Provider-Config-Key': this.providerConfigKey(integration),
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }
}

export { GithubProactiveReviewAdapter as GitHubProactiveReviewAdapter };

export function createGithubProactiveReviewAdapter(
  provider: GitHubRequestProvider,
  options?: AdapterOptions,
): GithubProactiveReviewAdapter {
  return new GithubProactiveReviewAdapter(provider, options);
}

function inputPaths(input: PathOrPayload): string[] {
  if (typeof input === 'string') return [input];
  const paths: string[] = [];
  if (typeof input.path === 'string') paths.push(input.path);
  if (Array.isArray(input.paths)) {
    for (const path of input.paths) {
      if (typeof path === 'string') paths.push(path);
    }
  }
  return paths;
}

function inputPayload(input: PathOrPayload): unknown {
  return typeof input === 'string' ? null : input.payload ?? input;
}

function keyFromGithubPath(path: string): string | null {
  const pull = parseGitHubPullPath(path);
  if (pull) return `github-pr:${pull.owner}/${pull.repo}#${pull.number}`;
  const issue = parseGitHubIssuePath(path);
  if (issue) return `github:${issue.owner}/${issue.repo}#${issue.number}`;
  return null;
}

function repoPartsFromPayload(
  root: Record<string, unknown> | null,
  resource?: Record<string, unknown> | null,
): { owner: string; repo: string } | null {
  return repoPartsFromRepository(asRecord(root?.repository))
    ?? repoPartsFromRepository(asRecord(resource?.repository))
    ?? repoPartsFromRepository(asRecord(asRecord(resource?.base)?.repo));
}

function repoPartsFromRepository(repository?: Record<string, unknown> | null): { owner: string; repo: string } | null {
  const fullName = firstString(repository?.full_name);
  if (fullName) {
    const [owner, repo] = fullName.split('/');
    if (owner && repo) return { owner, repo };
  }
  const ownerRecord = asRecord(repository?.owner);
  const owner = firstString(ownerRecord?.login, repository?.owner);
  const repo = firstString(repository?.name);
  return owner && repo ? { owner, repo } : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return Number.parseInt(value, 10);
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }
  return null;
}

function selfBotIdentityFromIntegration(
  kind: SelfBotKind,
  integration?: IntegrationMeta,
): SelfBotIdentity | null {
  const identities = asRecord(integration?.selfBotIdentities);
  const configured = identities?.[kind];
  const login =
    typeof configured === 'string'
      ? firstString(configured)
      : firstString(asRecord(configured)?.login);
  return login ? { login } : null;
}

async function maybeProviderConnectionId(provider: GitHubRequestProvider): Promise<string | null> {
  const direct = firstString(provider.connectionId, provider.defaultConnectionId);
  if (direct) return direct;
  if (provider.getConnectionId) {
    const resolved = await provider.getConnectionId();
    const trimmed = resolved.trim();
    if (trimmed) return trimmed;
  }
  if (provider.resolveConnectionId) {
    const resolved = await provider.resolveConnectionId();
    const trimmed = resolved.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function commitShaMetadata(diffRefs: unknown): { commitSha?: string } {
  if (typeof diffRefs === 'string' && diffRefs.trim()) {
    return { commitSha: diffRefs.trim() };
  }
  const record = asRecord(diffRefs);
  const sha = firstString(record?.headSha, record?.head_sha, record?.commitSha, record?.commit_sha);
  return sha ? { commitSha: sha } : {};
}

function writeResultFromProxy(response: ProxyResponse, context: string): WriteResult {
  if (response.status >= 400) {
    return {
      success: false,
      error: formatProviderError(response, context),
    };
  }
  return {
    success: true,
    providerRef: response.data,
  };
}

function formatProviderError(response: ProxyResponse, fallback: string): string {
  const data = response.data as JsonValue | undefined;
  const message = asRecord(data)?.message;
  return typeof message === 'string' && message.trim()
    ? `${fallback}: ${message.trim()}`
    : `${fallback}: HTTP ${response.status}`;
}

export const githubProactiveReviewAdapterPathHelpers = {
  issuePath: githubIssuePath,
  pullRequestPath: githubPullRequestPath,
};
