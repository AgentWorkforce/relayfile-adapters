export type BitbucketModel = 'repository' | 'project' | 'pull-request' | 'issue' | 'commit' | 'pipeline' | 'deployment' | 'tag';

const models: Record<string, BitbucketModel> = {
  bitbucketrepository: 'repository', repository: 'repository',
  bitbucketproject: 'project', project: 'project',
  bitbucketpullrequest: 'pull-request', pullrequest: 'pull-request', 'pull-request': 'pull-request',
  bitbucketissue: 'issue', issue: 'issue', bitbucketcommit: 'commit', commit: 'commit',
  bitbucketpipeline: 'pipeline', pipeline: 'pipeline', bitbucketdeployment: 'deployment', deployment: 'deployment',
  bitbuckettag: 'tag', tag: 'tag',
};

const collections: Record<BitbucketModel, string> = {
  repository: '', project: 'projects', 'pull-request': 'pull-requests', issue: 'issues', commit: 'commits', pipeline: 'pipelines', deployment: 'deployments', tag: 'tags',
};

export function normalizeNangoBitbucketModel(model: string): BitbucketModel | null {
  return models[model.trim().toLowerCase().replace(/[_\s]/gu, '')] ?? null;
}

function segment(value: string): string {
  if (!value.trim() || value === '.' || value === '..') throw new Error('Invalid Bitbucket path segment');
  return encodeURIComponent(value.trim());
}

export function bitbucketRepositoryPrefix(repository: string): string {
  const [workspace, slug, ...rest] = repository.split('/');
  if (!workspace || !slug || rest.length) throw new Error('Bitbucket repository must be workspace/slug');
  return `/bitbucket/repositories/${segment(workspace)}/${segment(slug)}`;
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : typeof value === 'number' ? String(value) : undefined;
}

function nestedStringField(record: Record<string, unknown>, parent: string, key: string): string | undefined {
  const value = record[parent];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? stringField(value as Record<string, unknown>, key) : undefined;
}

function fieldLabel(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const fields = value as Record<string, unknown>;
  return ['nickname', 'name', 'display_name', 'slug', 'uuid', 'account_id', 'type']
    .map((key) => stringField(fields, key)).find(Boolean);
}

export function computeBitbucketPath(model: string, record: Record<string, unknown>): string {
  const type = normalizeNangoBitbucketModel(model);
  if (!type) throw new Error(`Unsupported Bitbucket model: ${model}`);
  if (type === 'project') {
    const workspace = stringField(record, 'workspace') ?? nestedStringField(record, 'workspace', 'slug');
    const key = stringField(record, 'key');
    if (!workspace || !key) throw new Error('Missing Bitbucket project context');
    return `/bitbucket/workspaces/${segment(workspace)}/projects/${segment(key)}.json`;
  }
  const workspace = stringField(record, 'workspace') ?? nestedStringField(record, 'workspace', 'slug');
  const repository = stringField(record, 'repository') ?? nestedStringField(record, 'repository', 'full_name') ??
    stringField(record, 'full_name') ??
    (workspace && stringField(record, 'repo_slug') ? `${workspace}/${stringField(record, 'repo_slug')}` : undefined);
  if (!repository) throw new Error('Missing Bitbucket repository context');
  const prefix = bitbucketRepositoryPrefix(repository);
  if (type === 'repository') return `${prefix}/meta.json`;
  const id = type === 'pull-request' ? stringField(record, 'pullrequest_id') :
    type === 'issue' ? stringField(record, 'issue_id') :
    type === 'commit' ? stringField(record, 'hash') :
    type === 'tag' ? stringField(record, 'name') : stringField(record, 'uuid') ?? stringField(record, 'id');
  if (!id) throw new Error(`Missing Bitbucket ${type} id`);
  return `${prefix}/${collections[type]}/${segment(id)}.json`;
}

export function bitbucketLookupAliasPaths(model: string, record: Record<string, unknown>): string[] {
  const type = normalizeNangoBitbucketModel(model);
  if (!type) throw new Error(`Unsupported Bitbucket model: ${model}`);
  const id = stringField(record, 'id');
  if (!id) throw new Error('Missing Bitbucket record id');
  const collection = type === 'pull-request' ? 'pull-requests' : `${type}s`;
  const buckets: [string, string | undefined][] = type === 'pull-request' || type === 'issue'
    ? [
      ['by-state', fieldLabel(record.state)],
      ['by-assignee', fieldLabel(record.assignee)],
      ['by-creator', fieldLabel(record.author) ?? fieldLabel(record.reporter)],
      ['by-priority', fieldLabel(record.priority)],
    ]
    : type === 'pipeline' || type === 'deployment'
      ? [['by-status', fieldLabel(record.status) ?? fieldLabel(record.state)]]
      : [];
  return buckets.flatMap(([bucket, value]) => value
    ? [`/bitbucket/${collection}/${bucket}/${segment(slugifyAlias(value))}/${segment(id)}.json`]
    : []);
}

export function bitbucketByIdPath(model: string, record: Record<string, unknown>): string {
  const type = normalizeNangoBitbucketModel(model);
  if (!type) throw new Error(`Unsupported Bitbucket model: ${model}`);
  const id = String(record.id ?? '');
  if (!id) throw new Error('Missing Bitbucket record id');
  const collection = type === 'repository' ? 'repositories' : collections[type];
  return `/bitbucket/${collection}/by-id/${segment(id)}.json`;
}
import { slugifyAlias } from '@relayfile/adapter-core';
