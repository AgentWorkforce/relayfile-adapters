import {
  createDigestHandler,
  type DigestBullet,
  type DigestChangeEvent,
  type DigestContext,
  type DigestHandler,
  type DigestSection,
  type DigestWindow,
} from "@relayfile/adapter-core/digest";

export type { DigestBullet, DigestChangeEvent, DigestContext, DigestHandler, DigestSection, DigestWindow };

export const digest: DigestHandler = createDigestHandler({
  provider: "shortcut",
  identify: (path) => path.split("/").filter(Boolean).at(-1)?.replace(/\.json$/u, "") ?? path,
  actionRules: [
    { verbs: "create|created|add|added|open|opened", pastTense: "was created" },
    { verbs: "delete|deleted|remove|removed", pastTense: "was deleted" },
    { verbs: "close|closed", pastTense: "was closed" },
    { verbs: "resolve|resolved", pastTense: "was resolved" },
    { verbs: "complete|completed|done", pastTense: "was completed" },
    { verbs: "archive|archived", pastTense: "was archived" },
    { verbs: "update|updated|change|changed|edit|edited", pastTense: "was updated" },
  ],
  alias: { mode: "any" },
  classify: (event) => terminalStateVerb(event),
});

function terminalStateVerb(event: DigestChangeEvent): string | null {
  const content = asRecord(event.content);
  const payload = asRecord(content?.payload) ?? content;
  if (!payload) return null;

  const state = readLower(payload.state) ?? readLower(asRecord(payload.workflow_state)?.name) ?? readLower(asRecord(payload.epic_state)?.name);
  const archived = payload.archived === true;
  const completed = payload.completed === true || payload.completed_at != null || payload.completed_at_override != null;

  if (archived) return "was archived";
  if (completed || state === "completed" || state === "done") return "was completed";
  if (state === "closed") return "was closed";
  if (state === "resolved") return "was resolved";
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readLower(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : undefined;
}
