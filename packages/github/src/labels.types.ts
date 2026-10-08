export type GitHubLabelAction = 'ensure_repository_label' | 'add_issue_label' | 'remove_issue_label';

/** A resolved label request; the caller owns path policy and authentication. */
export type GitHubLabelRequest = Readonly<{
  action: GitHubLabelAction;
  method: string;
  endpoint: string;
  headers?: Readonly<Record<string, string>>;
  body?: unknown;
}>;

export type GitHubLabelResponse = Readonly<{ ok: boolean; status: number; data: unknown }>;

/** Transport errors propagate. An HTTP success still needs a confirmed response body. */
export type GitHubLabelResult<Response extends GitHubLabelResponse = GitHubLabelResponse> = Readonly<{
  confirmed: boolean;
  request: GitHubLabelRequest;
  response: Response;
  reason?: string;
  externalId?: string;
}>;

export type GitHubLabelCall<Response extends GitHubLabelResponse> = Readonly<{
  request: GitHubLabelRequest;
  proxy: (request: GitHubLabelRequest) => Promise<Response>;
}>;

export type GitHubLabelDefinition = Readonly<{ name: string; color: string; description: string }>;
