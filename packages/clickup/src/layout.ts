import type { LayoutManifestProvider as CoreLayoutManifestProvider } from '@relayfile/adapter-core';

export type {
  LayoutManifest,
  LayoutManifestProvider,
  LayoutResourceManifest,
  MaterializationMode,
  WritebackResourceManifest,
} from '@relayfile/adapter-core';

export const layoutManifest: CoreLayoutManifestProvider = () => ({
  provider: 'clickup',
  filenameConvention: '<id>.json',
  aliasSegments: ['by-assignee', 'by-creator', 'by-id', 'by-priority', 'by-state'],
  resources: [
    {
      path: 'clickup/tasks',
      title: 'Tasks',
      materialization: 'eager',
      aliasSegments: ['by-id', 'by-state', 'by-assignee', 'by-creator', 'by-priority'],
      writebackResources: [
        { path: 'clickup/tasks', schemaId: 'clickup/task' },
      ],
    },
    {
      path: 'clickup/lists',
      title: 'Lists',
      materialization: 'eager',
      aliasSegments: [],
      writebackResources: [
        { path: 'clickup/lists', schemaId: 'clickup/list' },
      ],
    },
  ],
});
