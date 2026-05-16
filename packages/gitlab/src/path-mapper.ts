import { computeCanonicalPath } from '@relayfile/sdk';

import { aliasCollisionSuffix, slugifyAlias } from './alias-slug.js';

export type GitLabResourceType =
  | 'commits'
  | 'deployments'
  | 'files'
  | 'issues'
  | 'merge_requests'
  | 'pipelines'
  | 'snippets'
  | 'tags';

export type GitLabDirectoryResourceType = 'commits' | 'issues' | 'merge_requests' | 'pipelines';
export type GitLabFlatResourceType = 'deployments' | 'tags';
export type GitLabIndexedResourceType = GitLabDirectoryResourceType | GitLabFlatResourceType;
export type GitLabTitledResourceType = 'commits' | 'issues' | 'merge_requests';
export type GitLabStatefulResourceType = 'issues' | 'merge_requests';

export interface GitLabPathContext {
  ref?: string | null;
  slug?: string | null;
  title?: string | null;
}

const RESOURCE_SEGMENTS = new Set<GitLabResourceType>([
  'commits',
  'deployments',
  'files',
  'issues',
  'merge_requests',
  'pipelines',
  'snippets',
  'tags',
]);

const DIRECTORY_RESOURCES = new Set<GitLabResourceType>([
  'commits',
  'issues',
  'merge_requests',
  'pipelines',
]);

const FLAT_RESOURCES = new Set<GitLabResourceType>([
  'deployments',
  'tags',
]);

export interface ParsedGitLabPath {
  objectType: GitLabResourceType;
  objectId: string;
  path: string;
  projectPath: string;
  subResource?: string;
  subResourceId?: string;
}

export function encodeGitLabPathSegment(value: string): string {
  return encodeURIComponent(value);
}

function assertNonEmptySegment(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return trimmed;
}

export function encodeProjectPath(projectPath: string): string {
  return projectPath
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

export function decodeProjectPath(projectPath: string): string {
  return projectPath
    .split('/')
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment))
    .join('/');
}

export function gitLabRootIndexPath(): string {
  return '/gitlab/_index.json';
}

export function gitLabProjectsIndexPath(): string {
  return '/gitlab/projects/_index.json';
}

export function gitLabProjectPrefix(projectPath: string): string {
  return `/gitlab/projects/${encodeProjectPath(projectPath)}`;
}

export function gitLabProjectResourceIndexPath(
  projectPath: string,
  objectType: GitLabIndexedResourceType,
): string {
  return `${gitLabProjectPrefix(projectPath)}/${objectType}/_index.json`;
}

export function gitLabRecordDirectorySegment(
  objectId: number | string,
  title?: string | null,
): string {
  const id = String(objectId).trim();
  if (id.includes('__')) {
    return id;
  }
  const slug = title ? slugifyAlias(title) : '';
  return slug ? `${encodeGitLabPathSegment(id)}__${encodeGitLabPathSegment(slug)}` : encodeGitLabPathSegment(id);
}

export function gitLabFlatRecordFilename(
  objectId: number | string,
  title?: string | null,
): string {
  const id = String(objectId).trim().replace(/\.json$/, '');
  if (!title && isComposedFlatRecordFilename(id)) {
    return `${id}.json`;
  }
  const slug = title ? slugifyAlias(title) : slugifyAlias(id);
  if (!slug || slug === 'untitled' || slug === id) {
    return `${encodeGitLabPathSegment(id)}.json`;
  }
  return `${encodeGitLabPathSegment(slug)}__${encodeGitLabPathSegment(id)}.json`;
}

function isComposedFlatRecordFilename(value: string): boolean {
  const separatorIndex = value.indexOf('__');
  if (separatorIndex <= 0) {
    return false;
  }
  const slug = value.slice(0, separatorIndex);
  const encodedId = value.slice(separatorIndex + 2);
  try {
    return slug === slugifyAlias(decodeURIComponent(encodedId));
  } catch {
    return false;
  }
}

export function gitLabByIdAliasPath(
  projectPath: string,
  objectType: GitLabIndexedResourceType,
  objectId: number | string,
): string {
  return `${gitLabProjectPrefix(projectPath)}/${objectType}/by-id/${encodeGitLabPathSegment(String(objectId))}.json`;
}

export function gitLabByTitleAliasPath(
  projectPath: string,
  objectType: GitLabTitledResourceType,
  title: string,
  objectId: number | string,
  colliding = false,
): string {
  const slug = slugifyAlias(title);
  const suffix = colliding ? `-${aliasCollisionSuffix(String(objectId))}` : '';
  return `${gitLabProjectPrefix(projectPath)}/${objectType}/by-title/${encodeGitLabPathSegment(
    `${slug}${suffix}__${String(objectId)}`,
  )}.json`;
}

export function gitLabByStateAliasPath(
  projectPath: string,
  objectType: GitLabStatefulResourceType,
  state: string,
  objectId: number | string,
): string {
  const normalizedState = assertNonEmptySegment(state, 'state');
  return `${gitLabProjectPrefix(projectPath)}/${objectType}/by-state/${encodeGitLabPathSegment(
    slugifyAlias(normalizedState),
  )}/${encodeGitLabPathSegment(String(objectId))}.json`;
}

export function gitLabByAssigneeAliasPath(
  projectPath: string,
  objectType: GitLabStatefulResourceType,
  assignee: string,
  objectId: number | string,
): string {
  const normalizedAssignee = assertNonEmptySegment(assignee, 'assignee');
  return `${gitLabProjectPrefix(projectPath)}/${objectType}/by-assignee/${encodeGitLabPathSegment(
    slugifyAlias(normalizedAssignee),
  )}/${encodeGitLabPathSegment(String(objectId))}.json`;
}

export function gitLabByCreatorAliasPath(
  projectPath: string,
  objectType: GitLabStatefulResourceType,
  creator: string,
  objectId: number | string,
): string {
  const normalizedCreator = assertNonEmptySegment(creator, 'creator');
  return `${gitLabProjectPrefix(projectPath)}/${objectType}/by-creator/${encodeGitLabPathSegment(
    slugifyAlias(normalizedCreator),
  )}/${encodeGitLabPathSegment(String(objectId))}.json`;
}

export function gitLabByPriorityAliasPath(
  projectPath: string,
  objectType: GitLabStatefulResourceType,
  priority: string,
  objectId: number | string,
): string {
  const normalizedPriority = assertNonEmptySegment(priority, 'priority');
  return `${gitLabProjectPrefix(projectPath)}/${objectType}/by-priority/${encodeGitLabPathSegment(
    slugifyAlias(normalizedPriority),
  )}/${encodeGitLabPathSegment(String(objectId))}.json`;
}

export function gitLabByRefAliasPath(
  projectPath: string,
  objectType: 'pipelines' | 'tags',
  ref: string,
  objectId: number | string,
  colliding = false,
): string {
  const slug = slugifyAlias(ref);
  const suffix = colliding ? `-${aliasCollisionSuffix(String(objectId))}` : '';
  return `${gitLabProjectPrefix(projectPath)}/${objectType}/by-ref/${encodeGitLabPathSegment(
    `${slug}${suffix}__${String(objectId)}`,
  )}.json`;
}

export function gitLabByStatusAliasPath(
  projectPath: string,
  objectType: 'pipelines' | 'deployments',
  status: string,
  objectId: number | string,
): string {
  return `${gitLabProjectPrefix(projectPath)}/${objectType}/by-status/${encodeGitLabPathSegment(
    slugifyAlias(status),
  )}/${encodeGitLabPathSegment(String(objectId))}.json`;
}

export function computeMetadataPath(
  projectPath: string,
  objectType: Exclude<GitLabResourceType, 'files'>,
  objectId: number | string,
  title?: string | null,
): string {
  if (DIRECTORY_RESOURCES.has(objectType)) {
    return `${gitLabProjectPrefix(projectPath)}/${objectType}/${gitLabRecordDirectorySegment(objectId, title)}/meta.json`;
  }
  if (FLAT_RESOURCES.has(objectType)) {
    return `${gitLabProjectPrefix(projectPath)}/${objectType}/${gitLabFlatRecordFilename(objectId, title)}`;
  }
  return `${gitLabProjectPrefix(projectPath)}/${objectType}/${encodeGitLabPathSegment(String(objectId))}.json`;
}

export function computeMergeRequestDiffPath(
  projectPath: string,
  iid: number | string,
  title?: string | null,
): string {
  return `${gitLabProjectPrefix(projectPath)}/merge_requests/${gitLabRecordDirectorySegment(iid, title)}/diff.patch`;
}

export function computeMergeRequestDiscussionPath(
  projectPath: string,
  iid: number | string,
  discussionId: string,
  title?: string | null,
): string {
  return `${gitLabProjectPrefix(projectPath)}/merge_requests/${gitLabRecordDirectorySegment(
    iid,
    title,
  )}/discussions/${encodeGitLabPathSegment(discussionId)}.json`;
}

export function computeMergeRequestApprovalsPath(
  projectPath: string,
  iid: number | string,
  title?: string | null,
): string {
  return `${gitLabProjectPrefix(projectPath)}/merge_requests/${gitLabRecordDirectorySegment(iid, title)}/approvals.json`;
}

export function computePipelineJobPath(
  projectPath: string,
  pipelineId: number | string,
  jobId: number | string,
  ref?: string | null,
): string {
  return `${gitLabProjectPrefix(projectPath)}/pipelines/${gitLabRecordDirectorySegment(
    pipelineId,
    ref,
  )}/jobs/${encodeGitLabPathSegment(String(jobId))}.json`;
}

export function computeIssueCommentPath(
  projectPath: string,
  iid: number | string,
  noteId: number | string,
  title?: string | null,
): string {
  return `${gitLabProjectPrefix(projectPath)}/issues/${gitLabRecordDirectorySegment(
    iid,
    title,
  )}/comments/${encodeGitLabPathSegment(String(noteId))}.json`;
}

export function computeCommitCommentPath(
  projectPath: string,
  sha: string,
  noteId: number | string,
  title?: string | null,
): string {
  return `${gitLabProjectPrefix(projectPath)}/commits/${gitLabRecordDirectorySegment(
    sha,
    title,
  )}/comments/${encodeGitLabPathSegment(String(noteId))}.json`;
}

export function computeSnippetCommentPath(
  projectPath: string,
  snippetId: number | string,
  noteId: number | string,
): string {
  return `${gitLabProjectPrefix(projectPath)}/snippets/${encodeGitLabPathSegment(
    String(snippetId),
  )}/comments/${encodeGitLabPathSegment(String(noteId))}.json`;
}

export function parseGitLabPath(path: string): ParsedGitLabPath | null {
  const segments = path.split('/').filter(Boolean);
  if (segments[0] !== 'gitlab' || segments[1] !== 'projects') {
    return null;
  }

  const objectIndex = gitLabResourceSegmentIndex(segments);
  if (objectIndex === -1 || objectIndex >= segments.length - 1) {
    return null;
  }

  const projectPath = decodeProjectPath(segments.slice(2, objectIndex).join('/'));
  const objectType = segments[objectIndex] as GitLabResourceType;
  const rawObjectSegment = segments[objectIndex + 1] ?? '';
  const remainder = segments.slice(objectIndex + 2);
  const objectId = decodeObjectId(objectType, rawObjectSegment);
  const subResource = remainder.length > 0 ? remainder[0] : undefined;
  const subResourceId =
    remainder.length > 1 ? decodeURIComponent(remainder[1].replace(/\.json$/, '')) : undefined;

  return {
    path,
    projectPath,
    objectType,
    objectId,
    subResource,
    subResourceId,
  };
}

function gitLabResourceSegmentIndex(segments: readonly string[]): number {
  for (let index = segments.length - 2; index > 1; index -= 1) {
    const segment = segments[index];
    if (segment && RESOURCE_SEGMENTS.has(segment as GitLabResourceType)) {
      return index;
    }
  }
  return -1;
}

export function computeGitLabPath(
  objectType: string,
  objectId: string,
  context: GitLabPathContext = {},
): string {
  const jsonlessObjectId = objectId.replace(/\.json$/, '');

  if (objectType === 'jobs') {
    const match = jsonlessObjectId.match(/^(.*)\/pipelines\/([^/]+)\/jobs\/([^/]+)$/);
    if (match) {
      return computePipelineJobPath(
        match[1],
        decodeParentResourceSegment(match[2]),
        decodeURIComponent(match[3]),
        refPathContext(context),
      );
    }
  }

  if (objectType === 'discussions') {
    const match = jsonlessObjectId.match(/^(.*)\/merge_requests\/([^/]+)\/discussions\/([^/]+)$/);
    if (match) {
      return computeMergeRequestDiscussionPath(
        match[1],
        decodeParentResourceSegment(match[2]),
        decodeURIComponent(match[3]),
        titlePathContext(context),
      );
    }
  }

  if (objectType === 'issue_notes') {
    const match = jsonlessObjectId.match(/^(.*)\/issues\/([^/]+)\/comments\/([^/]+)$/);
    if (match) {
      return computeIssueCommentPath(
        match[1],
        decodeParentResourceSegment(match[2]),
        decodeURIComponent(match[3]),
        titlePathContext(context),
      );
    }
  }

  if (objectType === 'commit_notes') {
    const match = jsonlessObjectId.match(/^(.*)\/commits\/([^/]+)\/comments\/([^/]+)$/);
    if (match) {
      return computeCommitCommentPath(
        match[1],
        decodeParentResourceSegment(match[2]),
        decodeURIComponent(match[3]),
        titlePathContext(context),
      );
    }
  }

  if (objectType === 'snippet_notes') {
    const match = jsonlessObjectId.match(/^(.*)\/snippets\/([^/]+)\/comments\/([^/]+)$/);
    if (match) {
      return computeSnippetCommentPath(match[1], decodeURIComponent(match[2]), decodeURIComponent(match[3]));
    }
  }

  if (!objectId.includes('/')) {
    return computeCanonicalPath('gitlab', objectType, objectId);
  }

  const markerIndex = gitLabObjectIdResourceMarkerIndex(objectType, objectId, context);
  if (markerIndex === -1) {
    return computeCanonicalPath('gitlab', objectType, objectId);
  }

  const marker = `/${objectType}/`;
  const projectPath = objectId.slice(0, markerIndex);
  const resourceId = objectId.slice(markerIndex + marker.length);

  switch (objectType) {
    case 'merge_requests':
      return computeMetadataPath(projectPath, 'merge_requests', resourceId, titlePathContext(context));
    case 'issues':
      return computeMetadataPath(projectPath, 'issues', resourceId, titlePathContext(context));
    case 'commits':
      return computeMetadataPath(projectPath, 'commits', resourceId, titlePathContext(context));
    case 'pipelines':
      return computeMetadataPath(projectPath, 'pipelines', resourceId, refPathContext(context));
    case 'deployments':
      return computeMetadataPath(projectPath, 'deployments', resourceId);
    case 'tags':
      return computeMetadataPath(projectPath, 'tags', resourceId, refPathContext(context));
    default:
      return computeCanonicalPath('gitlab', objectType, objectId);
  }
}

function gitLabObjectIdResourceMarkerIndex(
  objectType: string,
  objectId: string,
  context: GitLabPathContext,
): number {
  const marker = `/${objectType}/`;
  const indices: number[] = [];
  let offset = objectId.indexOf(marker);
  while (offset !== -1) {
    indices.push(offset);
    offset = objectId.indexOf(marker, offset + marker.length);
  }
  if (indices.length === 0) {
    return -1;
  }

  if (objectType === 'tags') {
    const ref = refPathContext(context);
    if (ref) {
      const exactRefIndex = indices.find((index) => objectId.slice(index + marker.length) === ref);
      if (exactRefIndex !== undefined) {
        return exactRefIndex;
      }
    }

    const gitRefPrefix = 'refs/tags/';
    const gitRefIndex = indices.find((index) => objectId.slice(index + marker.length).startsWith(gitRefPrefix));
    if (gitRefIndex !== undefined) {
      return gitRefIndex;
    }
  }

  return indices[indices.length - 1] ?? -1;
}

function decodeParentResourceSegment(segment: string): string {
  return segment.includes('__') ? segment : decodeURIComponent(segment);
}

function titlePathContext(context: GitLabPathContext): string | null | undefined {
  return context.title ?? context.slug;
}

function refPathContext(context: GitLabPathContext): string | null | undefined {
  return context.ref ?? context.slug;
}

function decodeObjectId(objectType: GitLabResourceType, segment: string): string {
  if (DIRECTORY_RESOURCES.has(objectType)) {
    return decodeDirectoryObjectId(segment);
  }
  if (FLAT_RESOURCES.has(objectType)) {
    return decodeFlatObjectId(segment);
  }
  return decodeURIComponent(segment);
}

function decodeDirectoryObjectId(segment: string): string {
  const decoded = decodeURIComponent(segment);
  const separatorIndex = decoded.indexOf('__');
  return separatorIndex > 0 ? decoded.slice(0, separatorIndex) : decoded;
}

function decodeFlatObjectId(segment: string): string {
  const basename = segment.replace(/\.json$/, '');
  const separatorIndex = basename.indexOf('__');
  const id = separatorIndex > 0 ? basename.slice(separatorIndex + 2) : basename;
  return decodeURIComponent(id);
}
