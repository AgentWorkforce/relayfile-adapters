export const DAYTONA_PATH_ROOT = "/daytona";

export const DAYTONA_WEBHOOK_EVENTS = [
  "sandbox.created",
  "sandbox.state.updated",
  "snapshot.created",
  "snapshot.state.updated",
  "snapshot.removed",
  "volume.created",
  "volume.state.updated",
] as const;

export type DaytonaWebhookEvent = (typeof DAYTONA_WEBHOOK_EVENTS)[number];

export type DaytonaPathObjectType = "usage" | "sandbox" | "snapshot" | "volume";
