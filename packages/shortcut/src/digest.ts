import {
  createDigestHandler,
  type DigestBullet,
  type DigestChangeEvent,
  type DigestContext,
  type DigestHandler,
  type DigestSection,
  type DigestWindow,
} from "@relayfile/adapter-core/digest";

export type { DigestBullet, DigestChangeEvent, DigestContext, DigestHandler, DigestSection, DigestWindow };

export const digest: DigestHandler = createDigestHandler({
  provider: "shortcut",
  identify: (path) => path.split("/").filter(Boolean).at(-1)?.replace(/\.json$/u, "") ?? path,
  actionRules: [
    { verbs: "create|created|add|added|open|opened", pastTense: "was created" },
    { verbs: "delete|deleted|remove|removed", pastTense: "was deleted" },
    { verbs: "close|closed|resolve|resolved|complete|completed|done", pastTense: "was completed" },
    { verbs: "archive|archived", pastTense: "was archived" },
    { verbs: "update|updated|change|changed|edit|edited", pastTense: "was updated" },
  ],
  acceptEvent: (event) => {
    const rawPath = typeof event.path === "string"
      ? event.path
      : typeof event.canonicalPath === "string"
        ? event.canonicalPath
        : "";
    const path = rawPath.replace(/^\/+/, "");
    return path === "shortcut" || path.startsWith("shortcut/") && !isAuxiliary(path);
  },
});

function isAuxiliary(path: string): boolean {
  const parts = path.split("/").filter(Boolean);
  const leaf = parts.at(-1) ?? "";
  return leaf === "LAYOUT.md" || leaf === "_index.json" || parts.includes("by-id");
}
