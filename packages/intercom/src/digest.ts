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
  provider: "intercom",
  identify: (canonicalPath) => intercomIdentifier(canonicalPath),
  alias: { segments: [] },
  actionRules: [
    { verbs: "create|created|add|added|write|written", pastTense: "was created" },
    { verbs: "delete|deleted|remove|removed", pastTense: "was deleted" },
    { verbs: "close|closed", pastTense: "was closed" },
    { verbs: "reopen|reopened", pastTense: "was reopened" },
    { verbs: "archive|archived", pastTense: "was archived" },
    { verbs: "complete|completed|done", pastTense: "was completed" },
    { verbs: "cancel|canceled|cancelled", pastTense: "was canceled" },
    { verbs: "resolve|resolved", pastTense: "was resolved" },
    { verbs: "merge|merged", pastTense: "was merged" },
  ],
  defaultPastTense: "was updated",
});

function intercomIdentifier(path: string): string {
  const segments = path.split("/").filter(Boolean);
  const terminal = segments.at(-1);
  const segment = terminal === "meta.json" || terminal === "metadata.json"
    ? segments.at(-2) ?? path
    : terminal ?? path;
  const basename = segment.replace(/\.[^.]+$/u, "");
  const separatorIndex = basename.lastIndexOf("__");
  const id = separatorIndex > 0 ? basename.slice(0, separatorIndex) : basename;

  if (path.includes("/conversations/")) return `conversation ${id}`;
  if (path.includes("/contacts/")) return `contact ${id}`;
  if (path.includes("/companies/")) return `company ${id}`;
  return id;
}
