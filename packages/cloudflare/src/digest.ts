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
  provider: "cloudflare",
  identify: cloudflareIdentifier,
  alias: {
    mode: "any",
    segments: ["by-id"],
  },
  actionRules: [
    { verbs: "create|created|add|added|initialize|initialized", pastTense: "was created" },
    { verbs: "update|updated|change|changed|sync|synced", pastTense: "was updated" },
    { verbs: "delete|deleted|remove|removed", pastTense: "was deleted" },
    { verbs: "open|opened|start|started", pastTense: "started" },
    { verbs: "close|closed|resolve|resolved|end|ended", pastTense: "was resolved" },
    { verbs: "archive|archived", pastTense: "was archived" },
    { verbs: "complete|completed", pastTense: "was completed" },
    { verbs: "cancel|canceled|cancelled", pastTense: "was canceled" },
    { verbs: "merge|merged", pastTense: "was merged" },
    { verbs: "fire|fired|alert", pastTense: "fired" },
  ],
});

function cloudflareIdentifier(path: string): string {
  const basename = path.split("/").filter(Boolean).at(-1)?.replace(/\.[^.]+$/u, "") ?? path;
  if (path.includes("/analytics/workers/scripts/")) return `Worker usage ${basename}`;
  if (path.includes("/workers/scripts/")) return `Worker script ${basename}`;
  if (path.includes("/pages/projects/")) return `Pages project ${basename}`;
  if (path.includes("/d1/databases/")) return `D1 database ${basename}`;
  if (path.includes("/kv/namespaces/")) return `KV namespace ${basename}`;
  if (path.includes("/r2/buckets/")) return `R2 bucket ${basename}`;
  if (path.includes("/queues/")) return `queue ${basename}`;
  if (path.includes("/tunnels/")) return `tunnel ${basename}`;
  if (path.includes("/zones/") && path.includes("/dns-records/")) return `DNS record ${basename}`;
  if (path.includes("/zones/")) return `zone ${basename}`;
  if (path.includes("/notifications/webhooks/")) return `notification webhook ${basename}`;
  if (path.includes("/notifications/policies/")) return `notification policy ${basename}`;
  if (path.includes("/notifications/events/")) return `notification event ${basename}`;
  return basename;
}
