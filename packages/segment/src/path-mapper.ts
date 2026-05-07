export const SEGMENT_PATH_ROOT = '/segment';

export const SEGMENT_OBJECT_TYPES = [
  'identify',
  'track',
  'page',
  'group',
] as const;

export type SegmentPathObjectType = (typeof SEGMENT_OBJECT_TYPES)[number];

const OBJECT_TYPE_ALIASES: Readonly<Record<string, SegmentPathObjectType>> = {
  aliasidentify: 'identify',
  group: 'group',
  groups: 'group',
  identify: 'identify',
  identifies: 'identify',
  identification: 'identify',
  page: 'page',
  pages: 'page',
  segmentgroup: 'group',
  segmentidentify: 'identify',
  segmentpage: 'page',
  segmenttrack: 'track',
  track: 'track',
  tracks: 'track',
};

const NANGO_MODEL_MAP: Readonly<Record<string, SegmentPathObjectType>> = {
  SegmentGroup: 'group',
  SegmentIdentify: 'identify',
  SegmentPage: 'page',
  SegmentTrack: 'track',
};

function assertNonEmptySegment(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Segment ${label} must be a non-empty string`);
  }
  return trimmed;
}

export function encodeSegmentPathSegment(value: string): string {
  return encodeURIComponent(assertNonEmptySegment(value, 'path segment'));
}

function slugify(value: string): string {
  return value
    .replace(/[{}]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function compactSuffix(id: string): string {
  return id.replace(/-/g, '');
}

function titledSegment(title: string | undefined, id: string): string {
  const slug = title ? slugify(title) : '';
  return slug ? `${slug}--${compactSuffix(id)}` : encodeSegmentPathSegment(id);
}

export function normalizeSegmentObjectType(objectType: string): SegmentPathObjectType {
  const normalized = objectType.trim().toLowerCase();
  const mapped = OBJECT_TYPE_ALIASES[normalized];
  if (!mapped) {
    throw new Error(`Unsupported Segment object type: ${objectType}`);
  }
  return mapped;
}

export function tryNormalizeSegmentObjectType(objectType: string): SegmentPathObjectType | undefined {
  try {
    return normalizeSegmentObjectType(objectType);
  } catch {
    return undefined;
  }
}

export function normalizeNangoSegmentModel(model: string): SegmentPathObjectType {
  const direct = NANGO_MODEL_MAP[model];
  if (direct) return direct;
  return normalizeSegmentObjectType(model);
}

export function segmentIdentifyPath(identifier: string): string {
  return `${SEGMENT_PATH_ROOT}/identify/${encodeSegmentPathSegment(identifier)}.json`;
}

export function segmentTrackPath(messageId: string, eventName?: string): string {
  return `${SEGMENT_PATH_ROOT}/track/${titledSegment(eventName, messageId)}.json`;
}

export function segmentPagePath(messageId: string, pageName?: string): string {
  return `${SEGMENT_PATH_ROOT}/page/${titledSegment(pageName, messageId)}.json`;
}

export function segmentGroupPath(groupId: string): string {
  return `${SEGMENT_PATH_ROOT}/groups/${encodeSegmentPathSegment(groupId)}.json`;
}

export function computeSegmentPath(
  objectType: string,
  objectId: string,
  displayName?: string,
): string {
  const normalizedType = normalizeSegmentObjectType(objectType);
  const normalizedId = assertNonEmptySegment(objectId, 'object id');

  switch (normalizedType) {
    case 'identify':
      return segmentIdentifyPath(normalizedId);
    case 'track':
      return segmentTrackPath(normalizedId, displayName);
    case 'page':
      return segmentPagePath(normalizedId, displayName);
    case 'group':
      return segmentGroupPath(normalizedId);
  }
}
