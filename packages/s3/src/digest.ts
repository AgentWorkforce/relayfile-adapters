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
  provider: "s3",
  identify: (canonicalPath) => s3Identifier(canonicalPath),
  alias: { segments: [] },
  actionRules: [
    { verbs: "create|created|put|upload|uploaded|write|written", pastTense: "was uploaded" },
    { verbs: "objectrestore|restore|restored", pastTense: "was restored" },
    { verbs: "copy|copied", pastTense: "was copied" },
    { verbs: "delete|deleted|remove|removed", pastTense: "was deleted" },
  ],
  defaultPastTense: "was modified",
});

function s3Identifier(path: string): string {
  const segments = path.split("/").filter(Boolean);
  const key = segments.length > 2 ? segments.slice(2).join("/") : segments.at(-1) ?? path;
  return `object ${key}`;
}
