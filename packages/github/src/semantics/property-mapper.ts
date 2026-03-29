export interface FileSemantics {
  properties?: Record<string, string>;
  relations?: string[];
  permissions?: string[];
  comments?: string[];
}

export type FileSemanticsProperties = NonNullable<FileSemantics['properties']>;

export type GitHubSemanticObjectType =
  | 'commit'
  | 'file'
  | 'issue'
  | 'pull_request'
  | 'review';

type UnknownRecord = Record<string, unknown>;

export function mapPRProperties(pr: unknown): FileSemantics['properties'] {
  const prRecord = asRecord(pr);
  const baseRecord = getRecord(prRecord, 'base');
  const headRecord = getRecord(prRecord, 'head');

  return buildProperties({
    title: getString(prRecord, 'title'),
    state: getString(prRecord, 'state'),
    'author.login': getNestedString(prRecord, ['user', 'login']),
    base_branch: getString(baseRecord, 'ref'),
    head_branch: getString(headRecord, 'ref'),
    labels: joinValues(readNamedArray(prRecord, 'labels')),
    created_at: getString(prRecord, 'created_at'),
    updated_at: getString(prRecord, 'updated_at'),
    mergeable: getBooleanString(prRecord, 'mergeable'),
  });
}

export function mapCommitProperties(commit: unknown): FileSemantics['properties'] {
  const commitRecord = asRecord(commit);
  const nestedCommitRecord = getRecord(commitRecord, 'commit');
  const commitAuthorRecord = getRecord(nestedCommitRecord, 'author');

  return buildProperties({
    sha: getString(commitRecord, 'sha'),
    message: getString(nestedCommitRecord, 'message'),
    'author.login': getNestedString(commitRecord, ['author', 'login']),
    'author.email': getString(commitAuthorRecord, 'email'),
    date: getString(commitAuthorRecord, 'date'),
    additions: getNumberString(commitRecord, 'additions'),
    deletions: getNumberString(commitRecord, 'deletions'),
  });
}

export function mapReviewProperties(review: unknown): FileSemantics['properties'] {
  const reviewRecord = asRecord(review);

  return buildProperties({
    state: getString(reviewRecord, 'state'),
    'author.login': getNestedString(reviewRecord, ['user', 'login']),
    body: getString(reviewRecord, 'body'),
    submitted_at: getString(reviewRecord, 'submitted_at'),
  });
}

export function mapIssueProperties(issue: unknown): FileSemantics['properties'] {
  const issueRecord = asRecord(issue);

  return buildProperties({
    title: getString(issueRecord, 'title'),
    state: getString(issueRecord, 'state'),
    'author.login': getNestedString(issueRecord, ['user', 'login']),
    labels: joinValues(readNamedArray(issueRecord, 'labels')),
    created_at: getString(issueRecord, 'created_at'),
    assignees: joinValues(readNamedArray(issueRecord, 'assignees', 'login')),
  });
}

export function mapFileProperties(file: unknown): FileSemantics['properties'] {
  const fileRecord = asRecord(file);

  return buildProperties({
    path: firstDefined(getString(fileRecord, 'filename'), getString(fileRecord, 'path')),
    status: getString(fileRecord, 'status'),
    additions: getNumberString(fileRecord, 'additions'),
    deletions: getNumberString(fileRecord, 'deletions'),
    patch_available: String(typeof getValue(fileRecord, 'patch') === 'string'),
  });
}

export function mapProperties(
  objectType: GitHubSemanticObjectType,
  payload: unknown,
): FileSemantics['properties'] {
  switch (objectType) {
    case 'pull_request':
      return mapPRProperties(payload);
    case 'commit':
      return mapCommitProperties(payload);
    case 'review':
      return mapReviewProperties(payload);
    case 'issue':
      return mapIssueProperties(payload);
    case 'file':
      return mapFileProperties(payload);
  }
}

function asRecord(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getValue(record: UnknownRecord, key: string): unknown {
  return record[key];
}

function getRecord(record: UnknownRecord, key: string): UnknownRecord {
  const value = getValue(record, key);
  return isRecord(value) ? value : {};
}

function getString(record: UnknownRecord, key: string): string | undefined {
  const value = getValue(record, key);
  return typeof value === 'string' ? value : undefined;
}

function getNestedString(record: UnknownRecord, path: string[]): string | undefined {
  let current: unknown = record;

  for (const segment of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }

  return typeof current === 'string' ? current : undefined;
}

function getNumberString(record: UnknownRecord, key: string): string | undefined {
  const value = getValue(record, key);
  return typeof value === 'number' ? String(value) : undefined;
}

function getBooleanString(record: UnknownRecord, key: string): string | undefined {
  const value = getValue(record, key);
  return typeof value === 'boolean' ? String(value) : undefined;
}

function readNamedArray(
  record: UnknownRecord,
  key: string,
  nestedKey = 'name',
): string[] | undefined {
  const value = getValue(record, key);
  if (!Array.isArray(value)) {
    return undefined;
  }

  const items = value.flatMap((entry) => {
    if (typeof entry === 'string') {
      return entry;
    }
    if (!isRecord(entry)) {
      return [];
    }
    const nestedValue = entry[nestedKey];
    return typeof nestedValue === 'string' ? nestedValue : [];
  });

  return items.length > 0 ? items : undefined;
}

function joinValues(values: string[] | undefined): string | undefined {
  return values && values.length > 0 ? values.join(',') : undefined;
}

function firstDefined(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value !== undefined);
}

function buildProperties(
  values: Record<string, string | undefined>,
): FileSemanticsProperties {
  const properties: FileSemanticsProperties = {};

  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) {
      properties[key] = value;
    }
  }

  return properties;
}
