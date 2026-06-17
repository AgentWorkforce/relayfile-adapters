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
  provider: "notion",
  identify: notionIdentifier,
  alias: { segments: [] },
  actionRules: [
    { verbs: "create|created|add|added|write|written", pastTense: "was created" },
    { verbs: "archive|archived", pastTense: "was archived" },
    { verbs: "delete|deleted|remove|removed", pastTense: "was deleted" },
  ],
  acceptEvent: (_event, canonicalPath) => !hasNotionAliasDirectory(canonicalPath),
});

const NOTION_DATABASE_ALIAS_SEGMENTS = new Set([
  "by-id",
  "by-title",
]);

const NOTION_PAGE_ALIAS_SEGMENTS = new Set([
  "by-database",
  "by-id",
  "by-parent",
  "by-title",
]);

const NOTION_USER_ALIAS_SEGMENTS = new Set([
  "by-id",
  "by-name",
]);

const NOTION_PAGE_CONTENT_LEAVES = new Set([
  "blocks",
  "comments.json",
  "content.md",
  "page.md",
]);

function hasNotionAliasDirectory(path: string): boolean {
  const segments = path.split("/").filter(Boolean);
  if (segments[0] !== "notion") return false;

  if (segments[1] === "databases") {
    const alias = segments[2];
    return Boolean(
      alias &&
        NOTION_DATABASE_ALIAS_SEGMENTS.has(alias) &&
        segments[3] !== "metadata.json" &&
        segments[3] !== "pages",
    );
  }

  if (segments[1] === "pages") {
    const alias = segments[2];
    return Boolean(
      alias &&
        NOTION_PAGE_ALIAS_SEGMENTS.has(alias) &&
        !NOTION_PAGE_CONTENT_LEAVES.has(segments[3] ?? ""),
    );
  }

  if (segments[1] === "users") {
    const alias = segments[2];
    return Boolean(alias && NOTION_USER_ALIAS_SEGMENTS.has(alias));
  }

  return false;
}

function notionIdentifier(path: string): string {
  const segments = path.split("/").filter(Boolean);
  const segment =
    segments.at(-1) === "page.md" || segments.at(-1) === "content.md"
      ? segments.at(-2) ?? path
      : segments.at(-1) ?? path;
  const basename = segment.replace(/\.[^.]+$/u, "");
  const separatorIndex = basename.lastIndexOf("__");
  return separatorIndex > 0 ? basename.slice(0, separatorIndex) : basename;
}
