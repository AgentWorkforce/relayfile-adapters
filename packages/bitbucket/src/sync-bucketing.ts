import { modelBucket, literalModelNormalizer } from '@relayfile/adapter-core/sync-bucketing';

export const bitbucketRecordBucketing = modelBucket({
  normalizeModel: literalModelNormalizer({
    BitbucketRepository: 'repository', BitbucketProject: 'project', BitbucketPullRequest: 'pull-request', BitbucketIssue: 'issue',
    BitbucketCommit: 'commit', BitbucketPipeline: 'pipeline', BitbucketDeployment: 'deployment', BitbucketTag: 'tag',
  }),
  buckets: {
    repository: 'repositories', project: 'projects', 'pull-request': 'pull-requests', issue: 'issues', commit: 'commits',
    pipeline: 'pipelines', deployment: 'deployments', tag: 'tags',
  },
});
