export interface BitbucketNormalizedWebhook {
  eventType: string;
  model: 'BitbucketRepository' | 'BitbucketPullRequest' | 'BitbucketIssue' | 'BitbucketPipeline' | 'BitbucketCommit' | null;
  record: Record<string, unknown> | null;
  deleted: boolean;
  followUpSyncs: readonly string[];
}

export const BITBUCKET_SUPPORTED_EVENTS = [
  'repo:push', 'repo:updated', 'repo:deleted',
  'pullrequest:created', 'pullrequest:updated', 'pullrequest:fulfilled', 'pullrequest:rejected',
  'pullrequest:comment_created', 'pullrequest:comment_deleted',
  'issue:created', 'issue:updated', 'issue:comment_created',
  'repo:commit_status_created', 'repo:commit_status_updated',
] as const;

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function string(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function normalizeBitbucketWebhook(payload: unknown, eventType: string): BitbucketNormalizedWebhook | null {
  const body = object(payload);
  if (!body || !eventType) return null;
  const repository = object(body.repository);
  const fullName = string(repository?.full_name);
  const workspace = string(object(repository?.workspace)?.slug) ?? fullName?.split('/')[0] ?? null;
  if (!fullName || !workspace) return null;

  if (eventType.startsWith('pullrequest:')) {
    const pr = object(body.pullrequest);
    const number = pr?.id;
    if (!pr || (typeof number !== 'number' && typeof number !== 'string')) return null;
    return {
      eventType, model: 'BitbucketPullRequest', deleted: false,
      record: { ...pr, id: `${fullName}:${number}`, pullrequest_id: number, repository: fullName, workspace },
      followUpSyncs: eventType.includes('comment') ? ['fetch-pull-requests'] : [],
    };
  }
  if (eventType.startsWith('issue:')) {
    const issue = object(body.issue);
    const number = issue?.id;
    if (!issue || (typeof number !== 'number' && typeof number !== 'string')) return null;
    return {
      eventType, model: 'BitbucketIssue', deleted: eventType === 'issue:deleted',
      record: { ...issue, id: `${fullName}:${number}`, issue_id: number, repository: fullName, workspace,
        ...(eventType === 'issue:deleted' ? { _nango_metadata: { last_action: 'deleted' } } : {}) },
      followUpSyncs: eventType.includes('comment') ? ['fetch-issues'] : [],
    };
  }
  if (eventType === 'repo:deleted' || eventType === 'repo:updated') {
    return {
      eventType, model: 'BitbucketRepository', deleted: eventType === 'repo:deleted',
      record: { ...repository, id: repository?.uuid, ...(eventType === 'repo:deleted' ? { _nango_metadata: { last_action: 'deleted' } } : {}) },
      followUpSyncs: [],
    };
  }
  if (eventType === 'repo:push') {
    return { eventType, model: null, record: null, deleted: false, followUpSyncs: ['fetch-commits', 'fetch-tags'] };
  }
  if (eventType.startsWith('repo:commit_status_')) {
    return { eventType, model: null, record: null, deleted: false, followUpSyncs: ['fetch-pipelines'] };
  }
  return null;
}
