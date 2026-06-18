import type { LayoutManifestProvider as CoreLayoutManifestProvider } from "@relayfile/adapter-core";

export type {
  LayoutManifest,
  LayoutManifestProvider,
  LayoutResourceManifest,
  MaterializationMode,
  WritebackResourceManifest,
} from "@relayfile/adapter-core";

export const layoutManifest: CoreLayoutManifestProvider = () => ({
  provider: "neon",
  filenameConvention: "flat .json records keyed by Neon ids; consumption records are keyed by project/branch + metric + period start",
  aliasSegments: [
    "by-id",
    "by-org",
    "by-project",
    "by-branch",
    "by-state",
    "by-status",
    "by-metric",
    "by-level",
    "by-name",
  ],
  resources: [
    { path: "neon/organizations", title: "Organizations", materialization: "lazy", aliasSegments: ["by-id"], writebackResources: [] },
    { path: "neon/projects", title: "Projects", materialization: "lazy", aliasSegments: ["by-id", "by-org"], writebackResources: [] },
    { path: "neon/branches", title: "Branches", materialization: "lazy", aliasSegments: ["by-id", "by-project", "by-state"], writebackResources: [] },
    { path: "neon/endpoints", title: "Endpoints", materialization: "lazy", aliasSegments: ["by-id", "by-project", "by-branch", "by-state"], writebackResources: [] },
    { path: "neon/operations", title: "Operations", materialization: "lazy", aliasSegments: ["by-id", "by-project", "by-branch", "by-status"], writebackResources: [] },
    { path: "neon/consumption/projects", title: "Project consumption", materialization: "lazy", aliasSegments: ["by-id", "by-project", "by-metric"], writebackResources: [] },
    { path: "neon/consumption/branches", title: "Branch consumption", materialization: "lazy", aliasSegments: ["by-id", "by-branch", "by-metric"], writebackResources: [] },
    { path: "neon/spending-limits", title: "Organization spending limits", materialization: "lazy", aliasSegments: ["by-id"], writebackResources: [] },
    { path: "neon/advisors", title: "Advisor issues", materialization: "lazy", aliasSegments: ["by-id", "by-project", "by-level", "by-name"], writebackResources: [] },
  ],
});
