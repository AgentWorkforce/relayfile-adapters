export const POSTHOG_PATH_ROOT = "/posthog";

export type PostHogPathObjectType =
  | "project"
  | "insight"
  | "dashboard"
  | "feature-flag"
  | "annotation"
  | "experiment"
  | "survey"
  | "alert-event";

export type PostHogAggregateCollection =
  | "projects"
  | "insights"
  | "dashboards"
  | "feature-flags"
  | "annotations"
  | "experiments"
  | "surveys"
  | "alert-events";
