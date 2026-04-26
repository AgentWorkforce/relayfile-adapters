import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LINEAR_FETCH_ACTIVE_ISSUES_QUERY,
  LINEAR_ISSUE_FIELDS,
  LINEAR_LIST_ISSUES_QUERY,
  buildLinearIssueFilter,
  buildLinearProjectFilter,
  type LinearGraphqlResponse,
} from './index.js';

const TEAM_ID = '11111111-1111-1111-1111-111111111111';

function compactGraphql(query: string): string {
  return query.replace(/\s+/gu, '');
}

test('LINEAR_LIST_ISSUES_QUERY matches the expected GraphQL document', () => {
  assert.equal(
    compactGraphql(LINEAR_LIST_ISSUES_QUERY),
    compactGraphql(
      `
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
        hasNextPage
        endCursor
      }
    }
  }
`,
    ),
  );

  assert.match(LINEAR_LIST_ISSUES_QUERY, /issues\(first:/u);
  assert.match(LINEAR_LIST_ISSUES_QUERY, /filter:/u);
  assert.notEqual(
    compactGraphql(LINEAR_LIST_ISSUES_QUERY).indexOf(compactGraphql(LINEAR_ISSUE_FIELDS)),
    -1,
  );
});

test('LINEAR_FETCH_ACTIVE_ISSUES_QUERY matches the expected Sage active-issues query', () => {
  assert.equal(
    compactGraphql(LINEAR_FETCH_ACTIVE_ISSUES_QUERY),
    compactGraphql(
      `
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
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`,
    ),
  );

  assert.notEqual(
    compactGraphql(LINEAR_FETCH_ACTIVE_ISSUES_QUERY).indexOf(
      'state:{type:{nin:["canceled","done"]}}',
    ),
    -1,
  );
});

test('buildLinearIssueFilter returns undefined for empty input', () => {
  assert.equal(buildLinearIssueFilter({}), undefined);
});

test('buildLinearIssueFilter maps state-only input', () => {
  assert.deepEqual(buildLinearIssueFilter({ state: ['Todo'] }), {
    state: { name: { in: ['Todo'] } },
  });
});

test('buildLinearIssueFilter combines state and label filters', () => {
  assert.deepEqual(
    buildLinearIssueFilter({ state: ['Todo', 'In Progress'], labels: ['bug'] }),
    {
      state: { name: { in: ['Todo', 'In Progress'] } },
      labels: { some: { name: { in: ['bug'] } } },
    },
  );
});

test('buildLinearIssueFilter maps assignee email and id forms', () => {
  assert.deepEqual(buildLinearIssueFilter({ assignee: 'alice@example.com' }), {
    assignee: { email: { eq: 'alice@example.com' } },
  });
  assert.deepEqual(buildLinearIssueFilter({ assignee: 'uuid-1234' }), {
    assignee: { id: { eq: 'uuid-1234' } },
  });
});

test('buildLinearIssueFilter maps team key, id, and name forms', () => {
  assert.deepEqual(buildLinearIssueFilter({ team: 'ENG' }), {
    team: { key: { eq: 'ENG' } },
  });
  assert.deepEqual(buildLinearIssueFilter({ team: TEAM_ID }), {
    team: { id: { eq: TEAM_ID } },
  });
  assert.deepEqual(buildLinearIssueFilter({ team: 'Core Platform' }), {
    team: { name: { containsIgnoreCase: 'Core Platform' } },
  });
});

test('buildLinearProjectFilter returns undefined for empty input', () => {
  assert.equal(buildLinearProjectFilter({}), undefined);
});

test('buildLinearProjectFilter maps team key, id, and name forms', () => {
  assert.deepEqual(buildLinearProjectFilter({ team: 'ENG' }), {
    teams: { some: { key: { eq: 'ENG' } } },
  });
  assert.deepEqual(buildLinearProjectFilter({ team: TEAM_ID }), {
    teams: { some: { id: { eq: TEAM_ID } } },
  });
  assert.deepEqual(buildLinearProjectFilter({ team: 'Core Platform' }), {
    teams: { some: { name: { containsIgnoreCase: 'Core Platform' } } },
  });
});

test('LinearGraphqlResponse remains usable as a typed contract', () => {
  const response: LinearGraphqlResponse<{
    issues: {
      nodes: Array<{ id: string }>;
    };
  }> = {
    data: {
      issues: {
        nodes: [{ id: 'ENG-123' }],
      },
    },
    errors: [{ message: 'boom', path: ['issues'] }],
  };

  assert.equal(response.data?.issues.nodes[0]?.id, 'ENG-123');
  assert.equal(response.errors?.[0]?.path?.[0], 'issues');
});
