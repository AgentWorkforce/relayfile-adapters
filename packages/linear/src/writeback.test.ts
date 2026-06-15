import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ReadOnlyFieldError, resolveDeleteRequest, resolveWritebackRequest } from './writeback.js';

const PAGE_UUID = '2fd6800c-1c90-80ea-9ec8-fe4a0daa66b8';
const PAGE_HEX = PAGE_UUID.replace(/-/g, '');

describe('linear writeback', () => {
  describe('comment create', () => {
    it('creates a comment from plain-text content on a slug-form path', () => {
      const req = resolveWritebackRequest(
        `/linear/issues/auth-refactor--${PAGE_HEX}/comments/review-note.json`,
        'looks good, ship it',
      );
      assert.strictEqual(req.action, 'create_comment');
      assert.strictEqual(req.method, 'POST');
      assert.strictEqual(req.endpoint, '/graphql');
      const input = (req.body.variables as { input: { issueId: string; body: string } }).input;
      assert.strictEqual(input.issueId, PAGE_UUID);
      assert.strictEqual(input.body, 'looks good, ship it');
    });

    it('accepts a JSON object with a body field', () => {
      const req = resolveWritebackRequest(
        `/linear/issues/auth-refactor--${PAGE_HEX}/comments/review-note.json`,
        JSON.stringify({ body: 'with metadata', doNotSubscribeToIssue: true }),
      );
      const input = (req.body.variables as {
        input: { issueId: string; body: string; doNotSubscribeToIssue?: boolean };
      }).input;
      assert.strictEqual(input.body, 'with metadata');
      assert.strictEqual(input.doNotSubscribeToIssue, true);
    });

    it('extracts a dashed UUID from canonical mounted issue paths', () => {
      const req = resolveWritebackRequest(
        `/linear/issues/relayfile-specific-tests__${PAGE_UUID}/comments/review-note.json`,
        JSON.stringify({ body: 'from canonical path' }),
      );
      const input = (req.body.variables as {
        input: { issueId: string; body: string };
      }).input;
      assert.strictEqual(input.issueId, PAGE_UUID);
      assert.strictEqual(input.body, 'from canonical path');
    });

    it('rejects a missing body in JSON form', () => {
      assert.throws(
        () =>
          resolveWritebackRequest(
            `/linear/issues/auth-refactor--${PAGE_HEX}/comments/review-note.json`,
            '{}',
          ),
        /requires a non-empty `body`/,
      );
    });

    it('rejects legacy 8-char id suffix paths with a clear re-sync message', () => {
      assert.throws(
        () =>
          resolveWritebackRequest(
            '/linear/issues/auth-refactor--2fd6800c/comments/review-note.json',
            'hi',
          ),
        /legacy 8-char id suffix.*relayfile pull/,
      );
    });

    it('rejects team-prefixed identifiers with a clear UUID-required message', () => {
      assert.throws(
        () => resolveWritebackRequest('/linear/issues/PROJ-441/comments/review-note.json', 'hi'),
        /team-prefixed identifier/,
      );
    });
  });

  describe('agent activity create', () => {
    it('creates an agent activity on a Linear agent session', () => {
      const req = resolveWritebackRequest(
        '/linear/agent-sessions/session_linear_123/activities/agent-activities-reply.json',
        JSON.stringify({ type: 'response', body: 'I can help with that.' }),
      );

      assert.strictEqual(req.action, 'create_agent_activity');
      assert.strictEqual(req.method, 'POST');
      assert.strictEqual(req.endpoint, '/graphql');
      assert.match(String(req.body.query), /agentActivityCreate/);
      assert.deepStrictEqual(req.body.variables, {
        input: {
          agentSessionId: 'session_linear_123',
          content: {
            type: 'response',
            body: 'I can help with that.',
          },
        },
      });
    });

    it('accepts the full Linear agent activity shape', () => {
      const req = resolveWritebackRequest(
        '/linear/agent-sessions/session%2Fencoded/activities/agent-activities-action.json',
        JSON.stringify({
          type: 'action',
          action: 'create_pr',
          parameter: 'AgentWorkforce/cloud',
          result: 'queued',
        }),
      );

      assert.deepStrictEqual(req.body.variables, {
        input: {
          agentSessionId: 'session/encoded',
          content: {
            type: 'action',
            action: 'create_pr',
            parameter: 'AgentWorkforce/cloud',
            result: 'queued',
          },
        },
      });
    });

    it('rejects invalid activity types', () => {
      assert.throws(
        () =>
          resolveWritebackRequest(
            '/linear/agent-sessions/session_linear_123/activities/agent-activities-reply.json',
            JSON.stringify({ type: 'message', body: 'hi' }),
          ),
        /type` must be one of/,
      );
    });
  });

  describe('issue create', () => {
    it('creates an issue from a JSON payload', () => {
      const req = resolveWritebackRequest(
        '/linear/issues/audit-log-export.json',
        JSON.stringify({ teamId: 'team-1', title: 'Audit log export', priority: 2 }),
      );
      assert.strictEqual(req.action, 'create_issue');
      const input = (req.body.variables as {
        input: { teamId: string; title: string; priority?: number };
      }).input;
      assert.strictEqual(input.teamId, 'team-1');
      assert.strictEqual(input.title, 'Audit log export');
      assert.strictEqual(input.priority, 2);
    });

    it('rejects a missing teamId', () => {
      assert.throws(
        () => resolveWritebackRequest('/linear/issues/audit-log-export.json', JSON.stringify({ title: 'x' })),
        /requires a `teamId`/,
      );
    });
  });

  describe('issue update', () => {
    it('builds an issueUpdate mutation for a canonical id filename', () => {
      const req = resolveWritebackRequest(
        `/linear/issues/auth-refactor--${PAGE_HEX}.json`,
        JSON.stringify({
          title: 'New title',
          description: 'New description',
        }),
      );
      assert.strictEqual(req.action, 'update_issue');
      const variables = req.body.variables as { id: string; input: Record<string, unknown> };
      assert.strictEqual(variables.id, PAGE_UUID);
      assert.deepStrictEqual(variables.input, {
        title: 'New title',
        description: 'New description',
      });
    });

    it('builds an issueUpdate mutation for the canonical __ separator emitted by path-mapper', () => {
      // Pins the merged convention from #49: nameWithId now emits
      // `<basename>__<id>` rather than the legacy `<slug>--<id>`. classifyWrite
      // and extractLinearId must treat the underscore form as canonical.
      const req = resolveWritebackRequest(
        `/linear/issues/auth-refactor__${PAGE_HEX}.json`,
        JSON.stringify({ title: 'New title' }),
      );
      assert.strictEqual(req.action, 'update_issue');
      const variables = req.body.variables as { id: string; input: Record<string, unknown> };
      assert.strictEqual(variables.id, PAGE_UUID);
      assert.deepStrictEqual(variables.input, { title: 'New title' });
    });

    it('rejects read-only fields instead of silently stripping them', () => {
      assert.throws(
        () =>
          resolveWritebackRequest(
            `/linear/issues/auth-refactor--${PAGE_HEX}.json`,
            JSON.stringify({ id: 'different', title: 'New title' }),
          ),
        (error) => error instanceof ReadOnlyFieldError && error.field === 'id',
      );
    });

    it('drops denormalized synced-read fields that IssueUpdateInput does not accept', () => {
      // Pins the bug surfaced on op_31 in workspace rw_517d60b6: the synced
      // file the path-mapper wrote on the read side included Linear's
      // denormalized fields (state_name, assignee_name, priority_label,
      // _connection, _webhook, descriptionData, …). When a user edited the
      // file in place keeping the full envelope and just changed the title,
      // the writeback forwarded every field as IssueUpdateInput and Linear
      // rejected with `Field "state_name" is not defined by type
      // "IssueUpdateInput". Did you mean "stateId"?`.
      //
      // The fix: explicit allowlist matching IssueUpdateInput. Anything not
      // in the schema is silently dropped; only mutable fields go through.
      const req = resolveWritebackRequest(
        `/linear/issues/${PAGE_UUID}.json`,
        JSON.stringify({
          title: 'edited title',
          description: 'edited description',
          // Denormalized read-only fields the writeback must NOT forward:
          state_name: 'Backlog',
          assignee_name: null,
          priority_label: 'No priority',
          created_at: '2026-04-03T18:38:27.932Z',
          updated_at: '2026-04-03T18:38:28.177Z',
          descriptionData: '{"type":"doc"}',
        }),
      );
      const variables = req.body.variables as { id: string; input: Record<string, unknown> };
      assert.strictEqual(variables.id, PAGE_UUID);
      assert.deepStrictEqual(variables.input, {
        title: 'edited title',
        description: 'edited description',
        descriptionData: '{"type":"doc"}',
      });
    });

    it('rejects synced envelopes because their metadata fields are read-only', () => {
      assert.throws(
        () =>
          resolveWritebackRequest(
            `/linear/issues/auth-refactor--${PAGE_HEX}.json`,
            JSON.stringify({
              provider: 'linear',
              connectionId: 'conn-1',
              workspaceId: 'wks-1',
              payload: {
                title: 'Edited title',
              },
            }),
          ),
        (error) => error instanceof ReadOnlyFieldError && error.field === 'provider',
      );
    });
  });

  describe('issue delete', () => {
    it('builds an issueDelete mutation for a canonical id filename', () => {
      const req = resolveDeleteRequest(`/linear/issues/auth-refactor--${PAGE_HEX}.json`);

      assert.strictEqual(req.action, 'delete_issue');
      assert.strictEqual(req.method, 'POST');
      assert.strictEqual(req.endpoint, '/graphql');
      assert.deepStrictEqual(req.body.variables, { id: PAGE_UUID });
    });

    it('rejects delete writebacks for draft filenames', () => {
      assert.throws(
        () => resolveDeleteRequest('/linear/issues/audit-log-export.json'),
        /No Linear delete writeback rule matched/,
      );
    });
  });

  describe('project create/update/assign', () => {
    const PROJECT_UUID = 'f97660a3-a08c-4157-998f-e2d91951f3e7';
    const ISSUE_A = '11111111-1111-4111-8111-111111111111';
    const ISSUE_B = '22222222-2222-4222-8222-222222222222';

    it('creates a project from a factory-create draft and forwards teamId as teamIds', () => {
      const req = resolveWritebackRequest(
        '/linear/projects/factory-create-operator-key.json',
        JSON.stringify({
          name: 'Factory',
          teamId: 'team-1',
          state: 'planned',
          leadId: 'user-1',
        }),
      );

      assert.strictEqual(req.action, 'create-project');
      assert.strictEqual(req.endpoint, '/linear/projects');
      assert.deepStrictEqual(req.body, {
        name: 'Factory',
        state: 'planned',
        leadId: 'user-1',
        teamIds: ['team-1'],
      });
    });

    it('dedupes teamIds on project create and rejects invalid states', () => {
      const req = resolveWritebackRequest(
        '/linear/projects/factory-create-operator-key.json',
        JSON.stringify({
          name: 'Factory',
          teamId: 'team-1',
          teamIds: ['team-1', 'team-2'],
        }),
      );
      assert.deepStrictEqual((req.body as { teamIds: string[] }).teamIds, ['team-1', 'team-2']);

      assert.throws(
        () =>
          resolveWritebackRequest(
            '/linear/projects/factory-create-operator-key.json',
            JSON.stringify({ name: 'Factory', teamIds: ['team-1'], state: 'maybe' }),
          ),
        /state` must be one of planned/,
      );
    });

    it('updates a project through its meta.json directory record', () => {
      const req = resolveWritebackRequest(
        `/linear/projects/${PROJECT_UUID}/meta.json`,
        JSON.stringify({
          state: 'started',
          targetDate: '2026-06-30',
          leadId: 'user-1',
        }),
      );

      assert.strictEqual(req.action, 'update-project');
      assert.strictEqual(req.method, 'PATCH');
      assert.strictEqual(req.endpoint, `/linear/projects/${PROJECT_UUID}`);
      assert.deepStrictEqual(req.body, {
        id: PROJECT_UUID,
        state: 'started',
        targetDate: '2026-06-30',
        leadId: 'user-1',
      });
    });

    it('archives a project via projectArchive and rejects mixed archive/update payloads', () => {
      const req = resolveWritebackRequest(
        `/linear/projects/${PROJECT_UUID}/meta.json`,
        JSON.stringify({ archived: true }),
      );

      assert.strictEqual(req.action, 'archive-project');
      assert.strictEqual(req.endpoint, `/linear/projects/${PROJECT_UUID}/archive`);
      assert.deepStrictEqual(req.body, { id: PROJECT_UUID, trash: false });

      assert.throws(
        () =>
          resolveWritebackRequest(
            `/linear/projects/${PROJECT_UUID}/meta.json`,
            JSON.stringify({ archived: true, state: 'started' }),
          ),
        /cannot be mixed/,
      );
    });

    it('builds a multi-issue project assignment request from add-issues.json', () => {
      const req = resolveWritebackRequest(
        `/linear/projects/${PROJECT_UUID}/add-issues.json`,
        JSON.stringify({ issueIds: [ISSUE_A, ISSUE_B] }),
      );

      assert.strictEqual(req.action, 'add-issues-to-project');
      assert.strictEqual(req.endpoint, `/linear/projects/${PROJECT_UUID}/add-issues`);
      assert.deepStrictEqual(req.body, {
        projectId: PROJECT_UUID,
        issueIds: [ISSUE_A, ISSUE_B],
      });
    });
  });

  describe('unmatched paths', () => {
    it('throws for unrecognized paths', () => {
      assert.throws(
        () => resolveWritebackRequest('/linear/projects/foo/bar.json', '{}'),
        /No Linear writeback rule matched/,
      );
    });
  });
});
