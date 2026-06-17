import type { LayoutManifestProvider as CoreLayoutManifestProvider } from "@relayfile/adapter-core";

export type {
  LayoutManifest,
  LayoutManifestProvider,
  LayoutResourceManifest,
  MaterializationMode,
  WritebackResourceManifest,
} from "@relayfile/adapter-core";

export const layoutManifest: CoreLayoutManifestProvider = () => ({
  provider: "gcp",
  filenameConvention: "flat .json records keyed by provider ids; billing is fixed at /gcp/billing/current.json",
  aliasSegments: [
    "by-id",
    "by-region",
    "by-service",
    "by-state",
    "by-status",
    "by-title",
  ],
  resources: [
    {
      path: "gcp/run/services",
      title: "Cloud Run services",
      materialization: "lazy",
      aliasSegments: ["by-id", "by-region", "by-status"],
      writebackResources: [],
    },
    {
      path: "gcp/monitoring/alerts",
      title: "Monitoring alert policies",
      materialization: "lazy",
      aliasSegments: ["by-id", "by-title", "by-state"],
      writebackResources: [],
    },
    {
      path: "gcp/billing",
      title: "Cloud Billing current state",
      materialization: "lazy",
      aliasSegments: [],
      writebackResources: [],
    },
    {
      path: "gcp/error-reporting/groups",
      title: "Error Reporting groups",
      materialization: "lazy",
      aliasSegments: ["by-id", "by-service", "by-status"],
      writebackResources: [],
    },
  ],
});
