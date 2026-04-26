const LINEAR_PAGE_INFO_FIELDS = `
        hasNextPage
        endCursor
`;

const LINEAR_MILESTONE_FIELDS = `
        id
        name
        progress
        description
        status
        targetDate
        project {
          id
          name
        }
        createdAt
        updatedAt
`;

const LINEAR_ROADMAP_FIELDS = `
        id
        name
        description
        updatedAt
        createdAt
        archivedAt
        color
        slugId
        sortOrder
        url
        creator {
          id
        }
        owner {
          id
        }
        projects(first: 25) {
          nodes {
            id
            teams(first: 10) {
              nodes {
                id
              }
            }
          }
        }
`;

const LINEAR_ACTIVE_ISSUE_FIELDS = `
        id
        identifier
        title
        description
        state {
          name
          type
        }
        priority
        assignee {
          name
        }
        url
        createdAt
        updatedAt
`;

const UPPERCASE_TEAM_KEY_PATTERN = /^[A-Z]+$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export const LINEAR_ISSUE_FIELDS = `
        id
        identifier
        title
        description
        url
        priority
        estimate
        dueDate
        createdAt
        updatedAt
        state {
          id
          name
          type
          color
        }
        assignee {
          id
          name
          displayName
          email
          avatarUrl
          url
        }
        creator {
          id
          name
          displayName
          email
          avatarUrl
          url
        }
        team {
          id
          key
          name
        }
        project {
          id
          name
          state
          url
        }
        cycle {
          id
          number
          name
        }
        labels(first: 20) {
          nodes {
            id
            name
            color
          }
        }
`;

export const LINEAR_PROJECT_FIELDS = `
        id
        name
        description
        state
        progress
        startDate
        targetDate
        url
        createdAt
        updatedAt
        lead {
          id
          name
          email
        }
        status {
          id
          name
          type
          color
        }
        teams(first: 20) {
          nodes {
            id
            key
            name
          }
        }
`;

export const LINEAR_COMMENT_FIELDS = `
        id
        body
        url
        issue {
          id
          identifier
          title
          url
        }
        user {
          id
          name
          displayName
          email
        }
        createdAt
        updatedAt
`;

export const LINEAR_TEAM_FIELDS = `
        id
        name
        key
        description
        color
        icon
        private
        createdAt
        updatedAt
        archivedAt
`;

export const LINEAR_USER_FIELDS = `
        id
        name
        displayName
        email
        admin
        active
        avatarUrl
        createdAt
        updatedAt
`;

export const LINEAR_LIST_ISSUES_QUERY = `
  query ListIssues(
    $first: Int
    $after: String
    $filter: IssueFilter
    $orderBy: PaginationOrderBy
  ) {
    issues(first: $first, after: $after, filter: $filter, orderBy: $orderBy) {
      nodes {
${LINEAR_ISSUE_FIELDS}
      }
      pageInfo {
${LINEAR_PAGE_INFO_FIELDS}
      }
    }
  }
`;

export const LINEAR_SEARCH_ISSUES_QUERY = `
  query SearchIssues($term: String!, $first: Int) {
    searchIssues(term: $term, first: $first) {
      nodes {
${LINEAR_ISSUE_FIELDS}
      }
      pageInfo {
${LINEAR_PAGE_INFO_FIELDS}
      }
    }
  }
`;

export const LINEAR_GET_ISSUE_QUERY = `
  query GetIssue($id: String!) {
    issue(id: $id) {
${LINEAR_ISSUE_FIELDS}
    }
  }
`;

export const LINEAR_LIST_PROJECTS_QUERY = `
  query ListProjects(
    $first: Int
    $after: String
    $filter: ProjectFilter
    $orderBy: PaginationOrderBy
  ) {
    projects(first: $first, after: $after, filter: $filter, orderBy: $orderBy) {
      nodes {
${LINEAR_PROJECT_FIELDS}
      }
      pageInfo {
${LINEAR_PAGE_INFO_FIELDS}
      }
    }
  }
`;

export const LINEAR_LIST_COMMENTS_QUERY = `
  query ListComments($id: String!, $first: Int, $after: String) {
    issue(id: $id) {
      comments(first: $first, after: $after) {
        nodes {
${LINEAR_COMMENT_FIELDS}
        }
        pageInfo {
${LINEAR_PAGE_INFO_FIELDS}
        }
      }
    }
  }
`;

export const LINEAR_LIST_TEAMS_QUERY = `
  query ListTeams(
    $first: Int
    $after: String
    $filter: TeamFilter
    $orderBy: PaginationOrderBy
  ) {
    teams(first: $first, after: $after, filter: $filter, orderBy: $orderBy) {
      nodes {
${LINEAR_TEAM_FIELDS}
      }
      pageInfo {
${LINEAR_PAGE_INFO_FIELDS}
      }
    }
  }
`;

export const LINEAR_LIST_USERS_QUERY = `
  query ListUsers(
    $first: Int
    $after: String
    $filter: UserFilter
    $orderBy: PaginationOrderBy
  ) {
    users(first: $first, after: $after, filter: $filter, orderBy: $orderBy) {
      nodes {
${LINEAR_USER_FIELDS}
      }
      pageInfo {
${LINEAR_PAGE_INFO_FIELDS}
      }
    }
  }
`;

export const LINEAR_LIST_MILESTONES_QUERY = `
  query ListMilestones(
    $first: Int
    $after: String
    $filter: ProjectMilestoneFilter
    $orderBy: PaginationOrderBy
  ) {
    projectMilestones(first: $first, after: $after, filter: $filter, orderBy: $orderBy) {
      nodes {
${LINEAR_MILESTONE_FIELDS}
      }
      pageInfo {
${LINEAR_PAGE_INFO_FIELDS}
      }
    }
  }
`;

export const LINEAR_LIST_ROADMAPS_QUERY = `
  query ListRoadmaps($first: Int, $after: String, $orderBy: PaginationOrderBy) {
    roadmaps(first: $first, after: $after, orderBy: $orderBy) {
      nodes {
${LINEAR_ROADMAP_FIELDS}
      }
      pageInfo {
${LINEAR_PAGE_INFO_FIELDS}
      }
    }
  }
`;

export const LINEAR_FETCH_ACTIVE_ISSUES_QUERY = `
  query FetchActiveIssues($after: String, $updatedAfter: DateTimeOrDuration!) {
    issues(
      filter: {
        state: { type: { nin: ["canceled", "done"] } }
        updatedAt: { gt: $updatedAfter }
      }
      first: 100
      after: $after
      orderBy: updatedAt
    ) {
      nodes {
${LINEAR_ACTIVE_ISSUE_FIELDS}
      }
      pageInfo {
${LINEAR_PAGE_INFO_FIELDS}
      }
    }
  }
`;

export interface LinearPageInfo {
  hasNextPage?: boolean;
  endCursor?: string | null;
}

export interface LinearConnection<TNode> {
  nodes?: TNode[];
  pageInfo?: LinearPageInfo;
}

export interface LinearIssueStateNode {
  id?: string | null;
  name?: string | null;
  type?: string | null;
  color?: string | null;
}

export interface LinearUserReferenceNode {
  id?: string | null;
  name?: string | null;
  displayName?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
  url?: string | null;
}

export interface LinearTeamReferenceNode {
  id?: string | null;
  key?: string | null;
  name?: string | null;
}

export interface LinearProjectReferenceNode {
  id?: string | null;
  name?: string | null;
  state?: string | null;
  url?: string | null;
}

export interface LinearCycleReferenceNode {
  id?: string | null;
  number?: number | null;
  name?: string | null;
}

export interface LinearLabelReferenceNode {
  id?: string | null;
  name?: string | null;
  color?: string | null;
}

export interface LinearIssueFilterInput {
  state?: string[];
  labels?: string[];
  assignee?: string;
  team?: string;
  project?: string;
  updatedAfter?: string;
}

export interface LinearIssueNode {
  id: string;
  identifier?: string | null;
  title?: string | null;
  description?: string | null;
  state?: LinearIssueStateNode | null;
  priority?: number | null;
  estimate?: number | null;
  dueDate?: string | null;
  assignee?: LinearUserReferenceNode | null;
  creator?: LinearUserReferenceNode | null;
  team?: LinearTeamReferenceNode | null;
  project?: LinearProjectReferenceNode | null;
  cycle?: LinearCycleReferenceNode | null;
  labels?: { nodes?: Array<LinearLabelReferenceNode> } | null;
  url?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface LinearProjectNode {
  id: string;
  name?: string | null;
  description?: string | null;
  state?: string | null;
  progress?: number | null;
  startDate?: string | null;
  targetDate?: string | null;
  lead?: { id?: string | null; name?: string | null; email?: string | null } | null;
  status?: { id?: string | null; name?: string | null; type?: string | null; color?: string | null } | null;
  teams?: { nodes?: Array<{ id?: string | null; key?: string | null; name?: string | null }> } | null;
  url?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface LinearCommentNode {
  id: string;
  body?: string | null;
  issue?: { id?: string | null; identifier?: string | null; title?: string | null; url?: string | null } | null;
  user?: { id?: string | null; name?: string | null; email?: string | null; displayName?: string | null } | null;
  url?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface LinearGraphqlResponse<T> {
  data?: T;
  errors?: Array<{ message?: string; path?: string[] }>;
}

function normalizeString(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeStringArray(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map((value) => normalizeString(value))
    .filter((value): value is string => value !== undefined);
}

function isUppercaseTeamKey(value: string): boolean {
  return UPPERCASE_TEAM_KEY_PATTERN.test(value);
}

export function buildLinearIssueFilter(input: LinearIssueFilterInput): Record<string, unknown> | undefined {
  const filter: Record<string, unknown> = {};

  const states = normalizeStringArray(input.state);
  if (states.length > 0) {
    filter.state = { name: { in: states } };
  }

  const labels = normalizeStringArray(input.labels);
  if (labels.length > 0) {
    filter.labels = { some: { name: { in: labels } } };
  }

  const assignee = normalizeString(input.assignee);
  if (assignee) {
    filter.assignee = assignee.includes('@')
      ? { email: { eq: assignee } }
      : { id: { eq: assignee } };
  }

  const team = normalizeString(input.team);
  if (team) {
    filter.team = isUppercaseTeamKey(team)
      ? { key: { eq: team } }
      : UUID_PATTERN.test(team)
        ? { id: { eq: team } }
        : { name: { containsIgnoreCase: team } };
  }

  const project = normalizeString(input.project);
  if (project) {
    filter.project = { name: { containsIgnoreCase: project } };
  }

  const updatedAfter = normalizeString(input.updatedAfter);
  if (updatedAfter) {
    filter.updatedAt = { gte: updatedAfter };
  }

  return Object.keys(filter).length > 0 ? filter : undefined;
}

export function buildLinearProjectFilter(
  input: { team?: string; updatedAfter?: string }
): Record<string, unknown> | undefined {
  const filter: Record<string, unknown> = {};

  const team = normalizeString(input.team);
  if (team) {
    filter.teams = {
      some: isUppercaseTeamKey(team)
        ? { key: { eq: team } }
        : UUID_PATTERN.test(team)
          ? { id: { eq: team } }
          : { name: { containsIgnoreCase: team } }
    };
  }

  const updatedAfter = normalizeString(input.updatedAfter);
  if (updatedAfter) {
    filter.updatedAt = { gte: updatedAfter };
  }

  return Object.keys(filter).length > 0 ? filter : undefined;
}
