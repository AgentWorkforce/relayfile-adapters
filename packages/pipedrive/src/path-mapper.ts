export const PIPEDRIVE_PATH_ROOT = '/pipedrive';

export const PIPEDRIVE_OBJECT_TYPES = [
  'deal',
  'person',
  'organization',
  'activity',
] as const;

export type PipedrivePathObjectType = (typeof PIPEDRIVE_OBJECT_TYPES)[number];

const OBJECT_TYPE_ALIASES: Readonly<Record<string, PipedrivePathObjectType>> = {
  activity: 'activity',
  activities: 'activity',
  activityv2: 'activity',
  deal: 'deal',
  deals: 'deal',
  pipedriveactivity: 'activity',
  pipedrivedeal: 'deal',
  pipedriveorganization: 'organization',
  pipedriveorganisation: 'organization',
  pipedriveperson: 'person',
  organization: 'organization',
  organizations: 'organization',
  organisation: 'organization',
  organisations: 'organization',
  org: 'organization',
  orgs: 'organization',
  person: 'person',
  persons: 'person',
  people: 'person',
};

const NANGO_MODEL_MAP: Readonly<Record<string, PipedrivePathObjectType>> = {
  PipedriveActivity: 'activity',
  PipedriveDeal: 'deal',
  PipedriveOrganization: 'organization',
  PipedriveOrganisation: 'organization',
  PipedrivePerson: 'person',
};

function assertNonEmptySegment(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Pipedrive ${label} must be a non-empty string`);
  }
  return trimmed;
}

export function encodePipedrivePathSegment(value: string): string {
  return encodeURIComponent(assertNonEmptySegment(value, 'path segment'));
}

function slugify(value: string): string {
  return value
    .replace(/[{}]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function idSuffix(id: string): string {
  return id.replace(/-/g, '');
}

function titleSegmentWithId(title: string | undefined, id: string): string {
  const slug = title ? slugify(title) : '';
  return slug ? `${slug}--${idSuffix(id)}` : encodePipedrivePathSegment(id);
}

export function normalizePipedriveObjectType(objectType: string): PipedrivePathObjectType {
  const normalized = objectType.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
  const mapped = OBJECT_TYPE_ALIASES[normalized];
  if (!mapped) {
    throw new Error(`Unsupported Pipedrive object type: ${objectType}`);
  }
  return mapped;
}

export function tryNormalizePipedriveObjectType(objectType: string): PipedrivePathObjectType | undefined {
  try {
    return normalizePipedriveObjectType(objectType);
  } catch {
    return undefined;
  }
}

export function normalizeNangoPipedriveModel(model: string): PipedrivePathObjectType {
  const direct = NANGO_MODEL_MAP[model];
  if (direct) return direct;
  return normalizePipedriveObjectType(model);
}

export function pipedriveDealPath(dealId: string, title?: string): string {
  return `${PIPEDRIVE_PATH_ROOT}/deals/${titleSegmentWithId(title, dealId)}.json`;
}

export function pipedrivePersonPath(personId: string, name?: string): string {
  return `${PIPEDRIVE_PATH_ROOT}/persons/${titleSegmentWithId(name, personId)}.json`;
}

export function pipedriveOrganizationPath(organizationId: string, name?: string): string {
  return `${PIPEDRIVE_PATH_ROOT}/organizations/${titleSegmentWithId(name, organizationId)}.json`;
}

export function pipedriveActivityPath(activityId: string, subject?: string): string {
  return `${PIPEDRIVE_PATH_ROOT}/activities/${titleSegmentWithId(subject, activityId)}.json`;
}

export const personPath = pipedrivePersonPath;
export const organizationPath = pipedriveOrganizationPath;

export function computePipedrivePath(
  objectType: string,
  objectId: string,
  displayName?: string,
): string {
  const normalizedType = normalizePipedriveObjectType(objectType);
  const normalizedId = assertNonEmptySegment(objectId, 'object id');

  switch (normalizedType) {
    case 'deal':
      return pipedriveDealPath(normalizedId, displayName);
    case 'person':
      return pipedrivePersonPath(normalizedId, displayName);
    case 'organization':
      return pipedriveOrganizationPath(normalizedId, displayName);
    case 'activity':
      return pipedriveActivityPath(normalizedId, displayName);
  }
}

export function extractPipedriveIdFromPathSegment(segment: string): string {
  const decoded = decodeURIComponent(segment);
  const suffix = /--(.+)$/u.exec(decoded);
  if (suffix?.[1]) {
    return suffix[1];
  }
  return decoded;
}
