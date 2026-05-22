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
  provider: "hubspot",
  identify: hubspotIdentifier,
  alias: {
    mode: "any",
    segments: ["by-id"],
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

function hubspotIdentifier(path: string): string {
  const segments = path.split("/").filter(Boolean);
  const segment =
    segments.at(-1) === "meta.json" || segments.at(-1) === "metadata.json"
      ? segments.at(-2) ?? path
      : segments.at(-1) ?? path;
  const basename = segment.replace(/\.[^.]+$/u, "");
  const separatorIndex = basename.lastIndexOf("__");
  const id = separatorIndex > 0 ? basename.slice(0, separatorIndex) : basename;

  if (path.includes("/contacts/")) return `contact ${id}`;
  if (path.includes("/companies/")) return `company ${id}`;
  if (path.includes("/deals/")) return `deal ${id}`;
  if (path.includes("/tickets/")) return `ticket ${id}`;
  return id;
}
