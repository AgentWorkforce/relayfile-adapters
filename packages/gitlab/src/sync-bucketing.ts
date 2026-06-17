import {
  basicTombstone,
  cleanBucketRecord,
  isDeletedSyncRecord,
  isRecordObject,
  mapToBucket,
  modelBucket,
  normalizeModelKey,
  readBucketId,
} from '@relayfile/adapter-core/sync-bucketing';

type GitLabBucketObjectType =
  | 'project'
  | 'merge_requests'
  | 'issues'
  | 'commits'
  | 'pipelines'
  | 'deployments'
  | 'tags'
  | 'pipeline_jobs';

export const syncRecordBucketing = modelBucket<GitLabBucketObjectType>({
  normalizeModel: normalizeGitLabBucketModel,
  buckets: {
    project: 'projects',
    merge_requests: 'mergeRequests',
    issues: 'issues',
    commits: 'commits',
    pipelines: 'pipelines',
    deployments: 'deployments',
    tags: 'tags',
  },
  mapRecords(records, { modelType }) {
    if (modelType === 'project') {
      return mapToBucket(records, basicTombstone);
    }

    const mapped: Record<string, unknown>[] = [];
    for (const raw of records) {
      if (!isDeletedSyncRecord(raw)) {
        mapped.push(cleanBucketRecord(raw));
        continue;
      }

      const cleaned = cleanBucketRecord(raw);
      if (modelType === 'commits') {
        const sha = readBucketId(cleaned, 'sha') ?? readBucketId(cleaned, 'id');
        if (sha) mapped.push(gitLabTombstoneWithScope(cleaned, 'sha', sha));
        continue;
      }

      if (modelType === 'tags') {
        const ref =
          readBucketId(cleaned, 'ref') ??
          readBucketId(cleaned, 'name') ??
          readBucketId(cleaned, 'id');
        if (ref) mapped.push(gitLabTombstoneWithScope(cleaned, 'ref', ref));
        continue;
      }

      if (modelType === 'pipeline_jobs') {
        mapped.push(cleaned);
        continue;
      }

      const id =
        modelType === 'pipelines' || modelType === 'deployments'
          ? readBucketId(cleaned, 'id') ?? readBucketId(cleaned, 'iid')
          : readBucketId(cleaned, 'iid') ?? readBucketId(cleaned, 'id');
      if (id) {
        mapped.push(
          gitLabTombstoneWithScope(
            cleaned,
            modelType === 'pipelines' || modelType === 'deployments' ? 'id' : 'iid',
            id,
          ),
        );
      }
    }
    return mapped;
  },
});

function normalizeGitLabBucketModel(model: string): GitLabBucketObjectType | null {
  switch (normalizeModelKey(model)) {
    case 'gitlabproject':
    case 'project':
      return 'project';
    case 'gitlabmergerequest':
    case 'mergerequest':
    case 'merge_request':
    case 'merge_requests':
      return 'merge_requests';
    case 'gitlabissue':
    case 'issue':
    case 'issues':
      return 'issues';
    case 'gitlabcommit':
    case 'commit':
    case 'commits':
      return 'commits';
    case 'gitlabpipeline':
    case 'pipeline':
    case 'pipelines':
      return 'pipelines';
    case 'gitlabdeployment':
    case 'deployment':
    case 'deployments':
      return 'deployments';
    case 'gitlabtag':
    case 'tag':
    case 'tags':
      return 'tags';
    case 'gitlabpipelinejob':
    case 'pipelinejob':
    case 'pipeline_job':
    case 'pipeline_jobs':
    case 'job':
    case 'jobs':
      return 'pipeline_jobs';
    default:
      return null;
  }
}

function gitLabTombstoneWithScope(
  record: Record<string, unknown>,
  idKey: 'id' | 'iid' | 'ref' | 'sha',
  id: string,
): Record<string, unknown> {
  const tombstone: Record<string, unknown> = { [idKey]: id, _deleted: true };
  for (const key of [
    'project_path',
    'projectPath',
    'path_with_namespace',
    'project_id',
    'web_url',
    'url',
    'title',
    'name',
    'state',
    'status',
    'ref',
    'sha',
    'target',
    'environment_name',
    'environment',
    'pipeline_id',
    'assignees',
    'author',
    'labels',
    'priority',
  ]) {
    if (record[key] !== undefined) {
      tombstone[key] = record[key];
    }
  }
  if (isRecordObject(record.project)) {
    tombstone.project = record.project;
  }
  return tombstone;
}
