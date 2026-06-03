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
  provider: "daytona",
  identify: daytonaIdentifier,
  alias: {
    mode: "any",
    segments: ["by-id", "by-day", "by-state", "by-type"],
  },
  actionRules: [
    { verbs: "create|created|add|added|initialize|initialized", pastTense: "was created" },
    { verbs: "update|updated|change|changed|sync|synced", pastTense: "was updated" },
    { verbs: "delete|deleted|remove|removed", pastTense: "was deleted" },
    { verbs: "archive|archived", pastTense: "was archived" },
    { verbs: "close|closed", pastTense: "was closed" },
    { verbs: "merge|merged", pastTense: "was merged" },
    { verbs: "complete|completed|done", pastTense: "was completed" },
    { verbs: "cancel|canceled|cancelled", pastTense: "was canceled" },
    { verbs: "resolve|resolved", pastTense: "was resolved" },
    { verbs: "destroy|destroyed", pastTense: "was destroyed" },
  ],
});

function daytonaIdentifier(path: string): string {
  const segments = path.split("/").filter(Boolean);
  const leaf = segments.at(-1) ?? path;
  const basename = leaf.replace(/\.[^.]+$/u, "");

  if (path.includes("/usage/")) {
    return `usage ${basename}`;
  }
  if (path.includes("/sandboxes/")) {
    return `sandbox ${basename}`;
  }
  if (path.includes("/snapshots/")) {
    return `snapshot ${basename}`;
  }
  if (path.includes("/volumes/")) {
    return `volume ${basename}`;
  }

  return basename;
}
