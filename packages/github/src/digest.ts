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
  provider: "github",
  identify: githubIdentifier,
  alias: { segments: [] },
  actionRules: [
    { verbs: "open|opened|create|created|add|added|write|written", pastTense: "was opened" },
    { verbs: "merge|merged", pastTense: "was merged" },
    { verbs: "close|closed", pastTense: "was closed" },
    { verbs: "delete|deleted|remove|removed", pastTense: "was deleted" },
  ],
  acceptEvent: (_event, canonicalPath) => !hasGitHubAliasDirectory(canonicalPath),
});

const DIGEST_ALIAS_SEGMENTS = new Set([
  "by-assignee",
  "by-creator",
  "by-database",
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
]);

const GITHUB_ALIAS_RESOURCE_SEGMENTS = new Set([
  "issues",
  "pulls",
]);

function hasGitHubAliasDirectory(path: string): boolean {
  const segments = path.split("/").filter(Boolean);
  if (segments[0] !== "github" || segments[1] !== "repos") return false;
  return (
    isGitHubAliasResourcePair(segments[3], segments[4]) ||
    isGitHubAliasResourcePair(segments[4], segments[5])
  );
}

function isGitHubAliasResourcePair(resource: string | undefined, alias: string | undefined): boolean {
  return Boolean(
    resource &&
      alias &&
      GITHUB_ALIAS_RESOURCE_SEGMENTS.has(resource) &&
      DIGEST_ALIAS_SEGMENTS.has(alias),
  );
}

function githubIdentifier(path: string): string {
  const segments = path.split("/").filter(Boolean);
  const segment =
    segments.at(-1) === "meta.json" || segments.at(-1) === "metadata.json"
      ? segments.at(-2) ?? path
      : segments.at(-1) ?? path;
  const basename = segment.replace(/\.[^.]+$/u, "");
  const separatorIndex = basename.lastIndexOf("__");
  return separatorIndex > 0 ? `#${basename.slice(0, separatorIndex)}` : basename;
}
