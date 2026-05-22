import {
  createDigestHandler,
  type DigestBullet,
  type DigestChangeEvent,
  type DigestContext,
  type DigestHandler,
  type DigestSection,
  type DigestWindow,
} from "@relayfile/adapter-core";

import { extractJiraIdFromPathSegment } from "./path-mapper.js";

export type {
  DigestBullet,
  DigestChangeEvent,
  DigestContext,
  DigestHandler,
  DigestSection,
  DigestWindow,
};

export const digest: DigestHandler = createDigestHandler({
  provider: "jira",
  identify: jiraIdentifier,
  actionRules: [
    { verbs: "create|created|open|opened|add|added|write|written", pastTense: "was created" },
    { verbs: "delete|deleted|remove|removed", pastTense: "was deleted" },
    { verbs: "close|closed|complete|completed|resolve|resolved|done|cancel|canceled|cancelled", pastTense: "was completed" },
  ],
});

function jiraIdentifier(path: string): string {
  const segments = path.split("/").filter(Boolean);
  const segment = segments.at(-1) === "meta.json" || segments.at(-1) === "metadata.json"
    ? segments.at(-2) ?? path
    : segments.at(-1) ?? path;
  const basename = segment.replace(/\.[^.]+$/u, "");
  const id = extractJiraIdFromPathSegment(basename);

  if (path.includes("/issues/")) return `issue ${id}`;
  if (path.includes("/projects/")) return `project ${id}`;
  if (path.includes("/sprints/")) return `sprint ${id}`;
  return id;
}
