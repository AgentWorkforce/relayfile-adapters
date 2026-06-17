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
  provider: "slack",
  identify: slackIdentifier,
  actionRules: [
    { verbs: "create|created|add|added|write|written|post|posted", pastTense: "was created" },
    { verbs: "unarchive|unarchived", pastTense: "was unarchived" },
    { verbs: "archive|archived", pastTense: "was archived" },
    { verbs: "delete|deleted|remove|removed", pastTense: "was deleted" },
  ],
});

function slackIdentifier(path: string): string {
  const segments = path.split("/").filter(Boolean);
  const tail = segments.at(-1);
  const segment =
    tail === "message.json" || tail === "profile.json" || tail === "meta.json"
      ? segments.at(-2) ?? path
      : tail ?? path;
  const basename = segment.replace(/\.[^.]+$/u, "");
  const separatorIndex = basename.lastIndexOf("__");
  const id = separatorIndex > 0 ? basename.slice(0, separatorIndex) : basename;

  if (path.includes("/messages/")) return `message ${id}`;
  if (path.includes("/channels/")) return `channel ${id}`;
  if (path.includes("/users/")) return `user ${id}`;
  return id;
}
