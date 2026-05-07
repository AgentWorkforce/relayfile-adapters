import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { ConnectionProvider, ProxyResponse } from '@relayfile/sdk';
import { JiraAdapter, type RelayFileClientLike, type WriteFileInput } from '../jira-adapter.js';
import { computeJiraPath, jiraIssuePath, jiraProjectPath } from '../path-mapper.js';

interface CapturingClient extends RelayFileClientLike {
  writes: WriteFileInput[];
  deletes: Array<{ workspaceId: string; path: string }>;
}

function createClient(): CapturingClient {
  return {
    writes: [],
    deletes: [],
    async writeFile(input) {
      this.writes.push(input);
      return { created: true };
    },
    async deleteFile(input) {
      this.deletes.push(input);
    },
  };
}

function createAdapter(client = createClient()): JiraAdapter {
  const provider: ConnectionProvider = {
    name: 'jira',
    async proxy<T = unknown>(): Promise<ProxyResponse<T>> {
      return { status: 200, headers: {}, data: {} as T };
    },
    async healthCheck() {
      return true;
    },
  };
  return new JiraAdapter(client, provider, { connectionId: 'conn-jira' });
}

describe('JiraAdapter', () => {
  it('ingests issue webhooks into deterministic issue paths', async () => {
    const client = createClient();
    const adapter = createAdapter(client);

    const result = await adapter.ingestWebhook('workspace-1', {
      provider: 'jira',
      eventType: 'issue.created',
      objectType: 'issue',
      objectId: '10001',
      payload: {
        id: '10001',
        key: 'ENG-42',
        fields: {
          summary: 'Fix login redirect',
          status: { id: '3', name: 'In Progress', statusCategory: { key: 'indeterminate', name: 'In Progress' } },
          project: { id: '10000', key: 'ENG', name: 'Engineering' },
          labels: ['auth', 'web'],
        },
      },
    });

    assert.equal(result.filesWritten, 1);
    assert.equal(client.writes[0]?.path, '/jira/issues/fix-login-redirect--10001.json');
    assert.equal(client.writes[0]?.semantics?.properties?.['jira.summary'], 'Fix login redirect');
    assert.deepEqual(client.writes[0]?.semantics?.relations, [jiraProjectPath('ENG', 'Engineering')]);
  });

  it('ingests project webhooks', async () => {
    const client = createClient();
    const adapter = createAdapter(client);

    const result = await adapter.ingestWebhook('workspace-1', {
      webhookEvent: 'project_created',
      project: {
        id: '10000',
        key: 'ENG',
        name: 'Engineering Platform',
        projectTypeKey: 'software',
      },
    });

    assert.equal(result.filesWritten, 1);
    assert.equal(client.writes[0]?.path, '/jira/projects/engineering-platform--10000.json');
    assert.equal(client.writes[0]?.semantics?.properties?.['jira.project_key'], 'ENG');
  });

  it('ingests sprint webhooks', async () => {
    const client = createClient();
    const adapter = createAdapter(client);

    const result = await adapter.ingestWebhook('workspace-1', {
      webhookEvent: 'sprint_created',
      sprint: {
        id: 77,
        name: 'Sprint 77',
        state: 'active',
        originBoardId: 12,
      },
    });

    assert.equal(result.filesWritten, 1);
    assert.equal(client.writes[0]?.path, '/jira/sprints/sprint-77--77.json');
    assert.equal(client.writes[0]?.semantics?.properties?.['jira.state'], 'active');
  });

  it('ingests comment webhooks and links to the parent issue', async () => {
    const client = createClient();
    const adapter = createAdapter(client);

    const result = await adapter.ingestWebhook('workspace-1', {
      webhookEvent: 'comment_created',
      comment: {
        id: '9001',
        body: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Looks good.' }] }],
        },
      },
      issue: {
        id: '10001',
        key: 'ENG-42',
        fields: { summary: 'Fix login redirect' },
      },
    });

    assert.equal(result.filesWritten, 1);
    assert.equal(client.writes[0]?.path, '/jira/comments/9001.json');
    assert.equal(client.writes[0]?.semantics?.comments?.[0], 'Looks good.');
    assert.deepEqual(client.writes[0]?.semantics?.relations, [jiraIssuePath('ENG-42', 'Fix login redirect')]);
  });

  it('extracts issue semantics from nested Jira fields', () => {
    const adapter = createAdapter();

    const semantics = adapter.computeSemantics('issue', '10001', {
      id: '10001',
      key: 'ENG-42',
      fields: {
        summary: 'Fix login redirect',
        assignee: { accountId: 'acct-1', displayName: 'Ada Lovelace', emailAddress: 'ada@example.com' },
        priority: { id: '2', name: 'High' },
        status: { id: '3', name: 'In Progress', statusCategory: { key: 'indeterminate', name: 'In Progress' } },
        labels: ['web', 'auth'],
      },
    });

    assert.equal(semantics.properties?.['jira.assignee_display_name'], 'Ada Lovelace');
    assert.equal(semantics.properties?.['jira.priority_name'], 'High');
    assert.equal(semantics.properties?.['jira.status_category_key'], 'indeterminate');
    assert.equal(semantics.properties?.['jira.labels'], 'auth, web');
  });

  it('computes deterministic path mappings for all primary object types', () => {
    assert.equal(computeJiraPath('issue', 'ENG-42', 'Fix login redirect'), '/jira/issues/fix-login-redirect--ENG42.json');
    assert.equal(computeJiraPath('project', 'ENG', 'Engineering Platform'), '/jira/projects/engineering-platform--ENG.json');
    assert.equal(computeJiraPath('sprint', '77', 'Sprint 77'), '/jira/sprints/sprint-77--77.json');
    assert.equal(computeJiraPath('comment', '9001'), '/jira/comments/9001.json');
  });

  it('deletes files for deleted events when deleteFile is available', async () => {
    const client = createClient();
    const adapter = createAdapter(client);

    const result = await adapter.ingestWebhook('workspace-1', {
      provider: 'jira',
      eventType: 'issue.deleted',
      objectType: 'issue',
      objectId: '10001',
      payload: {
        id: '10001',
        key: 'ENG-42',
        fields: { summary: 'Fix login redirect' },
      },
    });

    assert.equal(result.filesDeleted, 1);
    assert.equal(client.deletes[0]?.path, '/jira/issues/fix-login-redirect--10001.json');
  });
});
