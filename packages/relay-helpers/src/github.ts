import type { IntegrationClientOptions } from '@relayfile/adapter-core/vfs-client';
import { providerClient, type ProviderClient } from './provider-client.js';
import { created } from './receipt.js';

export interface GithubTarget {
  owner: string;
  repo: string;
  number: number;
}

export interface GithubClient extends ProviderClient<'github'> {
  /** Comment on an issue or pull request. */
  comment(target: GithubTarget, body: string): Promise<{ id: string; url: string }>;
  /** Create an issue. */
  createIssue(args: {
    owner: string;
    repo: string;
    title: string;
    body: string;
    labels?: string[];
  }): Promise<{ id: string; url: string }>;
  /** Create a pull request from a branch already present on GitHub. */
  createPullRequest(args: {
    owner: string;
    repo: string;
    title: string;
    head: string;
    base: string;
    body?: string;
    draft?: boolean;
    author?: 'app' | 'user';
  }): Promise<{ id: string; url: string }>;
  /** Create or update a Git ref. */
  pushRef(args: {
    owner: string;
    repo: string;
    ref: string;
    sha: string;
    update?: boolean;
    force?: boolean;
  }): Promise<void>;
  /** Close a pull request without merging it. */
  closePullRequest(target: GithubTarget): Promise<void>;
  /**
   * Merge a pull request. (Named `mergePullRequest`, not `merge`, because
   * `merge` is the catalog resource key exposed as `.merge`.)
   */
  mergePullRequest(args: {
    owner: string;
    repo: string;
    number: number;
    method?: 'merge' | 'squash' | 'rebase';
    commitTitle?: string;
    commitMessage?: string;
    sha?: string;
  }): Promise<{ merged: boolean; sha?: string }>;
  /** Post a review on a pull request. */
  review(
    target: GithubTarget,
    args: {
      body: string;
      event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES';
      comments?: Array<{ path: string; line: number; body: string }>;
    }
  ): Promise<void>;
}

/**
 * Ergonomic GitHub client over the writeback-path catalog, plus the uniform
 * resource-keyed access (`.issues`, `.["issue-comments"]`, `.merge`, `.reviews`).
 */
export function githubClient(opts: IntegrationClientOptions = {}): GithubClient {
  const base = providerClient('github', opts);
  return Object.assign(base, {
    async comment(target: GithubTarget, body: string) {
      return created(
        await base['issue-comments'].write(
          { owner: target.owner, repo: target.repo, issueNumber: target.number },
          { body }
        )
      );
    },
    async createIssue(args: { owner: string; repo: string; title: string; body: string; labels?: string[] }) {
      return created(
        await base.issues.write(
          { owner: args.owner, repo: args.repo },
          { title: args.title, body: args.body, ...(args.labels ? { labels: args.labels } : {}) }
        )
      );
    },
    async createPullRequest(args: {
      owner: string;
      repo: string;
      title: string;
      head: string;
      base: string;
      body?: string;
      draft?: boolean;
      author?: 'app' | 'user';
    }) {
      return created(
        await base['pull-requests'].write(
          { owner: args.owner, repo: args.repo },
          {
            title: args.title,
            head: args.head,
            base: args.base,
            ...(args.body !== undefined ? { body: args.body } : {}),
            ...(args.draft !== undefined ? { draft: args.draft } : {}),
            ...(args.author !== undefined ? { author: args.author } : {})
          }
        )
      );
    },
    async pushRef(args: {
      owner: string;
      repo: string;
      ref: string;
      sha: string;
      update?: boolean;
      force?: boolean;
    }) {
      await base.refs.write(
        { owner: args.owner, repo: args.repo },
        {
          ref: args.ref,
          sha: args.sha,
          ...(args.update !== undefined ? { update: args.update } : {}),
          ...(args.force !== undefined ? { force: args.force } : {})
        }
      );
    },
    async closePullRequest(target: GithubTarget) {
      await base['close-pull-request'].write(
        { owner: target.owner, repo: target.repo, pullNumber: target.number },
        {}
      );
    },
    async mergePullRequest(args: {
      owner: string;
      repo: string;
      number: number;
      method?: 'merge' | 'squash' | 'rebase';
      commitTitle?: string;
      commitMessage?: string;
      sha?: string;
    }) {
      const result = await base.merge.write(
        { owner: args.owner, repo: args.repo, pullNumber: args.number },
        {
          ...(args.method !== undefined ? { merge_method: args.method } : {}),
          ...(args.commitTitle !== undefined ? { commit_title: args.commitTitle } : {}),
          ...(args.commitMessage !== undefined ? { commit_message: args.commitMessage } : {}),
          ...(args.sha !== undefined ? { sha: args.sha } : {})
        }
      );
      const sha =
        typeof result.receipt?.sha === 'string'
          ? result.receipt.sha
          : typeof result.receipt?.id === 'string'
            ? result.receipt.id
            : undefined;
      const merged = result.receipt?.merged;
      return {
        merged: merged === true || merged === 'true' || (merged === undefined && Boolean(sha)),
        ...(sha ? { sha } : {})
      };
    },
    async review(
      target: GithubTarget,
      args: {
        body: string;
        event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES';
        comments?: Array<{ path: string; line: number; body: string }>;
      }
    ) {
      await base.reviews.write(
        { owner: target.owner, repo: target.repo, pullNumber: target.number },
        { ...args, comments: args.comments ?? [] }
      );
    }
  }) as GithubClient;
}
