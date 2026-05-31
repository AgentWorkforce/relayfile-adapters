export type ProviderKind = string;

export type PathOrPayload =
  | string
  | {
      path?: string;
      paths?: readonly string[];
      payload?: unknown;
      [key: string]: unknown;
    };

export type ChangeRequestMergeState = "clean" | "dirty" | "unknown" | "blocked";

export interface IntegrationMeta {
  connectionId?: string;
  providerConfigKey?: string;
  sourceName?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ChangeRequestContext {
  provider: ProviderKind;
  key: string;
  owner?: string;
  repo?: string;
  number: number;
  title?: string;
  url?: string;
  baseRef?: string;
  baseSha?: string;
  headRef?: string;
  headSha?: string;
  payload?: unknown;
}

export interface InlineComment {
  path: string;
  line: number;
  side?: "LEFT" | "RIGHT";
  body: string;
  suggestion?: string;
}

export interface AgentReview {
  event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
  body: string;
  comments: InlineComment[];
}

export interface ReviewContext {
  changeRequest?: ChangeRequestContext;
  diffRefs?: unknown;
  integration?: IntegrationMeta;
}

export interface WriteResult {
  success: boolean;
  providerRef?: unknown;
  error?: string;
}

export interface ReviewResult {
  status: "complete" | "partial" | "failed";
  providerRef?: unknown;
  error?: string;
}

export interface ClaimCommentReq {
  owner: string;
  repo: string;
  workItemNumber: number;
  body: string;
  integration?: IntegrationMeta;
}

export interface OpenChangeRequestReq {
  owner: string;
  repo: string;
  title: string;
  head: string;
  base: string;
  body?: string;
  draft?: boolean;
  maintainerCanModify?: boolean;
  integration?: IntegrationMeta;
}

export interface RebaseReq {
  owner: string;
  repo: string;
  number: number;
  expectedHeadSha?: string;
  integration?: IntegrationMeta;
}

export interface ProactiveReviewAdapter {
  readonly provider: ProviderKind;
  deriveWorkItemKey(input: PathOrPayload): string | null;
  classifyChangeRequest(payload: unknown): ChangeRequestContext | null;
  classifyMergeState(detail: unknown): ChangeRequestMergeState;
  selfBotIdentity(
    kind: "review" | "autofix",
    integration: IntegrationMeta,
  ): { login: string } | null;
  selfTriggerEvents(kind: "review" | "autofix"): string[];
  postClaimComment(req: ClaimCommentReq): Promise<WriteResult>;
  openChangeRequest(req: OpenChangeRequestReq): Promise<WriteResult>;
  rebaseChangeRequest(req: RebaseReq): Promise<WriteResult>;
  submitReview(req: AgentReview, ctx: ReviewContext): Promise<ReviewResult>;
  scopePaths(): { workItems: string; changeRequests: string };
}
