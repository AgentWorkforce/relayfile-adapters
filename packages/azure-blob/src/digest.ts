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
  provider: "azure-blob",
  pathPrefixes: ["azure", "azure-blob"],
  identify: (canonicalPath) => azureBlobIdentifier(canonicalPath),
  alias: { segments: [] },
  classify: (event) => pastTense(event),
});

function azureBlobIdentifier(path: string): string {
  const segments = path.split("/").filter(Boolean);
  const blob = segments.length > 3 ? segments.slice(3).join("/") : segments.at(-1) ?? path;
  return `blob ${blob}`;
}

function pastTense(event: DigestChangeEvent): string {
  const action = (event.action ?? event.eventType ?? event.type ?? "").toLowerCase();
  if (matchVerb(action, "create|created|put|upload|uploaded|write|written")) {
    return "was uploaded";
  }
  if (matchVerb(action, "copy|copied|snapshot|snapshotted")) {
    return "was copied";
  }
  if (matchVerb(action, "archive|archived|tier|tiered")) {
    return "was archived";
  }
  if (matchVerb(action, "delete|deleted|remove|removed")) {
    return "was deleted";
  }
  return "was modified";
}

function matchVerb(action: string, verbs: string): boolean {
  return verbs.split("|").some((verb) => action.includes(verb));
}
