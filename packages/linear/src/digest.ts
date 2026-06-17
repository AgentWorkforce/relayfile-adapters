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
  provider: "linear",
  identify: linearIdentifier,
  actionRules: [
    { verbs: "create|created|open|opened|add|added|write|written", pastTense: "was created" },
    { verbs: "delete|deleted|remove|removed", pastTense: "was deleted" },
    { verbs: "cancel|canceled|cancelled", pastTense: "was canceled" },
    { verbs: "complete|completed|done", pastTense: "was completed" },
    { verbs: "close|closed|resolve|resolved", pastTense: "was closed" },
  ],
});

function linearIdentifier(path: string): string {
  const segment = path.split("/").filter(Boolean).at(-1) ?? path;
  const basename = segment.replace(/\.[^.]+$/u, "");
  const separatorIndex = basename.lastIndexOf("__");
  return separatorIndex > 0 ? basename.slice(0, separatorIndex) : basename;
}
