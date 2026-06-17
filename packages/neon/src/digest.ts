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
  provider: "neon",
  identify: neonIdentifier,
  alias: {
    mode: "any",
    segments: [
      "by-id",
      "by-org",
      "by-project",
      "by-branch",
      "by-state",
      "by-status",
      "by-metric",
      "by-level",
      "by-name",
    ],
  },
  actionRules: [
    { verbs: "create|created|add|added", pastTense: "was created" },
    { verbs: "update|updated|change|changed|sync|synced", pastTense: "was updated" },
    { verbs: "delete|deleted|remove|removed", pastTense: "was deleted" },
    { verbs: "fail|failed|error|errored", pastTense: "failed" },
    { verbs: "cancel|canceled|cancelled", pastTense: "was canceled" },
    { verbs: "finish|finished|complete|completed", pastTense: "completed" },
    { verbs: "suspend|suspended", pastTense: "was suspended" },
  ],
});

function neonIdentifier(path: string): string {
  const segments = path.split("/").filter(Boolean);
  const leaf = segments.at(-1) ?? path;
  const basename = leaf.replace(/\.[^.]+$/u, "");

  if (path.includes("/organizations/")) return `organization ${basename}`;
  if (path.includes("/projects/") && !path.includes("/consumption/")) return `project ${basename}`;
  if (path.includes("/branches/") && !path.includes("/consumption/")) return `branch ${basename}`;
  if (path.includes("/endpoints/")) return `endpoint ${basename}`;
  if (path.includes("/operations/")) return `operation ${basename}`;
  if (path.includes("/consumption/projects/")) return `project consumption ${basename}`;
  if (path.includes("/consumption/branches/")) return `branch consumption ${basename}`;
  if (path.includes("/spending-limits/")) return `spending limit ${basename}`;
  if (path.includes("/advisors/")) return `advisor issue ${basename}`;
  return basename;
}
