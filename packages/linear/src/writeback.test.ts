import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveWritebackRequest } from './writeback.js';

const PAGE_UUID = '2fd6800c-1c90-80ea-9ec8-fe4a0daa66b8';
const PAGE_HEX = PAGE_UUID.replace(/-/g, '');

describe('linear writeback', () => {
  describe('comment create', () => {
    it('creates a comment from plain-text content on a slug-form path', () => {
      const req = resolveWritebackRequest(
        `/linear/issues/auth-refactor--${PAGE_HEX}/comments/new.json`,
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
        `/linear/issues/auth-refactor--${PAGE_HEX}/comments/new.json`,
        JSON.stringify({ body: 'with metadata', doNotSubscribeToIssue: true }),
      );
      const input = (req.body.variables as {
        input: { issueId: string; body: string; doNotSubscribeToIssue?: boolean };
      }).input;
      assert.strictEqual(input.body, 'with metadata');
      assert.strictEqual(input.doNotSubscribeToIssue, true);
    });

    it('rejects a missing body in JSON form', () => {
      assert.throws(
        () =>
          resolveWritebackRequest(
            `/linear/issues/auth-refactor--${PAGE_HEX}/comments/new.json`,
            '{}',
          ),
        /requires a non-empty `body`/,
      );
    });

    it('rejects legacy 8-char id suffix paths with a clear re-sync message', () => {
      assert.throws(
        () =>
          resolveWritebackRequest(
            '/linear/issues/auth-refactor--2fd6800c/comments/new.json',
            'hi',
          ),
        /legacy 8-char id suffix.*relayfile pull/,
      );
    });

    it('rejects team-prefixed identifiers with a clear UUID-required message', () => {
      assert.throws(
        () => resolveWritebackRequest('/linear/issues/PROJ-441/comments/new.json', 'hi'),
        /team-prefixed identifier/,
      );
    });
  });

  describe('issue create', () => {
    it('creates an issue from a JSON payload', () => {
      const req = resolveWritebackRequest(
        '/linear/issues/new.json',
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
        () => resolveWritebackRequest('/linear/issues/new.json', JSON.stringify({ title: 'x' })),
        /requires a `teamId`/,
      );
    });
  });

  describe('issue update', () => {
    it('builds an issueUpdate mutation excluding server-managed fields', () => {
      const req = resolveWritebackRequest(
        `/linear/issues/auth-refactor--${PAGE_HEX}.json`,
        JSON.stringify({
          id: 'should-be-stripped',
          identifier: 'PROJ-441',
          createdAt: 'should-be-stripped',
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
          id: PAGE_UUID,
          identifier: 'PROJ-441',
          title: 'edited title',
          description: 'edited description',
          // Denormalized read-only fields the writeback must NOT forward:
          state_name: 'Backlog',
          assignee_name: null,
          priority_label: 'No priority',
          created_at: '2026-04-03T18:38:27.932Z',
          updated_at: '2026-04-03T18:38:28.177Z',
          url: 'https://linear.app/x/issue/PROJ-441',
          // Read-side metadata Linear's webhook normalizer emits:
          _connection: { provider: 'linear' },
          _webhook: { action: 'update' },
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

    it('unwraps the synced envelope written by LinearAdapter.renderContent', () => {
      // This is the exact shape an agent sees when it reads a synced
      // /linear/issues/<id>.json file produced by LinearAdapter.renderContent.
      // The agent edits payload.title and writes the whole envelope back; the
      // resolver must NOT forward `provider`, `workspaceId`, etc. into the
      // GraphQL IssueUpdateInput.
      const req = resolveWritebackRequest(
        `/linear/issues/auth-refactor--${PAGE_HEX}.json`,
        JSON.stringify({
          provider: 'linear',
          connectionId: 'conn-1',
          workspaceId: 'wks-1',
          eventType: 'issue.updated',
          objectType: 'issue',
          objectId: PAGE_UUID,
          deleted: false,
          payload: {
            id: PAGE_UUID,
            identifier: 'PROJ-441',
            title: 'Edited title',
            description: 'Edited description',
            priority: 1,
          },
        }),
      );
      const variables = req.body.variables as { id: string; input: Record<string, unknown> };
      assert.strictEqual(variables.id, PAGE_UUID);
      // Only mutable fields from payload survive the denylist; envelope
      // markers (provider, workspaceId, etc.) must not appear.
      assert.deepStrictEqual(variables.input, {
        title: 'Edited title',
        description: 'Edited description',
        priority: 1,
      });
    });
  });

  describe('unmatched paths', () => {
    it('throws for unrecognized paths', () => {
      assert.throws(
        () => resolveWritebackRequest('/linear/projects/foo.json', '{}'),
        /No Linear writeback rule matched/,
      );
    });
  });
});
