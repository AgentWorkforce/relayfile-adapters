import type { LayoutManifestProvider as CoreLayoutManifestProvider } from '@relayfile/adapter-core';

export type {
  LayoutManifest,
  LayoutManifestProvider,
  LayoutResourceManifest,
  MaterializationMode,
  WritebackResourceManifest,
} from '@relayfile/adapter-core';

export const layoutManifest: CoreLayoutManifestProvider = () => ({
  provider: 'asana',
  filenameConvention: '<gid>.json',
  aliasSegments: ['by-assignee', 'by-creator', 'by-id', 'by-priority', 'by-state'],
  resources: [
    {
      path: 'asana/tasks',
      title: 'Tasks',
      materialization: 'eager',
      aliasSegments: ['by-id', 'by-state', 'by-assignee', 'by-creator', 'by-priority'],
      writebackResources: [
        { path: 'asana/tasks', schemaId: 'asana/task' },
      ],
    },
    {
      path: 'asana/projects',
      title: 'Projects',
      materialization: 'eager',
      aliasSegments: [],
      writebackResources: [
        { path: 'asana/projects', schemaId: 'asana/project' },
      ],
    },
  ],
});
