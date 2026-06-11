import type { LayoutManifestProvider as CoreLayoutManifestProvider } from '@relayfile/adapter-core';

export type {
  LayoutManifest,
  LayoutManifestProvider,
  LayoutResourceManifest,
  MaterializationMode,
  WritebackResourceManifest,
} from '@relayfile/adapter-core';

export const layoutManifest: CoreLayoutManifestProvider = () => ({
  provider: 'linear',
  filenameConvention: '<identifier>__<uuid>.json',
  // Top-level aliasSegments is the union of every resource's alias segments
  // so consumers that inspect only the manifest root can discover all
  // lookup keys. `by-name` belongs here because `linear/teams` exposes it.
  aliasSegments: ['by-assignee', 'by-creator', 'by-edited', 'by-id', 'by-name', 'by-priority', 'by-title', 'by-state', 'by-uuid'],
  resources: [
    {
      path: 'linear/issues',
      title: 'Issues',
      materialization: 'eager',
      aliasSegments: ['by-uuid', 'by-id', 'by-title', 'by-state', 'by-assignee', 'by-creator', 'by-priority', 'by-edited'],
      writebackResources: [
        { path: 'linear/issues', schemaId: 'linear/issue' },
        { path: 'linear/issues/comments', schemaId: 'linear/comment' },
      ],
    },
    {
      path: 'linear/projects',
      title: 'Projects',
      materialization: 'eager',
      aliasSegments: ['by-id', 'by-title'],
      writebackResources: [],
    },
    {
      path: 'linear/states',
      title: 'Workflow States',
      materialization: 'eager',
      aliasSegments: [],
      writebackResources: [],
    },
    {
      path: 'linear/teams',
      title: 'Teams',
      materialization: 'eager',
      aliasSegments: ['by-id', 'by-name'],
      writebackResources: [],
    },
  ],
});
