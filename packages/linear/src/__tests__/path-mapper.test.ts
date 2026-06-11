import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeLinearPath,
  linearAgentWebhookEventPath,
  linearAgentWebhookTriggerGlob,
  linearByIdAliasPath,
  linearByTitleAliasPath,
  linearByUuidAliasPath,
  linearCommentLegacyPath,
  linearCommentPath,
  linearCommentReadCandidatePaths,
  linearIssueByEditedPath,
  normalizeLinearObjectType,
  normalizeNangoLinearModel,
  tryNormalizeLinearObjectType,
} from '../path-mapper.js';

describe('linear path-mapper', () => {
  describe('normalizeLinearObjectType', () => {
    it('accepts canonical types', () => {
      assert.equal(normalizeLinearObjectType('issue'), 'issue');
      assert.equal(normalizeLinearObjectType('TEAM'), 'team');
    });

    it('accepts plural aliases', () => {
      assert.equal(normalizeLinearObjectType('issues'), 'issue');
      assert.equal(normalizeLinearObjectType('teams'), 'team');
    });

    it('accepts Nango-style PascalCase model names', () => {
      assert.equal(normalizeLinearObjectType('LinearTeam'), 'team');
      assert.equal(normalizeLinearObjectType('LinearUser'), 'user');
      assert.equal(normalizeLinearObjectType('LinearIssue'), 'issue');
      assert.equal(normalizeLinearObjectType('LinearComment'), 'comment');
      assert.equal(normalizeLinearObjectType('LinearCycle'), 'cycle');
      assert.equal(normalizeLinearObjectType('LinearMilestone'), 'milestone');
      assert.equal(normalizeLinearObjectType('LinearProject'), 'project');
      assert.equal(normalizeLinearObjectType('LinearRoadmap'), 'roadmap');
      assert.equal(normalizeLinearObjectType('LinearState'), 'state');
    });

    it('throws on unknown types', () => {
      assert.throws(() => normalizeLinearObjectType('flarb'));
    });
  });

  describe('tryNormalizeLinearObjectType', () => {
    it('returns undefined on unknown types', () => {
      assert.equal(tryNormalizeLinearObjectType('flarb'), undefined);
    });

    it('returns the resolved type for known input', () => {
      assert.equal(tryNormalizeLinearObjectType('LinearIssue'), 'issue');
    });
  });

  describe('normalizeNangoLinearModel', () => {
    // Each Nango sync emits a single PascalCase model — see
    // cloud/nango-integrations/linear-relay/syncs/*.ts. This test pins those
    // contracts so any future sync rename surfaces here as a failure.
    it('maps every Nango linear-relay sync model', () => {
      assert.equal(normalizeNangoLinearModel('LinearComment'), 'comment');
      assert.equal(normalizeNangoLinearModel('LinearCycle'), 'cycle');
      assert.equal(normalizeNangoLinearModel('LinearIssue'), 'issue');
      assert.equal(normalizeNangoLinearModel('LinearMilestone'), 'milestone');
      assert.equal(normalizeNangoLinearModel('LinearProject'), 'project');
      assert.equal(normalizeNangoLinearModel('LinearRoadmap'), 'roadmap');
      assert.equal(normalizeNangoLinearModel('LinearState'), 'state');
      assert.equal(normalizeNangoLinearModel('LinearTeam'), 'team');
      assert.equal(normalizeNangoLinearModel('LinearUser'), 'user');
    });

    it('falls back to alias-map normalization for non-Nango input', () => {
      assert.equal(normalizeNangoLinearModel('issues'), 'issue');
    });
  });

  describe('computeLinearPath', () => {
    it('produces Nango-driven paths from PascalCase model names', () => {
      assert.equal(
        computeLinearPath('LinearTeam', '50cf92f3-f53c-4ab6-bf05-ea76ebd21692'),
        '/linear/teams/50cf92f3-f53c-4ab6-bf05-ea76ebd21692.json',
      );
      assert.equal(
        computeLinearPath('LinearUser', 'usr_123'),
        '/linear/users/usr_123.json',
      );
      assert.equal(
        computeLinearPath('LinearState', 'state_123'),
        '/linear/states/state_123.json',
      );
    });

    it('maps alias paths for issue and project scopes', () => {
      assert.equal(
        linearByTitleAliasPath('/linear/issues', 'Cafe roadmap', 'issue-1'),
        '/linear/issues/by-title/cafe-roadmap.json',
      );
      assert.equal(
        linearByIdAliasPath('/linear/issues', 'AGE-8'),
        '/linear/issues/by-id/AGE-8.json',
      );
      assert.equal(
        linearIssueByEditedPath('2026-05-12', 'issue-123'),
        '/linear/issues/by-edited/2026-05-12/issue-123.json',
      );
      const leaf = linearIssueByEditedPath('2026-05-12', 'issue/123').split('/').pop()!.replace(/\.json$/u, '');
      assert.equal(decodeURIComponent(leaf), 'issue/123');
    });
  });

  describe('linear agent webhook paths', () => {
    it('maps provider-verbatim trigger names to synthetic event roots', () => {
      assert.equal(
        linearAgentWebhookTriggerGlob('AgentSessionEvent.created'),
        '/linear/agent-sessions/**',
      );
      assert.equal(
        linearAgentWebhookTriggerGlob('AppUserNotification.issueAssignedToYou'),
        '/linear/app-user-notifications/**',
      );
      assert.equal(
        linearAgentWebhookTriggerGlob('PermissionChange.teamAccessChanged'),
        '/linear/permission-changes/**',
      );
      assert.equal(
        linearAgentWebhookTriggerGlob('OAuthApp.revoked'),
        '/linear/oauth-app/**',
      );
      assert.equal(linearAgentWebhookTriggerGlob('AgentSessionEvent.unknown'), null);
    });

    it('maps runtime event payload ids to concrete synthetic event paths', () => {
      assert.equal(
        linearAgentWebhookEventPath('AgentSessionEvent.created', 'session/id with spaces'),
        '/linear/agent-sessions/session%2Fid%20with%20spaces.json',
      );
      assert.equal(
        linearAgentWebhookEventPath('AppUserNotification.issueAssignedToYou', 'notification_123'),
        '/linear/app-user-notifications/notification_123.json',
      );
      assert.equal(
        linearAgentWebhookEventPath('PermissionChange.teamAccessChanged', 'webhook_123'),
        '/linear/permission-changes/webhook_123.json',
      );
      assert.equal(
        linearAgentWebhookEventPath('OAuthApp.revoked', 'oauth_client_123'),
        '/linear/oauth-app/oauth_client_123.json',
      );
      assert.equal(linearAgentWebhookEventPath('OAuthApp.revoked'), null);
      assert.equal(linearAgentWebhookEventPath('AgentSessionEvent.unknown', 'session_123'), null);
    });
  });

  // The reconciliation anchor introduced in bcb45996: keyed on the stable
  // Linear UUID rather than the (possibly-absent) `TEAM-123` identifier.
  // Per AGENTS.md every path-mapper helper needs round-trip coverage, and
  // `by-uuid` is now load-bearing for delete tombstones — without these
  // tests the next regression on the anchor would slip through CI.
  describe('linearByUuidAliasPath', () => {
    it('composes a stable by-uuid alias path under any scope', () => {
      assert.equal(
        linearByUuidAliasPath(
          '/linear/issues',
          '8a3c9b50-22f0-4d2c-a07d-7e02d2cf6f9e',
        ),
        '/linear/issues/by-uuid/8a3c9b50-22f0-4d2c-a07d-7e02d2cf6f9e.json',
      );
      // Also works for project scope so future adapters reusing the helper
      // don't accidentally hardcode the issues path.
      assert.equal(
        linearByUuidAliasPath('/linear/projects', 'proj-uuid-1'),
        '/linear/projects/by-uuid/proj-uuid-1.json',
      );
    });

    it('round-trips: the leaf segment decodes back to the source UUID', () => {
      const uuid = '8a3c9b50-22f0-4d2c-a07d-7e02d2cf6f9e';
      const composed = linearByUuidAliasPath('/linear/issues', uuid);
      const leaf = composed.split('/').pop()!.replace(/\.json$/u, '');
      assert.equal(decodeURIComponent(leaf), uuid);
    });

    it('percent-encodes UUIDs containing characters that need escaping', () => {
      // Linear UUIDs are well-formed today, but the helper must defend
      // against operator-supplied scope+id pairs that include reserved
      // URI characters — otherwise `by-uuid` becomes a foot-gun the day
      // someone calls it with a slug-like input.
      const messyId = 'team/id with spaces';
      const composed = linearByUuidAliasPath('/linear/issues', messyId);
      const leaf = composed.split('/').pop()!.replace(/\.json$/u, '');
      assert.equal(decodeURIComponent(leaf), messyId);
    });

    // AGENTS.md: every alias subtree needs a collision test. `by-uuid` keys
    // only on the stable UUID, so the "collision" semantics here are the
    // inverse of by-title/by-id: distinct UUIDs MUST produce distinct paths
    // (the subtree's whole job is unambiguous lookup by uuid), and the same
    // UUID MUST map to the same path regardless of any other field — that's
    // what makes by-uuid the reconciliation anchor in the first place.
    it('distinct UUIDs always produce distinct alias paths (no false collisions)', () => {
      const uuidA = '8a3c9b50-22f0-4d2c-a07d-7e02d2cf6f9e';
      const uuidB = 'f0e1d2c3-b4a5-9687-7869-5a4b3c2d1e0f';
      const pathA = linearByUuidAliasPath('/linear/issues', uuidA);
      const pathB = linearByUuidAliasPath('/linear/issues', uuidB);
      assert.notEqual(pathA, pathB);
    });

    it('same UUID maps to the same path (idempotent — by-uuid is the rename-stable anchor)', () => {
      // This is the property that lets `planIssueDelete` and the
      // reconciliation read in `planIssueWrite` find prior state from a
      // tombstone that carries only `{ id, _deleted: true }`. If the path
      // shifted with identifier / title / state, the by-uuid anchor
      // would be useless and bcb45996 wouldn't fix anything.
      const uuid = '8a3c9b50-22f0-4d2c-a07d-7e02d2cf6f9e';
      assert.equal(
        linearByUuidAliasPath('/linear/issues', uuid),
        linearByUuidAliasPath('/linear/issues', uuid),
      );
    });

    it('keeps distinct paths across scopes for the same UUID (cross-scope safety)', () => {
      // A UUID that happens to be reused across resource types (rare but
      // not impossible if an operator reuses an id from one scope as a
      // tombstone for another) must NOT alias to the same path. The
      // `scope` prefix is what guarantees this — the test pins it.
      const uuid = '8a3c9b50-22f0-4d2c-a07d-7e02d2cf6f9e';
      const issueScope = linearByUuidAliasPath('/linear/issues', uuid);
      const projectScope = linearByUuidAliasPath('/linear/projects', uuid);
      assert.notEqual(issueScope, projectScope);
    });
  });

  describe('linearCommentPath', () => {
    const commentId = '0f6f0a0c-6a44-4f6e-93f7-2c8b3a9d1e55';

    it('is a directory record and cannot collide with child records under the comment id', () => {
      const comment = linearCommentPath(commentId, 'AGE-8');
      assert.equal(comment, `/linear/comments/AGE-8__${commentId}/meta.json`);

      // A comment's children (Linear supports per-comment emoji reactions and
      // threaded replies; the webhook normalizer already recognizes `reaction`
      // payloads) must nest UNDER the comment's directory — never as a sibling
      // that shares the comment's name with a different node type. This is the
      // invariant whose violation wedges a POSIX mount: a flat leaf file
      // `comments/<name>__<id>.json` cannot coexist with a
      // `comments/<name>__<id>/` directory (`mkdir ... : not a directory`).
      const commentDir = comment.replace(/\/meta\.json$/u, '');
      const hypotheticalReaction = `${commentDir}/reactions/tada--user-1.json`;
      assert.ok(
        hypotheticalReaction.startsWith(`${commentDir}/`),
        'children must nest under the comment directory',
      );
      assert.notEqual(
        comment,
        linearCommentLegacyPath(commentId, 'AGE-8'),
        'comment stem must be a directory record, not the flat .json leaf',
      );

      // Back-compat: readers can still resolve a comment mirrored by a
      // pre-migration adapter at the legacy flat path.
      assert.deepEqual(linearCommentReadCandidatePaths(commentId, 'AGE-8'), [
        comment,
        linearCommentLegacyPath(commentId, 'AGE-8'),
      ]);
      assert.equal(
        linearCommentLegacyPath(commentId, 'AGE-8'),
        `/linear/comments/AGE-8__${commentId}.json`,
      );
    });

    it('routes comment object types through the directory record', () => {
      assert.equal(
        computeLinearPath('comment', commentId, 'AGE-8'),
        `/linear/comments/AGE-8__${commentId}/meta.json`,
      );
    });
  });
});
