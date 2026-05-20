import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildLinearIndexFile } from '../index-emitter.js';
import {
  linearCyclePath,
  linearCommentPath,
  linearIssuePath,
  linearProjectPath,
  linearRoadmapPath,
  linearMilestonePath,
  linearTeamPath,
  linearUserPath,
} from '../path-mapper.js';
import {
  linearCommentIndexRow,
  linearCycleIndexRow,
  linearIssueIndexRow,
  linearMilestoneIndexRow,
  linearProjectIndexRow,
  linearRoadmapIndexRow,
  linearTeamIndexRow,
  linearUserIndexRow,
} from '../queries.js';

describe('linear index emission', () => {
  it('emits deterministic issue, comment, user, and team indexes', () => {
    const issueRows = [
      linearIssueIndexRow({
        id: 'issue-2',
        identifier: 'AGE-1',
        title: 'Second issue',
        createdAt: '2026-04-01T09:00:00.000Z',
        updatedAt: '2026-04-03T10:00:00.000Z',
        state: { name: 'In Progress' },
      }),
      linearIssueIndexRow({
        id: 'issue-1',
        identifier: 'AGE-8',
        title: 'First issue',
        created_at: '2026-04-01T08:00:00.000Z',
        updated_at: '2026-04-03T10:00:00.000Z',
        state: null,
      }),
    ];
    const commentRows = [
      linearCommentIndexRow({
        id: 'comment-2',
        body: 'Second comment',
        createdAt: '2026-04-01T07:00:00.000Z',
        updatedAt: '2026-04-02T07:00:00.000Z',
      }),
      linearCommentIndexRow({
        id: 'comment-1',
        issue: { title: 'Fallback title' },
        created_at: '2026-04-01T06:00:00.000Z',
      }),
    ];
    const userRows = [
      linearUserIndexRow({
        id: 'user-2',
        displayName: 'Taylor',
        updatedAt: '2026-04-03T11:00:00.000Z',
      }),
      linearUserIndexRow({
        id: 'user-1',
        email: 'agent@example.com',
        createdAt: '2026-04-01T04:00:00.000Z',
      }),
    ];
    const teamRows = [
      linearTeamIndexRow({
        id: 'team-2',
        name: 'Infrastructure',
        updatedAt: '2026-04-03T12:00:00.000Z',
      }),
      linearTeamIndexRow({
        id: 'team-1',
        key: 'CORE',
        createdAt: '2026-04-01T05:00:00.000Z',
      }),
    ];

    const issueIndex = buildLinearIndexFile('issues', issueRows);
    const issueIndexAgain = buildLinearIndexFile('issues', [...issueRows].reverse());
    const commentIndex = buildLinearIndexFile('comments', commentRows);
    const userIndex = buildLinearIndexFile('users', userRows);
    const teamIndex = buildLinearIndexFile('teams', teamRows);
    const projectIndex = buildLinearIndexFile('projects', [
      linearProjectIndexRow({
        id: 'project-1',
        name: 'Roadmap',
        updatedAt: '2026-04-03T13:00:00.000Z',
      }),
    ]);
    const cycleIndex = buildLinearIndexFile('cycles', [
      linearCycleIndexRow({
        id: 'cycle-1',
        number: 5,
        name: 'Cycle 5',
        updatedAt: '2026-04-03T14:00:00.000Z',
      }),
    ]);
    const milestoneIndex = buildLinearIndexFile('milestones', [
      linearMilestoneIndexRow({
        id: 'milestone-1',
        name: 'Beta',
        updatedAt: '2026-04-03T15:00:00.000Z',
      }),
    ]);
    const roadmapIndex = buildLinearIndexFile('roadmaps', [
      linearRoadmapIndexRow({
        id: 'roadmap-1',
        name: 'Platform',
        updatedAt: '2026-04-03T16:00:00.000Z',
      }),
    ]);

    assert.deepEqual(issueIndex, issueIndexAgain);
    assert.equal(issueIndex.path, '/linear/issues/_index.json');
    assert.equal(commentIndex.path, '/linear/comments/_index.json');
    assert.equal(userIndex.path, '/linear/users/_index.json');
    assert.equal(teamIndex.path, '/linear/teams/_index.json');
    assert.equal(projectIndex.path, '/linear/projects/_index.json');
    assert.equal(cycleIndex.path, '/linear/cycles/_index.json');
    assert.equal(milestoneIndex.path, '/linear/milestones/_index.json');
    assert.equal(roadmapIndex.path, '/linear/roadmaps/_index.json');
    assert.equal(issueIndex.contentType, 'application/json; charset=utf-8');

    assert.deepEqual(JSON.parse(issueIndex.content), [
      {
        id: 'issue-1',
        title: 'First issue',
        updated: '2026-04-03T10:00:00.000Z',
        identifier: 'AGE-8',
        state: '',
      },
      {
        id: 'issue-2',
        title: 'Second issue',
        updated: '2026-04-03T10:00:00.000Z',
        identifier: 'AGE-1',
        state: 'In Progress',
      },
    ]);
    assert.deepEqual(JSON.parse(commentIndex.content), [
      { id: 'comment-2', title: 'Second comment', updated: '2026-04-02T07:00:00.000Z' },
      { id: 'comment-1', title: 'Fallback title', updated: '2026-04-01T06:00:00.000Z' },
    ]);
    assert.deepEqual(JSON.parse(userIndex.content), [
      { id: 'user-2', title: 'Taylor', updated: '2026-04-03T11:00:00.000Z' },
      { id: 'user-1', title: 'agent@example.com', updated: '2026-04-01T04:00:00.000Z' },
    ]);
    assert.deepEqual(JSON.parse(teamIndex.content), [
      { id: 'team-2', title: 'Infrastructure', updated: '2026-04-03T12:00:00.000Z' },
      { id: 'team-1', title: 'CORE', updated: '2026-04-01T05:00:00.000Z' },
    ]);

    assert.equal(linearIssuePath('issue-1'), '/linear/issues/issue-1.json');
    assert.equal(linearCommentPath('comment-1'), '/linear/comments/comment-1.json');
    assert.equal(linearUserPath('user-1'), '/linear/users/user-1.json');
    assert.equal(linearTeamPath('team-1'), '/linear/teams/team-1.json');
    assert.equal(linearProjectPath('project-1'), '/linear/projects/project-1.json');
    assert.equal(linearCyclePath('cycle-1'), '/linear/cycles/cycle-1.json');
    assert.equal(linearMilestonePath('milestone-1'), '/linear/milestones/milestone-1.json');
    assert.equal(linearRoadmapPath('roadmap-1'), '/linear/roadmaps/roadmap-1.json');
  });

  it('emits an empty index when a linear bucket has no records', () => {
    const file = buildLinearIndexFile('comments', []);
    assert.equal(file.path, '/linear/comments/_index.json');
    assert.deepEqual(JSON.parse(file.content), []);
  });

  it('re-exports the index and layout helpers from the barrel', async () => {
    const barrel = await import('../index.js');

    assert.equal(barrel.buildLinearIndexFile, buildLinearIndexFile);
    assert.equal(typeof barrel.linearLayoutPromptFile, 'function');
  });
});
