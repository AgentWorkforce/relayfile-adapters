import {
  createDigestHandler,
  type DigestBullet,
  type DigestChangeEvent,
  type DigestContext,
  type DigestHandler,
  type DigestSection,
  type DigestWindow,
} from "@relayfile/adapter-core";

export type {
  DigestBullet,
  DigestChangeEvent,
  DigestContext,
  DigestHandler,
  DigestSection,
  DigestWindow,
};

export const digest: DigestHandler = createDigestHandler({
  provider: "granola",
  identify: granolaIdentifier,
  alias: {
    mode: "any",
    segments: [
      "by-assignee",
      "by-creator",
      "by-day",
      "by-database",
      "by-folder",
      "by-id",
      "by-key",
      "by-name",
      "by-parent",
      "by-priority",
      "by-ref",
      "by-space",
      "by-state",
      "by-status",
      "by-title",
      "by-uuid",
    ],
  },
  actionRules: [
    { verbs: "create|created|add|added|write|written", pastTense: "was created" },
    { verbs: "delete|deleted|remove|removed", pastTense: "was deleted" },
    { verbs: "merge|merged", pastTense: "was merged" },
    { verbs: "archive|archived", pastTense: "was archived" },
    { verbs: "close|closed", pastTense: "was closed" },
    { verbs: "complete|completed|done", pastTense: "was completed" },
    { verbs: "cancel|canceled|cancelled", pastTense: "was canceled" },
    { verbs: "resolve|resolved", pastTense: "was resolved" },
  ],
});

function granolaIdentifier(path: string): string {
  const segments = path.split("/").filter(Boolean);
  const leaf = segments.at(-1) ?? path;
  const basename = leaf.replace(/\.[^.]+$/u, "");

  if (path.includes("/notes/")) return `note ${basename}`;
  if (path.includes("/folders/")) return `folder ${basename}`;
  return basename;
}
