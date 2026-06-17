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
  provider: "gcp",
  identify: gcpIdentifier,
  alias: {
    mode: "any",
    segments: ["by-id", "by-region", "by-status", "by-title", "by-state"],
  },
  actionRules: [
    { verbs: "create|created|add|added|initialize|initialized", pastTense: "was created" },
    { verbs: "update|updated|change|changed|sync|synced", pastTense: "was updated" },
    { verbs: "delete|deleted|remove|removed", pastTense: "was deleted" },
    { verbs: "open|opened|fire|fired|firing", pastTense: "started firing" },
    { verbs: "close|closed|resolve|resolved", pastTense: "was resolved" },
    { verbs: "deploy|deployed", pastTense: "was deployed" },
    { verbs: "complete|completed|done", pastTense: "was completed" },
    { verbs: "cancel|canceled|cancelled", pastTense: "was canceled" },
  ],
});

function gcpIdentifier(path: string): string {
  const segments = path.split("/").filter(Boolean);
  const leaf = segments.at(-1) ?? path;
  const basename = leaf.replace(/\.[^.]+$/u, "");

  if (path.includes("/run/services/")) {
    return `Cloud Run service ${basename}`;
  }
  if (path.includes("/monitoring/alerts/")) {
    return `alert policy ${basename}`;
  }
  if (path.includes("/billing/")) {
    return `billing ${basename}`;
  }
  if (path.includes("/error-reporting/groups/")) {
    return `error group ${basename}`;
  }

  return basename;
}
