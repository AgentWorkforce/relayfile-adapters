import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { emitGitHubAuxiliaryFiles } from '../emit-auxiliary-files.js';
import type {
  AuxiliaryEmitterClient,
  EmitDeleteInput,
  EmitReadInput,
  EmitReadResult,
  EmitWriteInput,
  EmitWriteResult,
} from '@relayfile/adapter-core';
import {
  githubByAssigneeAliasPath,
  githubByCreatorAliasPath,
  githubByEditedAliasPath,
  githubByIdAliasPath,
  githubByPriorityAliasPath,
  githubByStateAliasPath,
  githubNumberedByTitleAliasPath,
  githubCheckRunPath,
  githubCommitPath,
  githubIssuePath,
  githubLegacyByTitleAliasPath,
  githubPullRequestPath,
  githubRepoIssuesIndexPath,
  githubRepoPullsIndexPath,
  githubReposIndexPath,
  githubRepositoryMetaPath,
  githubRepositoryMetadataPath,
  githubReviewCommentPath,
  githubReviewPath,
  githubRootIndexPath,
} from '../path-mapper.js';

interface CapturingClient extends AuxiliaryEmitterClient {
  writes: EmitWriteInput[];
  deletes: EmitDeleteInput[];
  reads: EmitReadInput[];
  files: Map<string, string>;
}

function createClient(
  options: {
    initialFiles?: Record<string, string>;
    failWriteOn?: ReadonlySet<string>;
    noRead?: boolean;
  } = {},
): CapturingClient {
  const files = new Map<string, string>(Object.entries(options.initialFiles ?? {}));
  const writes: EmitWriteInput[] = [];
  const deletes: EmitDeleteInput[] = [];
  const reads: EmitReadInput[] = [];
  const failWriteOn = options.failWriteOn ?? new Set<string>();

  const client: CapturingClient = {
    writes,
    deletes,
    reads,
    files,
    async writeFile(input: EmitWriteInput): Promise<EmitWriteResult> {
      writes.push(input);
      if (failWriteOn.has(input.path)) {
        throw new Error(`forced write failure at ${input.path}`);
      }
      files.set(input.path, input.content);
      return { created: true };
    },
    async deleteFile(input: EmitDeleteInput): Promise<void> {
      deletes.push(input);
      files.delete(input.path);
    },
  };
  if (!options.noRead) {
    client.readFile = async (input: EmitReadInput): Promise<EmitReadResult | null> => {
      reads.push(input);
      const content = files.get(input.path);
      return content === undefined ? null : { content };
    };
  }
  return client;
}

describe('emitGitHubAuxiliaryFiles', () => {
  it('always writes the /github/_index.json root index on empty input', async () => {
    const client = createClient();
    const result = await emitGitHubAuxiliaryFiles(client, { workspaceId: 'ws-1' });
    assert.deepEqual(result.errors, []);
    assert.equal(result.deleted, 0);
    assert.equal(result.written, 1);
    assert.equal(client.writes.length, 1);
    assert.equal(client.writes[0]!.path, githubRootIndexPath());
    assert.equal(client.deletes.length, 0);
    const rows = JSON.parse(client.files.get(githubRootIndexPath())!);
    assert.deepEqual(rows, [{ id: 'repos', title: 'Repositories' }]);
  });

  it('emits /github/_index.json alongside non-empty buckets', async () => {
    const client = createClient();
    const result = await emitGitHubAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      pullRequests: [
        {
          owner: 'acme',
          repo: 'widgets',
          number: 7,
          title: 'feat',
          state: 'open',
          updated_at: '2026-05-12T00:00:00Z',
        },
      ],
    });
    assert.deepEqual(result.errors, []);
    const rootIndex = githubRootIndexPath();
    assert.ok(
      client.writes.some((w) => w.path === rootIndex),
      'expected /github/_index.json to be written',
    );
    const rows = JSON.parse(client.files.get(rootIndex)!);
    assert.deepEqual(rows, [{ id: 'repos', title: 'Repositories' }]);
  });

  it('writes canonical meta.json + by-id + by-title aliases plus the per-repo pulls index for a PR', async () => {
    const client = createClient();
    const result = await emitGitHubAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      pullRequests: [
        {
          owner: 'acme',
          repo: 'widgets',
          number: 42,
          title: 'Add darkmode toggle',
          state: 'open',
          updated_at: '2026-05-12T00:00:00Z',
        },
      ],
    });

    assert.deepEqual(result.errors, []);
    const writtenPaths = client.writes.map((w) => w.path);

    const canonical = githubPullRequestPath('acme', 'widgets', 42, 'Add darkmode toggle');
    const byId = githubByIdAliasPath('acme', 'widgets', 'pulls', 42);
    const byTitle = githubNumberedByTitleAliasPath('acme', 'widgets', 'pulls', 'Add darkmode toggle', 42);
    const byState = githubByStateAliasPath('acme', 'widgets', 'pulls', 'open', 42);
    const byEdited = githubByEditedAliasPath('acme', 'widgets', 'pulls', '2026-05-12', 42);
    const indexPath = githubRepoPullsIndexPath('acme', 'widgets');

    for (const p of [canonical, byId, byTitle, byState, byEdited, indexPath]) {
      assert.ok(writtenPaths.includes(p), `missing expected write ${p}`);
    }

    // Same content bytes at canonical + alias paths.
    const canonicalBytes = client.files.get(canonical);
    assert.equal(client.files.get(byId), canonicalBytes);
    assert.equal(client.files.get(byTitle), canonicalBytes);
    assert.equal(client.files.get(byState), canonicalBytes);
    assert.equal(client.files.get(byEdited), canonicalBytes);

    // Index row scoped to this repo.
    const indexBytes = client.files.get(indexPath)!;
    const rows = JSON.parse(indexBytes) as Array<{ id: string; number: number; state: string }>;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.id, '42');
    assert.equal(rows[0]!.number, 42);
    assert.equal(rows[0]!.state, 'open');
  });

  it('reconciles a PR rename: prior by-title alias and prior canonical meta.json are deleted via by-id anchor', async () => {
    const priorPayload = {
      provider: 'github',
      objectType: 'pull_request',
      objectId: '42',
      payload: {
        owner: 'acme',
        repo: 'widgets',
        number: 42,
        title: 'Old Title',
        state: 'open',
        updated_at: '2026-05-11T00:00:00Z',
      },
    };
    const client = createClient({
      initialFiles: {
        [githubByIdAliasPath('acme', 'widgets', 'pulls', 42)]: JSON.stringify(priorPayload),
      },
    });

    const result = await emitGitHubAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      pullRequests: [
        {
          owner: 'acme',
          repo: 'widgets',
          number: 42,
          title: 'New Title',
          state: 'open',
          updated_at: '2026-05-12T00:00:00Z',
        },
      ],
    });

    assert.deepEqual(result.errors, []);

    const deletedPaths = client.deletes.map((d) => d.path);
    // Prior by-title alias removed.
    assert.ok(
      deletedPaths.includes(githubNumberedByTitleAliasPath('acme', 'widgets', 'pulls', 'Old Title', 42)),
      `expected prior by-title alias in deletes; got: ${deletedPaths.join(', ')}`,
    );
    // Prior canonical meta.json removed (but not the directory itself).
    assert.ok(
      deletedPaths.includes(githubPullRequestPath('acme', 'widgets', 42, 'Old Title')),
      `expected prior canonical meta.json in deletes`,
    );
    assert.ok(
      deletedPaths.includes(githubByEditedAliasPath('acme', 'widgets', 'pulls', '2026-05-11', 42)),
      `expected prior by-edited alias in deletes`,
    );
    // by-id alias stays put (it's the anchor — same path before and after).
    assert.ok(!deletedPaths.includes(githubByIdAliasPath('acme', 'widgets', 'pulls', 42)));

    // New canonical + by-title written.
    const writtenPaths = client.writes.map((w) => w.path);
    assert.ok(writtenPaths.includes(githubPullRequestPath('acme', 'widgets', 42, 'New Title')));
    assert.ok(writtenPaths.includes(githubNumberedByTitleAliasPath('acme', 'widgets', 'pulls', 'New Title', 42)));
    assert.ok(writtenPaths.includes(githubByEditedAliasPath('acme', 'widgets', 'pulls', '2026-05-12', 42)));
  });

  it('reconciles a PR state transition by moving the by-state alias', async () => {
    const priorPayload = {
      provider: 'github',
      objectType: 'pull_request',
      objectId: '42',
      payload: {
        owner: 'acme',
        repo: 'widgets',
        number: 42,
        title: 'Stateful PR',
        state: 'open',
      },
    };
    const client = createClient({
      initialFiles: {
        [githubByIdAliasPath('acme', 'widgets', 'pulls', 42)]: JSON.stringify(priorPayload),
      },
    });

    const result = await emitGitHubAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      pullRequests: [
        {
          owner: 'acme',
          repo: 'widgets',
          number: 42,
          title: 'Stateful PR',
          state: 'closed',
          updated_at: '2026-05-12T00:00:00Z',
        },
      ],
    });

    assert.deepEqual(result.errors, []);
    assert.ok(
      client.deletes.some((d) => d.path === githubByStateAliasPath('acme', 'widgets', 'pulls', 'open', 42)),
      'expected prior by-state alias to be deleted',
    );
    assert.ok(
      client.writes.some((w) => w.path === githubByStateAliasPath('acme', 'widgets', 'pulls', 'closed', 42)),
      'expected new by-state alias to be written',
    );
  });

  it('reconciles issue assignee, creator, and priority aliases on metadata changes', async () => {
    const priorPayload = {
      provider: 'github',
      objectType: 'issue',
      objectId: '7',
      payload: {
        owner: 'acme',
        repo: 'widgets',
        number: 7,
        title: 'Metadata issue',
        state: 'open',
        assignees: [{ login: 'octocat' }],
        user: { login: 'monalisa' },
        labels: [{ name: 'P1' }],
      },
    };
    const client = createClient({
      initialFiles: {
        [githubByIdAliasPath('acme', 'widgets', 'issues', 7)]: JSON.stringify(priorPayload),
      },
    });

    await emitGitHubAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      issues: [
        {
          owner: 'acme',
          repo: 'widgets',
          number: 7,
          title: 'Metadata issue',
          state: 'open',
          assignees: [{ login: 'hubot' }],
          user: { login: 'maintainer' },
          labels: [{ name: 'priority:high' }],
        },
      ],
    });

    const deletedPaths = client.deletes.map((d) => d.path);
    assert.ok(deletedPaths.includes(githubByAssigneeAliasPath('acme', 'widgets', 'issues', 'octocat', 7)));
    assert.ok(deletedPaths.includes(githubByCreatorAliasPath('acme', 'widgets', 'issues', 'monalisa', 7)));
    assert.ok(deletedPaths.includes(githubByPriorityAliasPath('acme', 'widgets', 'issues', 'P1', 7)));

    const writtenPaths = client.writes.map((w) => w.path);
    assert.ok(writtenPaths.includes(githubByAssigneeAliasPath('acme', 'widgets', 'issues', 'hubot', 7)));
    assert.ok(writtenPaths.includes(githubByCreatorAliasPath('acme', 'widgets', 'issues', 'maintainer', 7)));
    assert.ok(writtenPaths.includes(githubByPriorityAliasPath('acme', 'widgets', 'issues', 'high', 7)));
  });

  it('writes canonical meta.json + aliases for an issue with per-repo issues index', async () => {
    const client = createClient();
    await emitGitHubAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      issues: [
        {
          owner: 'acme',
          repo: 'widgets',
          number: 7,
          title: 'Bug report',
          state: 'open',
          assignees: [{ login: 'octocat' }],
          user: { login: 'monalisa' },
          labels: [{ name: 'P0 Critical' }],
          updated_at: '2026-05-12T00:00:00Z',
        },
      ],
    });

    const writtenPaths = client.writes.map((w) => w.path);
    const indexPath = githubRepoIssuesIndexPath('acme', 'widgets');
    assert.ok(writtenPaths.includes(githubIssuePath('acme', 'widgets', 7, 'Bug report')));
    assert.ok(writtenPaths.includes(githubByIdAliasPath('acme', 'widgets', 'issues', 7)));
    assert.ok(writtenPaths.includes(githubNumberedByTitleAliasPath('acme', 'widgets', 'issues', 'Bug report', 7)));
    assert.ok(writtenPaths.includes(githubByStateAliasPath('acme', 'widgets', 'issues', 'open', 7)));
    assert.ok(writtenPaths.includes(githubByAssigneeAliasPath('acme', 'widgets', 'issues', 'octocat', 7)));
    assert.ok(writtenPaths.includes(githubByCreatorAliasPath('acme', 'widgets', 'issues', 'monalisa', 7)));
    assert.ok(writtenPaths.includes(githubByPriorityAliasPath('acme', 'widgets', 'issues', 'P0 Critical', 7)));
    assert.ok(writtenPaths.includes(githubByEditedAliasPath('acme', 'widgets', 'issues', '2026-05-12', 7)));
    assert.ok(writtenPaths.includes(indexPath));

    // No writes leaked into the pulls index for this repo.
    assert.ok(!writtenPaths.includes(githubRepoPullsIndexPath('acme', 'widgets')));
  });

  it('writes distinct by-title aliases for duplicate issue titles and keeps cleanup scoped by number', async () => {
    const client = createClient();
    await emitGitHubAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      issues: [
        {
          owner: 'acme',
          repo: 'widgets',
          number: 1,
          title: 'Duplicate title',
          state: 'open',
          updated_at: '2026-05-12T00:00:00Z',
        },
        {
          owner: 'acme',
          repo: 'widgets',
          number: 2,
          title: 'Duplicate title',
          state: 'open',
          updated_at: '2026-05-12T00:00:00Z',
        },
      ],
    });

    const firstAlias = githubNumberedByTitleAliasPath('acme', 'widgets', 'issues', 'Duplicate title', 1);
    const secondAlias = githubNumberedByTitleAliasPath('acme', 'widgets', 'issues', 'Duplicate title', 2);
    assert.notEqual(firstAlias, secondAlias);
    assert.ok(client.files.has(firstAlias));
    assert.ok(client.files.has(secondAlias));

    const renamedClient = createClient({
      initialFiles: {
        [githubByIdAliasPath('acme', 'widgets', 'issues', 1)]: client.files.get(
          githubByIdAliasPath('acme', 'widgets', 'issues', 1),
        )!,
        [githubByIdAliasPath('acme', 'widgets', 'issues', 2)]: client.files.get(
          githubByIdAliasPath('acme', 'widgets', 'issues', 2),
        )!,
        [firstAlias]: client.files.get(firstAlias)!,
        [secondAlias]: client.files.get(secondAlias)!,
      },
    });

    await emitGitHubAuxiliaryFiles(renamedClient, {
      workspaceId: 'ws-1',
      issues: [
        {
          owner: 'acme',
          repo: 'widgets',
          number: 1,
          title: 'Renamed title',
          state: 'open',
          updated_at: '2026-05-13T00:00:00Z',
        },
      ],
    });

    const deletedPaths = new Set(renamedClient.deletes.map((d) => d.path));
    assert.ok(deletedPaths.has(firstAlias));
    assert.ok(deletedPaths.has(githubLegacyByTitleAliasPath('acme', 'widgets', 'issues', 'Duplicate title', 1)));
    assert.ok(!deletedPaths.has(secondAlias), 'renaming issue 1 must not delete issue 2 by-title alias');
    assert.ok(renamedClient.files.has(secondAlias), 'issue 2 by-title alias must remain materialized');
  });

  it('writes repository meta.json + repos _index.json row', async () => {
    const client = createClient();
    await emitGitHubAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      repositories: [
        {
          owner: 'acme',
          repo: 'widgets',
          updated_at: '2026-05-12T00:00:00Z',
        },
      ],
    });

    const writtenPaths = client.writes.map((w) => w.path);
    const metadataPath = githubRepositoryMetaPath('acme', 'widgets');
    const indexPath = githubReposIndexPath();
    assert.ok(writtenPaths.includes(metadataPath));
    assert.ok(metadataPath.endsWith('/meta.json'), 'repo canonical must be meta.json');
    assert.ok(!writtenPaths.includes(githubRepositoryMetadataPath('acme', 'widgets')));
    assert.ok(writtenPaths.includes(indexPath));

    const rows = JSON.parse(client.files.get(indexPath)!) as Array<{
      id: string;
      title: string;
    }>;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.id, 'acme/widgets');
    assert.equal(rows[0]!.title, 'acme/widgets');
  });

  it('writes flat per-repo canonical paths for review, review_comment, check_run, commit (no aliases, no per-repo index)', async () => {
    const client = createClient();
    const sha = '0123456789abcdef0123456789abcdef01234567';
    await emitGitHubAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      reviews: [{ owner: 'acme', repo: 'widgets', id: 555 }],
      reviewComments: [{ owner: 'acme', repo: 'widgets', id: 999 }],
      checkRuns: [{ owner: 'acme', repo: 'widgets', id: 12345 }],
      commits: [{ owner: 'acme', repo: 'widgets', sha }],
    });

    const writtenPaths = client.writes.map((w) => w.path);
    assert.ok(writtenPaths.includes(githubReviewPath('acme', 'widgets', 555)));
    assert.ok(writtenPaths.includes(githubReviewCommentPath('acme', 'widgets', 999)));
    assert.ok(writtenPaths.includes(githubCheckRunPath('acme', 'widgets', 12345)));
    assert.ok(writtenPaths.includes(githubCommitPath('acme', 'widgets', sha)));
    // No per-repo index writes for the flat kinds — only canonical paths.
    assert.ok(!writtenPaths.includes(githubRepoPullsIndexPath('acme', 'widgets')));
    assert.ok(!writtenPaths.includes(githubRepoIssuesIndexPath('acme', 'widgets')));
    assert.ok(!writtenPaths.includes(githubReposIndexPath()));
    // Commit canonical is the dir-form `<sha>/metadata.json`.
    const commitPath = githubCommitPath('acme', 'widgets', sha);
    assert.ok(commitPath.endsWith('/metadata.json'));
  });

  it('rejects malformed flat-record ids before emitting paths', async () => {
    const client = createClient();
    const result = await emitGitHubAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      reviews: [{ owner: 'acme', repo: 'widgets', id: '../issues/owned' }],
      reviewComments: [
        { owner: 'acme', repo: 'widgets', id: 'a/b' },
        { owner: 'acme', repo: 'widgets', id: '../comments/owned', _deleted: true },
      ],
      checkRuns: [{ owner: 'acme', repo: 'widgets', id: '123/456' }],
      commits: [
        { owner: 'acme', repo: 'widgets', sha: 'not/a/sha' },
        { owner: 'acme', repo: 'widgets', id: '../commits/owned', _deleted: true },
      ],
    });

    assert.deepEqual(result.errors, []);
    const unsafeWrites = client.writes.filter(
      (w) =>
        w.path.includes('/reviews/') ||
        w.path.includes('/comments/') ||
        w.path.includes('/checks/') ||
        w.path.includes('/commits/'),
    );
    assert.deepEqual(unsafeWrites, []);
    assert.equal(client.deletes.length, 0);
  });

  it('multi-tenant: two PRs in two different repos produce two independently scoped _index.json updates', async () => {
    const client = createClient();
    const result = await emitGitHubAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      pullRequests: [
        {
          owner: 'acme',
          repo: 'widgets',
          number: 42,
          title: 'PR A',
          state: 'open',
          updated_at: '2026-05-12T00:00:00Z',
        },
        {
          owner: 'beta',
          repo: 'gadgets',
          number: 7,
          title: 'PR B',
          state: 'open',
          updated_at: '2026-05-11T00:00:00Z',
        },
      ],
    });
    assert.deepEqual(result.errors, []);

    const writtenPaths = client.writes.map((w) => w.path);
    // Both per-repo pulls indexes were written exactly once.
    const acmePullsIdx = githubRepoPullsIndexPath('acme', 'widgets');
    const betaPullsIdx = githubRepoPullsIndexPath('beta', 'gadgets');
    assert.ok(writtenPaths.includes(acmePullsIdx));
    assert.ok(writtenPaths.includes(betaPullsIdx));

    // Each index file holds only its own repo's row.
    const acmeRows = JSON.parse(client.files.get(acmePullsIdx)!) as Array<{
      id: string;
      number: number;
    }>;
    const betaRows = JSON.parse(client.files.get(betaPullsIdx)!) as Array<{
      id: string;
      number: number;
    }>;
    assert.deepEqual(
      acmeRows.map((r) => r.number),
      [42],
    );
    assert.deepEqual(
      betaRows.map((r) => r.number),
      [7],
    );
  });

  it('delete tombstone for a PR removes aliases + canonical meta.json AND drops the per-repo pulls _index.json row', async () => {
    const priorPayload = {
      provider: 'github',
      objectType: 'pull_request',
      objectId: '42',
      payload: {
        owner: 'acme',
        repo: 'widgets',
        number: 42,
        title: 'Doomed PR',
        state: 'closed',
      },
    };
    const priorIndex = [
      { id: '42', title: 'Doomed PR', updated: '2026-05-12T00:00:00Z', number: 42, state: 'closed' },
      { id: '99', title: 'Surviving PR', updated: '2026-05-11T00:00:00Z', number: 99, state: 'open' },
    ];

    const client = createClient({
      initialFiles: {
        [githubReposIndexPath()]: JSON.stringify([
          { id: 'acme/widgets', title: 'acme/widgets', updated: '2026-05-12T00:00:00Z' },
        ]),
        [githubByIdAliasPath('acme', 'widgets', 'pulls', 42)]: JSON.stringify(priorPayload),
        [githubRepoPullsIndexPath('acme', 'widgets')]: JSON.stringify(priorIndex),
      },
    });

    const result = await emitGitHubAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      pullRequests: [
        // Bare tombstone — repo context is recovered from the repo + pulls indexes.
        { id: '42', _deleted: true },
      ],
    });

    assert.deepEqual(result.errors, []);
    const deletedPaths = new Set(client.deletes.map((d) => d.path));

    assert.ok(deletedPaths.has(githubByIdAliasPath('acme', 'widgets', 'pulls', 42)));
    assert.ok(deletedPaths.has(githubPullRequestPath('acme', 'widgets', 42, 'Doomed PR')));
    assert.ok(deletedPaths.has(githubNumberedByTitleAliasPath('acme', 'widgets', 'pulls', 'Doomed PR', 42)));
    assert.ok(deletedPaths.has(githubByStateAliasPath('acme', 'widgets', 'pulls', 'closed', 42)));

    // No content write happened for the tombstone itself — only the index flush.
    const contentWrites = client.writes.filter(
      (w) =>
        w.path !== githubRepoPullsIndexPath('acme', 'widgets') &&
        w.path !== githubRootIndexPath(),
    );
    assert.equal(contentWrites.length, 0);

    // The pulls _index.json was rewritten and the deleted row is gone but
    // the surviving entry stays.
    const indexWrite = client.writes.find(
      (w) => w.path === githubRepoPullsIndexPath('acme', 'widgets'),
    );
    assert.ok(indexWrite, 'expected an index rewrite after delete to drop the row');
    const rows = JSON.parse(indexWrite!.content) as Array<{ id: string }>;
    assert.deepEqual(
      rows.map((r) => r.id),
      ['99'],
      'deleted PR number must not survive in the per-repo pulls index',
    );
  });

  it('index-only bare PR tombstone removes canonical and category aliases when by-id alias is missing', async () => {
    const priorIndex = [
      {
        id: '42',
        title: 'Doomed PR',
        updated: '2026-05-12T00:00:00Z',
        number: 42,
        state: 'closed',
        assigneeKeys: ['mona'],
        creatorKey: 'hubot',
        priority: 'high',
      },
      { id: '99', title: 'Surviving PR', updated: '2026-05-11T00:00:00Z', number: 99, state: 'open' },
    ];

    const client = createClient({
      initialFiles: {
        [githubReposIndexPath()]: JSON.stringify([
          { id: 'acme/widgets', title: 'acme/widgets', updated: '2026-05-12T00:00:00Z' },
        ]),
        [githubRepoPullsIndexPath('acme', 'widgets')]: JSON.stringify(priorIndex),
      },
    });

    await emitGitHubAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      pullRequests: [{ id: '42', _deleted: true }],
    });

    const deletedPaths = new Set(client.deletes.map((d) => d.path));
    assert.ok(deletedPaths.has(githubByIdAliasPath('acme', 'widgets', 'pulls', 42)));
    assert.ok(deletedPaths.has(githubPullRequestPath('acme', 'widgets', 42, 'Doomed PR')));
    assert.ok(deletedPaths.has(githubNumberedByTitleAliasPath('acme', 'widgets', 'pulls', 'Doomed PR', 42)));
    assert.ok(deletedPaths.has(githubByStateAliasPath('acme', 'widgets', 'pulls', 'closed', 42)));
    assert.ok(deletedPaths.has(githubByAssigneeAliasPath('acme', 'widgets', 'pulls', 'mona', 42)));
    assert.ok(deletedPaths.has(githubByCreatorAliasPath('acme', 'widgets', 'pulls', 'hubot', 42)));
    assert.ok(deletedPaths.has(githubByPriorityAliasPath('acme', 'widgets', 'pulls', 'high', 42)));
  });

  it('bare PR delete recovery fails fast instead of scanning every repository', async () => {
    const repoRows = Array.from({ length: 30 }, (_, index) => ({
      id: `org-${index}/repo-${index}`,
      title: `org-${index}/repo-${index}`,
      updated: '2026-05-12T00:00:00Z',
    }));
    const client = createClient({
      initialFiles: {
        [githubReposIndexPath()]: JSON.stringify(repoRows),
      },
    });

    const result = await emitGitHubAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      pullRequests: [{ id: '42', _deleted: true }],
    });

    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0]!.error, /Refusing unscoped GitHub pulls delete recovery/u);
    const repoIndexReads = client.reads.filter((r) => r.path === githubReposIndexPath());
    const perRepoReads = client.reads.filter((r) => r.path.endsWith('/pulls/_index.json'));
    assert.equal(repoIndexReads.length, 1);
    assert.equal(perRepoReads.length, 0);
  });

  it('caches unscoped numbered delete recovery reads across a batch', async () => {
    const client = createClient({
      initialFiles: {
        [githubReposIndexPath()]: JSON.stringify([
          { id: 'acme/widgets', title: 'acme/widgets', updated: '2026-05-12T00:00:00Z' },
          { id: 'beta/gadgets', title: 'beta/gadgets', updated: '2026-05-12T00:00:00Z' },
        ]),
        [githubRepoPullsIndexPath('acme', 'widgets')]: JSON.stringify([
          { id: '42', title: 'Doomed PR', updated: '2026-05-12T00:00:00Z', number: 42, state: 'closed' },
        ]),
        [githubRepoPullsIndexPath('beta', 'gadgets')]: JSON.stringify([
          { id: '7', title: 'Other doomed PR', updated: '2026-05-12T00:00:00Z', number: 7, state: 'closed' },
        ]),
      },
    });

    await emitGitHubAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      pullRequests: [
        { id: '42', _deleted: true },
        { id: '7', _deleted: true },
      ],
    });

    const readsByPath = new Map<string, number>();
    for (const read of client.reads) {
      readsByPath.set(read.path, (readsByPath.get(read.path) ?? 0) + 1);
    }
    assert.ok((readsByPath.get(githubReposIndexPath()) ?? 0) <= 2);
    assert.ok((readsByPath.get(githubRepoPullsIndexPath('acme', 'widgets')) ?? 0) <= 2);
    assert.ok((readsByPath.get(githubRepoPullsIndexPath('beta', 'gadgets')) ?? 0) <= 2);

    const deletedPaths = new Set(client.deletes.map((deleteInput) => deleteInput.path));
    assert.ok(deletedPaths.has(githubPullRequestPath('acme', 'widgets', 42, 'Doomed PR')));
    assert.ok(deletedPaths.has(githubPullRequestPath('beta', 'gadgets', 7, 'Other doomed PR')));
  });

  it('delete tombstone for an issue drops its per-repo issues index row', async () => {
    const priorPayload = {
      payload: { owner: 'acme', repo: 'widgets', number: 11, title: 'Old issue', state: 'open' },
    };
    const priorIndex = [
      { id: '11', title: 'Old issue', updated: '2026-05-12T00:00:00Z', number: 11, state: 'open' },
      { id: '22', title: 'Survivor', updated: '2026-05-11T00:00:00Z', number: 22, state: 'open' },
    ];
    const client = createClient({
      initialFiles: {
        [githubReposIndexPath()]: JSON.stringify([
          { id: 'acme/widgets', title: 'acme/widgets', updated: '2026-05-12T00:00:00Z' },
        ]),
        [githubByIdAliasPath('acme', 'widgets', 'issues', 11)]: JSON.stringify(priorPayload),
        [githubRepoIssuesIndexPath('acme', 'widgets')]: JSON.stringify(priorIndex),
      },
    });

    await emitGitHubAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      issues: [{ id: '11', _deleted: true }],
    });

    const indexWrite = client.writes.find(
      (w) => w.path === githubRepoIssuesIndexPath('acme', 'widgets'),
    );
    assert.ok(indexWrite, 'expected per-repo issues index rewrite');
    const rows = JSON.parse(indexWrite!.content) as Array<{ id: string }>;
    assert.deepEqual(rows.map((r) => r.id), ['22']);
  });

  it('repository delete tombstone removes current and legacy metadata paths and drops the global repos index row', async () => {
    const priorIndex = [
      { id: 'acme/widgets', title: 'acme/widgets', updated: '2026-05-12T00:00:00Z' },
      { id: 'beta/gadgets', title: 'beta/gadgets', updated: '2026-05-11T00:00:00Z' },
    ];
    const client = createClient({
      initialFiles: {
        [githubReposIndexPath()]: JSON.stringify(priorIndex),
      },
    });

    await emitGitHubAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      repositories: [{ id: 'acme/widgets', _deleted: true }],
    });

    const deletedPaths = client.deletes.map((d) => d.path);
    assert.ok(deletedPaths.includes(githubRepositoryMetaPath('acme', 'widgets')));
    assert.ok(deletedPaths.includes(githubRepositoryMetadataPath('acme', 'widgets')));

    const indexWrite = client.writes.find((w) => w.path === githubReposIndexPath());
    assert.ok(indexWrite, 'expected global repos index rewrite');
    const rows = JSON.parse(indexWrite!.content) as Array<{ id: string }>;
    assert.deepEqual(rows.map((r) => r.id), ['beta/gadgets']);
  });

  it('captures per-path write failures without aborting the rest of the fan-out', async () => {
    const failingPath = githubNumberedByTitleAliasPath('acme', 'widgets', 'pulls', 'Add darkmode toggle', 42);
    const client = createClient({ failWriteOn: new Set([failingPath]) });

    const result = await emitGitHubAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      pullRequests: [
        {
          owner: 'acme',
          repo: 'widgets',
          number: 42,
          title: 'Add darkmode toggle',
          state: 'open',
        },
      ],
    });

    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0]!.path, failingPath);
    assert.match(result.errors[0]!.error, /forced write failure/);

    // The remaining aliases still landed, including by-id (the anchor).
    assert.ok(client.files.has(githubByIdAliasPath('acme', 'widgets', 'pulls', 42)));
    assert.ok(client.files.has(githubPullRequestPath('acme', 'widgets', 42, 'Add darkmode toggle')));
    assert.ok(client.files.has(githubRepoPullsIndexPath('acme', 'widgets')));
  });

  it('skips reconciliation but still emits new aliases when the client has no readFile', async () => {
    const client = createClient({ noRead: true });

    const result = await emitGitHubAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      pullRequests: [
        {
          owner: 'acme',
          repo: 'widgets',
          number: 42,
          title: 'Add darkmode toggle',
          state: 'open',
        },
      ],
    });

    assert.deepEqual(result.errors, []);
    // No reconciliation deletes because the reader is degraded.
    assert.equal(client.deletes.length, 0);

    const writtenPaths = client.writes.map((w) => w.path);
    assert.ok(writtenPaths.includes(githubByIdAliasPath('acme', 'widgets', 'pulls', 42)));
    assert.ok(writtenPaths.includes(githubNumberedByTitleAliasPath('acme', 'widgets', 'pulls', 'Add darkmode toggle', 42)));
  });

  it('extracts owner/repo from full_name when explicit owner/repo are absent', async () => {
    const client = createClient();
    await emitGitHubAuxiliaryFiles(client, {
      workspaceId: 'ws-1',
      // `full_name` is a fallback path for callers that pass raw GitHub
      // payloads through unchanged. The optional owner/repo on the record
      // type lets us omit them when full_name carries the same info.
      pullRequests: [
        {
          full_name: 'acme/widgets',
          number: 7,
          title: 'Implicit repo',
          state: 'open',
        },
      ],
    });
    const writtenPaths = client.writes.map((w) => w.path);
    assert.ok(writtenPaths.includes(githubPullRequestPath('acme', 'widgets', 7, 'Implicit repo')));
  });
});
