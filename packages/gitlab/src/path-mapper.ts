import { computeCanonicalPath } from '@relayfile/sdk';

export type GitLabResourceType =
  | 'commits'
  | 'deployments'
  | 'files'
  | 'issues'
  | 'merge_requests'
  | 'pipelines'
  | 'snippets'
  | 'tags';

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

export interface ParsedGitLabPath {
  objectType: GitLabResourceType;
  objectId: string;
  path: string;
  projectPath: string;
  subResource?: string;
  subResourceId?: string;
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

export function computeMetadataPath(
  projectPath: string,
  objectType: Exclude<GitLabResourceType, 'files'>,
  objectId: number | string,
): string {
  return `/gitlab/projects/${encodeProjectPath(projectPath)}/${objectType}/${encodeURIComponent(
    String(objectId),
  )}/metadata.json`;
}

export function computeMergeRequestDiffPath(projectPath: string, iid: number | string): string {
  return `/gitlab/projects/${encodeProjectPath(projectPath)}/merge_requests/${encodeURIComponent(
    String(iid),
  )}/diff.patch`;
}

export function computeMergeRequestDiscussionPath(
  projectPath: string,
  iid: number | string,
  discussionId: string,
): string {
  return `/gitlab/projects/${encodeProjectPath(projectPath)}/merge_requests/${encodeURIComponent(
    String(iid),
  )}/discussions/${encodeURIComponent(discussionId)}.json`;
}

export function computeMergeRequestApprovalsPath(
  projectPath: string,
  iid: number | string,
): string {
  return `/gitlab/projects/${encodeProjectPath(projectPath)}/merge_requests/${encodeURIComponent(
    String(iid),
  )}/approvals.json`;
}

export function computePipelineJobPath(
  projectPath: string,
  pipelineId: number | string,
  jobId: number | string,
): string {
  return `/gitlab/projects/${encodeProjectPath(projectPath)}/pipelines/${encodeURIComponent(
    String(pipelineId),
  )}/jobs/${encodeURIComponent(String(jobId))}.json`;
}

export function computeIssueCommentPath(
  projectPath: string,
  iid: number | string,
  noteId: number | string,
): string {
  return `/gitlab/projects/${encodeProjectPath(projectPath)}/issues/${encodeURIComponent(
    String(iid),
  )}/comments/${encodeURIComponent(String(noteId))}.json`;
}

export function computeCommitCommentPath(
  projectPath: string,
  sha: string,
  noteId: number | string,
): string {
  return `/gitlab/projects/${encodeProjectPath(projectPath)}/commits/${encodeURIComponent(
    sha,
  )}/comments/${encodeURIComponent(String(noteId))}.json`;
}

export function computeSnippetCommentPath(
  projectPath: string,
  snippetId: number | string,
  noteId: number | string,
): string {
  return `/gitlab/projects/${encodeProjectPath(projectPath)}/snippets/${encodeURIComponent(
    String(snippetId),
  )}/comments/${encodeURIComponent(String(noteId))}.json`;
}

export function parseGitLabPath(path: string): ParsedGitLabPath | null {
  const segments = path.split('/').filter(Boolean);
  if (segments[0] !== 'gitlab' || segments[1] !== 'projects') {
    return null;
  }

  const objectIndex = segments.findIndex((segment, index) => index > 1 && RESOURCE_SEGMENTS.has(segment as GitLabResourceType));
  if (objectIndex === -1 || objectIndex >= segments.length - 1) {
    return null;
  }

  const projectPath = decodeProjectPath(segments.slice(2, objectIndex).join('/'));
  const objectType = segments[objectIndex] as GitLabResourceType;
  const objectId = decodeURIComponent(segments[objectIndex + 1] ?? '');
  const remainder = segments.slice(objectIndex + 2);
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

export function computeGitLabPath(objectType: string, objectId: string): string {
  const jsonlessObjectId = objectId.replace(/\.json$/, '');

  if (objectType === 'jobs') {
    const match = jsonlessObjectId.match(/^(.*)\/pipelines\/([^/]+)\/jobs\/([^/]+)$/);
    if (match) {
      return computePipelineJobPath(match[1], decodeURIComponent(match[2]), decodeURIComponent(match[3]));
    }
  }

  if (objectType === 'discussions') {
    const match = jsonlessObjectId.match(/^(.*)\/merge_requests\/([^/]+)\/discussions\/([^/]+)$/);
    if (match) {
      return computeMergeRequestDiscussionPath(match[1], decodeURIComponent(match[2]), decodeURIComponent(match[3]));
    }
  }

  if (objectType === 'issue_notes') {
    const match = jsonlessObjectId.match(/^(.*)\/issues\/([^/]+)\/comments\/([^/]+)$/);
    if (match) {
      return computeIssueCommentPath(match[1], decodeURIComponent(match[2]), decodeURIComponent(match[3]));
    }
  }

  if (objectType === 'commit_notes') {
    const match = jsonlessObjectId.match(/^(.*)\/commits\/([^/]+)\/comments\/([^/]+)$/);
    if (match) {
      return computeCommitCommentPath(match[1], decodeURIComponent(match[2]), decodeURIComponent(match[3]));
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

  const marker = `/${objectType}/`;
  const markerIndex = objectId.indexOf(marker);
  if (markerIndex === -1) {
    return computeCanonicalPath('gitlab', objectType, objectId);
  }

  const projectPath = objectId.slice(0, markerIndex);
  const resourceId = objectId.slice(markerIndex + marker.length);

  switch (objectType) {
    case 'merge_requests':
      return computeMetadataPath(projectPath, 'merge_requests', resourceId);
    case 'issues':
      return computeMetadataPath(projectPath, 'issues', resourceId);
    case 'commits':
      return computeMetadataPath(projectPath, 'commits', resourceId);
    case 'pipelines':
      return computeMetadataPath(projectPath, 'pipelines', resourceId);
    case 'deployments':
      return computeMetadataPath(projectPath, 'deployments', resourceId);
    case 'tags':
      return computeMetadataPath(projectPath, 'tags', resourceId);
    default:
      return computeCanonicalPath('gitlab', objectType, objectId);
  }
}
