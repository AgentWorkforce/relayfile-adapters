export const MIXPANEL_PATH_ROOT = '/mixpanel';

export const MIXPANEL_OBJECT_TYPES = [
  'event',
  'profile',
  'cohort',
] as const;

export type MixpanelPathObjectType = (typeof MIXPANEL_OBJECT_TYPES)[number];

const OBJECT_TYPE_ALIASES: Readonly<Record<string, MixpanelPathObjectType>> = {
  cohort: 'cohort',
  cohorts: 'cohort',
  mixpanelcohort: 'cohort',
  event: 'event',
  events: 'event',
  mixpanelevent: 'event',
  people: 'profile',
  person: 'profile',
  profile: 'profile',
  profiles: 'profile',
  user: 'profile',
  users: 'profile',
  mixpanelprofile: 'profile',
};

const NANGO_MODEL_MAP: Readonly<Record<string, MixpanelPathObjectType>> = {
  MixpanelCohort: 'cohort',
  MixpanelEvent: 'event',
  MixpanelProfile: 'profile',
};

function assertNonEmptySegment(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Mixpanel ${label} must be a non-empty string`);
  }
  return trimmed;
}

export function encodeMixpanelPathSegment(value: string): string {
  return encodeURIComponent(assertNonEmptySegment(value, 'path segment'));
}

function slugify(value: string): string {
  return value
    .replace(/[{}]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function stableIdSuffix(id: string): string {
  return id
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '')
    .toLowerCase();
}

function labelSegmentWithId(label: string | undefined, id: string): string {
  const normalizedId = assertNonEmptySegment(id, 'object id');
  const slug = label ? slugify(label) : '';
  const suffix = stableIdSuffix(normalizedId);
  if (slug && suffix) {
    return `${slug}--${suffix}`;
  }
  return encodeMixpanelPathSegment(normalizedId);
}

export function normalizeMixpanelObjectType(objectType: string): MixpanelPathObjectType {
  const normalized = objectType.trim().toLowerCase();
  const mapped = OBJECT_TYPE_ALIASES[normalized];
  if (!mapped) {
    throw new Error(`Unsupported Mixpanel object type: ${objectType}`);
  }
  return mapped;
}

export function tryNormalizeMixpanelObjectType(objectType: string): MixpanelPathObjectType | undefined {
  try {
    return normalizeMixpanelObjectType(objectType);
  } catch {
    return undefined;
  }
}

export function normalizeNangoMixpanelModel(model: string): MixpanelPathObjectType {
  const direct = NANGO_MODEL_MAP[model];
  if (direct) return direct;
  return normalizeMixpanelObjectType(model);
}

export function mixpanelEventPath(eventId: string, eventName?: string): string {
  return `${MIXPANEL_PATH_ROOT}/events/${labelSegmentWithId(eventName, eventId)}.json`;
}

export function mixpanelProfilePath(profileId: string): string {
  return `${MIXPANEL_PATH_ROOT}/profiles/${encodeMixpanelPathSegment(profileId)}.json`;
}

export function mixpanelCohortPath(cohortId: string): string {
  return `${MIXPANEL_PATH_ROOT}/cohorts/${encodeMixpanelPathSegment(cohortId)}.json`;
}

export function computeMixpanelPath(objectType: string, objectId: string, label?: string): string {
  const normalizedType = normalizeMixpanelObjectType(objectType);
  const normalizedId = assertNonEmptySegment(objectId, 'object id');

  switch (normalizedType) {
    case 'event':
      return mixpanelEventPath(normalizedId, label);
    case 'profile':
      return mixpanelProfilePath(normalizedId);
    case 'cohort':
      return mixpanelCohortPath(normalizedId);
  }
}
