import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  JIRA_PATH_ROOT,
  extractJiraIdFromPathSegment,
  jiraIssueByAssigneeAliasPath,
  jiraIssueByCreatorAliasPath,
  jiraIssueByEditedPath,
  jiraIssueByIdAliasPath,
  jiraIssueByKeyAliasPath,
  jiraIssueByPriorityPath,
  jiraIssueByStatePath,
  jiraIssueByTitleAliasPath,
  jiraIssuePath,
  jiraProjectByIdAliasPath,
  jiraProjectByTitleAliasPath,
  jiraProjectPath,
  jiraSprintByIdAliasPath,
  jiraSprintByTitleAliasPath,
  jiraSprintPath,
} from '../path-mapper.js';

// AGENTS.md mandates round-trip, collision, and non-empty content tests for
// every path-mapper helper / alias subtree. The legacy helpers
// (jiraIssueByIdAliasPath / jiraIssueByKeyAliasPath / jiraIssueByStatePath)
// are exercised in jira-adapter.test.ts; this file owns the contract checks
// for the three helpers introduced in the by-assignee + by-id alias PR.
describe('jira path-mapper aliases (by-assignee, by-id)', () => {
  describe('jiraIssueByAssigneeAliasPath', () => {
    it('composes a stable path under issues/by-assignee/<accountId>/<issueId>', () => {
      const path = jiraIssueByAssigneeAliasPath('5b10ac8d82e05b22cc7d4ce5', '10001');
      assert.equal(path, `${JIRA_PATH_ROOT}/issues/by-assignee/5b10ac8d82e05b22cc7d4ce5/10001.json`);
    });

    it('round-trips the issue id from the leaf segment', () => {
      // The leaf segment of the by-assignee alias is the issue id (not a
      // <slug>__<id> pair), so extractJiraIdFromPathSegment must return the
      // id verbatim — i.e. the helper is reversible by the same parser used
      // for canonical paths.
      const accountId = '5b10ac8d82e05b22cc7d4ce5';
      const issueId = '10001';
      const path = jiraIssueByAssigneeAliasPath(accountId, issueId);
      const leaf = path.slice(path.lastIndexOf('/') + 1).replace(/\.json$/u, '');
      assert.equal(extractJiraIdFromPathSegment(leaf), issueId);
    });

    it('does not collide with the canonical issue path subtree', () => {
      // The canonical issue path is /jira/issues/<slug>__<id>.json (no
      // intervening subdirectory), so the by-assignee subtree must live
      // strictly under /jira/issues/by-assignee/... and never alias the
      // canonical leaf naming.
      const alias = jiraIssueByAssigneeAliasPath('acct-abc', '10001');
      const canonical = jiraIssuePath('10001', 'Fix login redirect');
      assert.notEqual(alias, canonical);
      assert.ok(alias.startsWith(`${JIRA_PATH_ROOT}/issues/by-assignee/`));
      assert.ok(!canonical.startsWith(`${JIRA_PATH_ROOT}/issues/by-assignee/`));
    });

    it('keeps by-assignee distinct from sibling alias subtrees', () => {
      const accountId = 'acct-abc';
      const issueId = '10001';
      const byAssignee = jiraIssueByAssigneeAliasPath(accountId, issueId);
      const byId = jiraIssueByIdAliasPath(issueId);
      const byKey = jiraIssueByKeyAliasPath('ENG-42');
      const byState = jiraIssueByStatePath('In Progress', issueId);
      const byTitle = jiraIssueByTitleAliasPath('Fix login redirect', issueId);
      const byCreator = jiraIssueByCreatorAliasPath(accountId, issueId);
      const byPriority = jiraIssueByPriorityPath('High Priority', issueId);
      const all = new Set([byAssignee, byId, byKey, byState, byTitle, byCreator, byPriority]);
      assert.equal(all.size, 7, 'each alias subtree must produce a unique path');
    });

    it('url-encodes accountId and issueId segments', () => {
      // Atlassian accountIds are opaque tokens; the helper must not silently
      // accept characters that would break the path. URI-encoding the
      // segments (matching the rest of path-mapper) guarantees a safe leaf
      // for BOTH segments — assigneeId AND issueId.
      const path = jiraIssueByAssigneeAliasPath('acct/with slash', '100/01');
      assert.ok(path.includes('acct%2Fwith%20slash'));
      assert.ok(
        path.endsWith('/100%2F01.json'),
        `expected issueId segment to be URI-encoded, got: ${path}`,
      );
    });

  });

  describe('jiraIssueByCreatorAliasPath', () => {
    it('composes a stable path under issues/by-creator/<accountId>/<issueId>', () => {
      assert.equal(
        jiraIssueByCreatorAliasPath('acct-creator', '10001'),
        `${JIRA_PATH_ROOT}/issues/by-creator/acct-creator/10001.json`,
      );
    });

    it('round-trips the issue id from the leaf segment', () => {
      const issueId = '10001';
      const path = jiraIssueByCreatorAliasPath('acct-creator', issueId);
      const leaf = path.slice(path.lastIndexOf('/') + 1).replace(/\.json$/u, '');
      assert.equal(extractJiraIdFromPathSegment(leaf), issueId);
    });
  });

  describe('jiraIssueByPriorityPath', () => {
    it('composes a stable path under issues/by-priority/<priority>/<issueId>', () => {
      assert.equal(
        jiraIssueByPriorityPath('Highest Priority', '10001'),
        `${JIRA_PATH_ROOT}/issues/by-priority/highest-priority/10001.json`,
      );
    });

    it('round-trips the issue id from the leaf segment', () => {
      const issueId = '10001';
      const path = jiraIssueByPriorityPath('Highest Priority', issueId);
      const leaf = path.slice(path.lastIndexOf('/') + 1).replace(/\.json$/u, '');
      assert.equal(extractJiraIdFromPathSegment(leaf), issueId);
    });
  });

  describe('jiraIssueByEditedPath', () => {
    it('composes a stable path under issues/by-edited/<date>/<issueId>', () => {
      assert.equal(
        jiraIssueByEditedPath('2026-05-12', '10001'),
        `${JIRA_PATH_ROOT}/issues/by-edited/2026-05-12/10001.json`,
      );
    });

    it('round-trips the issue id from the leaf segment', () => {
      const issueId = '100/01';
      const path = jiraIssueByEditedPath('2026-05-12', issueId);
      const leaf = path.slice(path.lastIndexOf('/') + 1).replace(/\.json$/u, '');
      assert.equal(extractJiraIdFromPathSegment(leaf), issueId);
    });

    it('does not collide with canonical or sibling issue alias subtrees', () => {
      const issueId = '10001';
      const byEdited = jiraIssueByEditedPath('2026-05-12', issueId);
      const canonical = jiraIssuePath(issueId, 'Fix login redirect');
      const byState = jiraIssueByStatePath('In Progress', issueId);
      const byTitle = jiraIssueByTitleAliasPath('Fix login redirect', issueId);
      const byPriority = jiraIssueByPriorityPath('High Priority', issueId);
      const all = new Set([byEdited, canonical, byState, byTitle, byPriority]);
      assert.equal(all.size, 5, 'by-edited must occupy its own issue namespace');
      assert.ok(byEdited.startsWith(`${JIRA_PATH_ROOT}/issues/by-edited/2026-05-12/`));
      const leaf = byEdited.slice(byEdited.lastIndexOf('/') + 1).replace(/\.json$/u, '');
      assert.equal(extractJiraIdFromPathSegment(leaf), issueId);
    });
  });

  describe('jiraProjectByIdAliasPath', () => {
    it('composes a stable path under projects/by-id/<id>', () => {
      assert.equal(jiraProjectByIdAliasPath('99'), `${JIRA_PATH_ROOT}/projects/by-id/99.json`);
    });

    it('round-trips the project id from the leaf segment', () => {
      const id = '99';
      const path = jiraProjectByIdAliasPath(id);
      const leaf = path.slice(path.lastIndexOf('/') + 1).replace(/\.json$/u, '');
      assert.equal(extractJiraIdFromPathSegment(leaf), id);
    });

    it('does not collide with the canonical project path', () => {
      const alias = jiraProjectByIdAliasPath('99');
      const canonical = jiraProjectPath('99', 'Engineering Platform');
      assert.notEqual(alias, canonical);
      assert.ok(alias.startsWith(`${JIRA_PATH_ROOT}/projects/by-id/`));
      assert.ok(!canonical.startsWith(`${JIRA_PATH_ROOT}/projects/by-id/`));
    });
  });

  describe('by-title aliases', () => {
    it('composes stable title aliases with an id suffix for issues, projects, and sprints', () => {
      assert.equal(
        jiraIssueByTitleAliasPath('Fix Login Redirect', '10001'),
        `${JIRA_PATH_ROOT}/issues/by-title/fix-login-redirect__10001.json`,
      );
      assert.equal(
        jiraProjectByTitleAliasPath('Engineering Platform', '99'),
        `${JIRA_PATH_ROOT}/projects/by-title/engineering-platform__99.json`,
      );
      assert.equal(
        jiraSprintByTitleAliasPath('Sprint 7', '7'),
        `${JIRA_PATH_ROOT}/sprints/by-title/sprint-7__7.json`,
      );
    });

    it('round-trips the immutable id from by-title leaves', () => {
      const cases = [
        { path: jiraIssueByTitleAliasPath('Fix Login Redirect', '10001'), id: '10001' },
        { path: jiraProjectByTitleAliasPath('Engineering Platform', '99'), id: '99' },
        { path: jiraSprintByTitleAliasPath('Sprint 7', '7'), id: '7' },
      ];
      for (const { path, id } of cases) {
        const leaf = path.slice(path.lastIndexOf('/') + 1).replace(/\.json$/u, '');
        assert.equal(extractJiraIdFromPathSegment(leaf), id);
      }
    });
  });

  describe('canonical titled paths encode opaque ids', () => {
    it('keeps issue, project, and sprint ids with slashes inside a single filename and round-trips them', () => {
      const cases = [
        { path: jiraIssuePath('../100/01', 'Fix Login Redirect'), id: '../100/01', prefix: `${JIRA_PATH_ROOT}/issues/` },
        { path: jiraProjectPath('team/../99', 'Engineering Platform'), id: 'team/../99', prefix: `${JIRA_PATH_ROOT}/projects/` },
        { path: jiraSprintPath('../board/7', 'Sprint 7'), id: '../board/7', prefix: `${JIRA_PATH_ROOT}/sprints/` },
      ];

      for (const { path, id, prefix } of cases) {
        assert.ok(path.startsWith(prefix), `expected ${path} to stay under ${prefix}`);
        const leaf = path.slice(path.lastIndexOf('/') + 1).replace(/\.json$/u, '');
        assert.equal(leaf.includes('/'), false, `expected encoded id to stay in one path segment: ${path}`);
        assert.equal(extractJiraIdFromPathSegment(leaf), id);
      }
    });

    it('uses the shared slug helper for titled canonical paths while preserving id fallback', () => {
      assert.equal(
        jiraIssuePath('10001', 'Café login redirect'),
        `${JIRA_PATH_ROOT}/issues/cafe-login-redirect__10001.json`,
      );
      assert.equal(jiraIssuePath('10001', '{}'), `${JIRA_PATH_ROOT}/issues/10001.json`);
    });
  });

  describe('jiraSprintByIdAliasPath', () => {
    it('composes a stable path under sprints/by-id/<id>', () => {
      assert.equal(jiraSprintByIdAliasPath('7'), `${JIRA_PATH_ROOT}/sprints/by-id/7.json`);
    });

    it('round-trips the sprint id from the leaf segment', () => {
      const id = '7';
      const path = jiraSprintByIdAliasPath(id);
      const leaf = path.slice(path.lastIndexOf('/') + 1).replace(/\.json$/u, '');
      assert.equal(extractJiraIdFromPathSegment(leaf), id);
    });

    it('does not collide with the canonical sprint path', () => {
      const alias = jiraSprintByIdAliasPath('7');
      const canonical = jiraSprintPath('7', 'Sprint 7');
      assert.notEqual(alias, canonical);
      assert.ok(alias.startsWith(`${JIRA_PATH_ROOT}/sprints/by-id/`));
      assert.ok(!canonical.startsWith(`${JIRA_PATH_ROOT}/sprints/by-id/`));
    });

    it('keeps project and sprint by-id subtrees in distinct namespaces', () => {
      // Sharing an id ("7") across the two helpers must yield disjoint paths
      // so an aux-file write to one subtree can never clobber the other.
      assert.notEqual(jiraProjectByIdAliasPath('7'), jiraSprintByIdAliasPath('7'));
    });
  });

  it('rejects empty segments via the shared assertion', () => {
    assert.throws(() => jiraIssueByAssigneeAliasPath('', '10001'), /non-empty/u);
    assert.throws(() => jiraIssueByAssigneeAliasPath('acct-abc', ''), /non-empty/u);
    assert.throws(() => jiraIssueByCreatorAliasPath('', '10001'), /non-empty/u);
    assert.throws(() => jiraIssueByCreatorAliasPath('acct-abc', ''), /non-empty/u);
    assert.throws(() => jiraIssueByPriorityPath('', '10001'), /non-empty/u);
    assert.throws(() => jiraIssueByPriorityPath('high', ''), /non-empty/u);
    assert.throws(() => jiraIssueByEditedPath('', '10001'), /non-empty/u);
    assert.throws(() => jiraIssueByEditedPath('2026-05-12', ''), /non-empty/u);
    assert.throws(() => jiraIssueByTitleAliasPath('', '10001'), /non-empty/u);
    assert.throws(() => jiraIssueByTitleAliasPath('title', ''), /non-empty/u);
    assert.throws(() => jiraProjectByIdAliasPath(''), /non-empty/u);
    assert.throws(() => jiraProjectByTitleAliasPath('', '99'), /non-empty/u);
    assert.throws(() => jiraProjectByTitleAliasPath('project', ''), /non-empty/u);
    assert.throws(() => jiraSprintByIdAliasPath(''), /non-empty/u);
    assert.throws(() => jiraSprintByTitleAliasPath('', '7'), /non-empty/u);
    assert.throws(() => jiraSprintByTitleAliasPath('sprint', ''), /non-empty/u);
  });
});
