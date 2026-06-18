import type { LayoutManifestProvider as CoreLayoutManifestProvider } from "@relayfile/adapter-core";

export type {
  LayoutManifest,
  LayoutManifestProvider,
  LayoutResourceManifest,
  MaterializationMode,
  WritebackResourceManifest,
} from "@relayfile/adapter-core";

export const layoutManifest: CoreLayoutManifestProvider = () => ({
  provider: "cloudflare",
  filenameConvention: "flat .json records keyed by provider ids",
  aliasSegments: ["by-id"],
  resources: [
    { path: "cloudflare/workers/scripts", title: "Workers scripts", materialization: "lazy", aliasSegments: ["by-id"], writebackResources: [] },
    { path: "cloudflare/analytics/workers/scripts", title: "Workers usage summaries", materialization: "lazy", aliasSegments: ["by-id"], writebackResources: [] },
    { path: "cloudflare/pages/projects", title: "Pages projects", materialization: "lazy", aliasSegments: ["by-id"], writebackResources: [] },
    { path: "cloudflare/d1/databases", title: "D1 databases", materialization: "lazy", aliasSegments: ["by-id"], writebackResources: [] },
    { path: "cloudflare/kv/namespaces", title: "KV namespaces", materialization: "lazy", aliasSegments: ["by-id"], writebackResources: [] },
    { path: "cloudflare/r2/buckets", title: "R2 buckets", materialization: "lazy", aliasSegments: ["by-id"], writebackResources: [] },
    { path: "cloudflare/queues", title: "Queues", materialization: "lazy", aliasSegments: ["by-id"], writebackResources: [] },
    { path: "cloudflare/tunnels", title: "Cloudflare Tunnels", materialization: "lazy", aliasSegments: ["by-id"], writebackResources: [] },
    { path: "cloudflare/zones", title: "Zones", materialization: "lazy", aliasSegments: ["by-id"], writebackResources: [] },
    { path: "cloudflare/notifications/webhooks", title: "Notification webhooks", materialization: "lazy", aliasSegments: ["by-id"], writebackResources: [] },
    { path: "cloudflare/notifications/policies", title: "Notification policies", materialization: "lazy", aliasSegments: ["by-id"], writebackResources: [] },
    { path: "cloudflare/notifications/events", title: "Notification events", materialization: "lazy", aliasSegments: ["by-id"], writebackResources: [] },
  ],
});
