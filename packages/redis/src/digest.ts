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
  provider: "redis",
  identify: (canonicalPath) => redisIdentifier(canonicalPath),
  alias: { segments: [] },
  actionRules: [
    { verbs: "set|create|created|add|added|write|written", pastTense: "was set" },
    { verbs: "expire|expired|evict|evicted", pastTense: "was expired" },
    { verbs: "del|delete|deleted|remove|removed", pastTense: "was deleted" },
  ],
});

function redisIdentifier(path: string): string {
  const segments = path.split("/").filter(Boolean);
  const key = segments.length > 2 ? segments.slice(2).join("/") : segments.at(-1) ?? path;
  return `key ${key.replace(/\.json$/u, "")}`;
}
