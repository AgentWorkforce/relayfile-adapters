import {
  createDigestHandler,
  type DigestBullet,
  type DigestChangeEvent,
  type DigestContext,
  type DigestHandler,
  type DigestSection,
  type DigestWindow,
} from "@relayfile/adapter-core/digest";

export type {
  DigestBullet,
  DigestChangeEvent,
  DigestContext,
  DigestHandler,
  DigestSection,
  DigestWindow,
};

export const digest: DigestHandler = createDigestHandler({
  provider: "posthog",
  identify: posthogIdentifier,
  alias: {
    mode: "any",
    segments: ["by-id", "by-name", "by-short-id", "by-key"],
  },
  actionRules: [
    { verbs: "create|created|add|added|write|written", pastTense: "was created" },
    { verbs: "update|updated|change|changed|sync|synced", pastTense: "was updated" },
    { verbs: "delete|deleted|remove|removed", pastTense: "was deleted" },
    { verbs: "archive|archived", pastTense: "was archived" },
    { verbs: "complete|completed|finish|finished", pastTense: "was completed" },
    { verbs: "close|closed|resolve|resolved", pastTense: "was resolved" },
    { verbs: "fire|fired|trigger|triggered|alert", pastTense: "fired" },
    { verbs: "pause|paused", pastTense: "was paused" },
    { verbs: "launch|launched", pastTense: "was launched" },
  ],
  classify: (event, canonicalPath) => terminalStateVerb(event, canonicalPath),
});

function posthogIdentifier(path: string, event: DigestChangeEvent): string {
  const content = readRecord(event.content);
  const payload = readRecord(content?.payload) ?? content;
  const basename =
    path.split("/").filter(Boolean).at(-1)?.replace(/\.[^.]+$/u, "") ?? path;
  const projectId = path.split("/").filter(Boolean)[2] ?? readString(payload?.project_id);
  const title =
    readString(payload?.title) ??
    readString(payload?.name) ??
    readString(payload?.key) ??
    readString(payload?.short_id);

  if (path.includes("/feature-flags/")) return `feature flag ${title ?? basename}`;
  if (path.includes("/dashboards/")) return `dashboard ${title ?? basename}`;
  if (path.includes("/insights/")) return `insight ${title ?? basename}`;
  if (path.includes("/annotations/")) return `annotation ${title ?? basename}`;
  if (path.includes("/experiments/")) return `experiment ${title ?? basename}`;
  if (path.includes("/surveys/")) return `survey ${title ?? basename}`;
  if (path.includes("/alert-events/")) return `alert ${title ?? basename}`;
  if (path.includes("/projects/")) return `project ${title ?? projectId ?? basename}`;
  return title ?? basename;
}

function terminalStateVerb(
  event: DigestChangeEvent,
  canonicalPath: string,
): string | null {
  const content = readRecord(event.content);
  const payload = readRecord(content?.payload) ?? content;
  if (!payload) {
    return null;
  }

  const state = readLowerString(payload.state);
  const status = readLowerString(payload.status);
  const archived = payload.archived === true || payload.deleted === true;
  const active = payload.active === true ? true : payload.active === false ? false : null;

  if (canonicalPath.includes("/alert-events/")) {
    if (state === "resolved" || status === "resolved") return "was resolved";
    if (state === "triggered" || status === "triggered" || status === "firing") return "fired";
  }

  if (archived) return "was archived";
  if (status === "completed" || state === "completed") return "was completed";
  if (status === "closed" || state === "closed") return "was resolved";
  if (status === "paused" || state === "paused") return "was paused";
  if (active === false && canonicalPath.includes("/feature-flags/")) return "was archived";

  return null;
}

function readRecord(
  value: unknown,
): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function readLowerString(value: unknown): string | undefined {
  const raw = readString(value);
  return raw ? raw.toLowerCase() : undefined;
}
