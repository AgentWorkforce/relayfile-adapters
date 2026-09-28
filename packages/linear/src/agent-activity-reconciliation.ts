import type {
  LinearAgentActivity,
  LinearAgentActivityType,
  LinearWritebackRequest,
} from './types.js';

export interface LinearAgentActivityProxyResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly data: unknown;
}

export interface LinearAgentActivityReconciliationResult {
  readonly found: boolean;
  readonly externalId?: string;
  readonly status: number;
}

export type LinearAgentActivityRequestExecutor = (
  request: LinearWritebackRequest,
) => Promise<LinearAgentActivityProxyResponse>;

const AGENT_SESSION_ACTIVITIES_QUERY = `
  query RelayfileAgentSessionActivities($sessionId: String!, $after: String) {
    agentSession(id: $sessionId) {
      activities(first: 50, after: $after) {
        nodes {
          id
          content {
            __typename
            ... on AgentActivityThoughtContent { body }
            ... on AgentActivityElicitationContent { body }
            ... on AgentActivityActionContent { action parameter result }
            ... on AgentActivityResponseContent { body }
            ... on AgentActivityErrorContent { body }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function contentMatches(value: unknown, expected: LinearAgentActivity): boolean {
  const content = record(value);
  if (!content) return false;
  const typeByTypename: Record<string, LinearAgentActivityType> = {
    AgentActivityThoughtContent: 'thought',
    AgentActivityElicitationContent: 'elicitation',
    AgentActivityActionContent: 'action',
    AgentActivityResponseContent: 'response',
    AgentActivityErrorContent: 'error',
  };
  const type = typeof content.__typename === 'string'
    ? typeByTypename[content.__typename]
    : undefined;
  return type === expected.type &&
    optionalString(content.body) === expected.body &&
    optionalString(content.action) === expected.action &&
    optionalString(content.parameter) === expected.parameter &&
    optionalString(content.result) === expected.result;
}

function graphqlError(data: unknown): string | undefined {
  const envelope = record(data);
  if (!Array.isArray(envelope?.errors) || envelope.errors.length === 0) {
    return undefined;
  }
  return envelope.errors
    .map((entry) => optionalString(record(entry)?.message))
    .filter((message): message is string => Boolean(message))
    .join('; ') || 'Linear GraphQL request failed';
}

function request(sessionId: string, after: string | null): LinearWritebackRequest {
  return {
    action: 'list_agent_activities',
    method: 'POST',
    endpoint: '/graphql',
    body: {
      query: AGENT_SESSION_ACTIVITIES_QUERY,
      variables: { sessionId, after },
    },
  };
}

/**
 * Reconcile an ambiguously completed AgentActivity create against Linear's
 * frozen session history. The adapter owns the GraphQL contract, pagination,
 * cursor validation, and provider response parsing; callers only supply their
 * authenticated request executor.
 */
export async function reconcileLinearAgentActivity(input: {
  readonly sessionId: string;
  readonly activity: LinearAgentActivity;
  readonly execute: LinearAgentActivityRequestExecutor;
}): Promise<LinearAgentActivityReconciliationResult> {
  let after: string | null = null;
  const seenCursors = new Set<string>();
  for (;;) {
    const response = await input.execute(request(input.sessionId, after));
    const providerError = graphqlError(response.data);
    if (!response.ok || providerError) {
      throw new Error(
        providerError ??
          `Linear activity reconciliation failed with status ${response.status}`,
      );
    }
    const data = record(record(response.data)?.data);
    const session = record(data?.agentSession);
    const activities = record(session?.activities);
    const nodes = Array.isArray(activities?.nodes) ? activities.nodes : [];
    for (const nodeValue of nodes) {
      const node = record(nodeValue);
      if (node && contentMatches(node.content, input.activity)) {
        const externalId = optionalString(node.id);
        return {
          found: true,
          ...(externalId ? { externalId } : {}),
          status: response.status,
        };
      }
    }
    const pageInfo = record(activities?.pageInfo);
    if (pageInfo?.hasNextPage !== true) {
      return { found: false, status: response.status };
    }
    const endCursor = optionalString(pageInfo.endCursor);
    if (!endCursor || seenCursors.has(endCursor)) {
      throw new Error('Linear activity reconciliation returned an invalid cursor');
    }
    seenCursors.add(endCursor);
    after = endCursor;
  }
}
