/**
 * Worker-safe Linear planner contract.
 *
 * Keep this module import-free. It is a leaf entrypoint for runtimes such as
 * Cloudflare Workers that need Linear model normalization and state paths
 * without pulling in the full adapter, Node built-ins, alias slugging, or the
 * Relayfile SDK.
 */

export const LINEAR_OBJECT_TYPES = [
  'comment',
  'cycle',
  'issue',
  'label',
  'milestone',
  'project',
  'roadmap',
  'state',
  'team',
  'user',
] as const;

export type LinearPathObjectType = (typeof LINEAR_OBJECT_TYPES)[number];

const OBJECT_TYPE_ALIASES: Readonly<Record<string, LinearPathObjectType>> = {
  comment: 'comment',
  comments: 'comment',
  linearcomment: 'comment',
  cycle: 'cycle',
  cycles: 'cycle',
  linearcycle: 'cycle',
  issue: 'issue',
  issues: 'issue',
  issue_label: 'label',
  issuelabel: 'label',
  linearissue: 'issue',
  linearissuelabel: 'label',
  label: 'label',
  labels: 'label',
  linearlabel: 'label',
  milestone: 'milestone',
  milestones: 'milestone',
  projectmilestone: 'milestone',
  projectmilestones: 'milestone',
  linearmilestone: 'milestone',
  project: 'project',
  projects: 'project',
  linearproject: 'project',
  roadmap: 'roadmap',
  roadmaps: 'roadmap',
  linearroadmap: 'roadmap',
  state: 'state',
  states: 'state',
  linearstate: 'state',
  team: 'team',
  teams: 'team',
  linearteam: 'team',
  user: 'user',
  users: 'user',
  linearuser: 'user',
};

/** Nango `linear-relay` model names mapped to canonical Linear object types. */
const NANGO_MODEL_MAP: Readonly<Record<string, LinearPathObjectType>> = {
  LinearComment: 'comment',
  LinearCycle: 'cycle',
  LinearIssue: 'issue',
  LinearIssueLabel: 'label',
  LinearLabel: 'label',
  LinearMilestone: 'milestone',
  LinearProject: 'project',
  LinearRoadmap: 'roadmap',
  LinearState: 'state',
  LinearTeam: 'team',
  LinearUser: 'user',
};

function normalizeLinearObjectType(objectType: string): LinearPathObjectType {
  const normalized = objectType.trim().toLowerCase();
  const mapped = OBJECT_TYPE_ALIASES[normalized];
  if (!mapped) {
    throw new Error(`Unsupported Linear object type: ${objectType}`);
  }
  return mapped;
}

/** Resolve a Nango model name or canonical Linear alias without silent fallback. */
export function normalizeNangoLinearModel(model: string): LinearPathObjectType {
  const direct = NANGO_MODEL_MAP[model];
  return direct ?? normalizeLinearObjectType(model);
}

function encodeLinearStateId(stateId: string): string {
  const trimmed = stateId.trim();
  if (!trimmed) {
    throw new Error('Linear path segment must be a non-empty string');
  }
  return encodeURIComponent(trimmed);
}

/** Canonical path for a materialized Linear workflow state. */
export function linearStatePath(stateId: string): string {
  return `/linear/states/${encodeLinearStateId(stateId)}.json`;
}

/** Canonical index path for materialized Linear workflow states. */
export function linearStatesIndexPath(): string {
  return '/linear/states/_index.json';
}
