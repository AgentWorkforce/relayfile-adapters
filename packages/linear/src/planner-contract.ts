/**
 * Minimal Linear record-planning contract for Worker/browser consumers.
 *
 * Keep this module dependency-free: the `./planner-contract` package subpath is
 * deliberately safe to include in strict Worker bundles.
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

const LINEAR_PATH_ROOT = '/linear';

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

/** Nango Linear model names that require an explicit canonical mapping. */
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

function assertNonEmptySegment(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Linear ${label} must be a non-empty string`);
  }
  return trimmed;
}

/** Normalize a Nango model name or supported Linear object-type alias. */
export function normalizeNangoLinearModel(model: string): LinearPathObjectType {
  const direct = Object.hasOwn(NANGO_MODEL_MAP, model)
    ? NANGO_MODEL_MAP[model]
    : undefined;
  if (direct) return direct;

  const normalized = model.trim().toLowerCase();
  const mapped = Object.hasOwn(OBJECT_TYPE_ALIASES, normalized)
    ? OBJECT_TYPE_ALIASES[normalized]
    : undefined;
  if (!mapped) {
    throw new Error(`Unsupported Linear object type: ${model}`);
  }
  return mapped;
}

/** Canonical flat-record path for a Linear workflow state. */
export function linearStatePath(stateId: string): string {
  const encodedStateId = encodeURIComponent(assertNonEmptySegment(stateId, 'path segment'));
  return `${LINEAR_PATH_ROOT}/states/${encodedStateId}.json`;
}

/** Canonical resource index path for Linear workflow states. */
export function linearStatesIndexPath(): string {
  return `${LINEAR_PATH_ROOT}/states/_index.json`;
}
