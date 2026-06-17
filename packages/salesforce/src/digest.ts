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
  provider: "salesforce",
  identify: (canonicalPath) => salesforceIdentifier(canonicalPath),
  alias: { segments: [] },
  actionRules: [
    { verbs: "create|created|add|added|write|written", pastTense: "was created" },
    { verbs: "delete|deleted|remove|removed", pastTense: "was deleted" },
    { verbs: "close|closed", pastTense: "was closed" },
    { verbs: "convert|converted", pastTense: "was converted" },
  ],
  defaultPastTense: "was updated",
});

function salesforceIdentifier(path: string): string {
  const segments = path.split("/").filter(Boolean);
  const terminal = segments.at(-1);
  const segment = terminal === "meta.json" || terminal === "metadata.json"
    ? segments.at(-2) ?? path
    : terminal ?? path;
  const basename = segment.replace(/\.[^.]+$/u, "");
  const separatorIndex = basename.lastIndexOf("__");
  const id = separatorIndex > 0 ? basename.slice(0, separatorIndex) : basename;

  if (path.includes("/accounts/")) return `account ${id}`;
  if (path.includes("/contacts/")) return `contact ${id}`;
  if (path.includes("/opportunities/")) return `opportunity ${id}`;
  if (path.includes("/leads/")) return `lead ${id}`;
  if (path.includes("/cases/")) return `case ${id}`;
  return id;
}
