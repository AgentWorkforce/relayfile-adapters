import type { LayoutManifestProvider as CoreLayoutManifestProvider } from '@relayfile/adapter-core';

export type {
  LayoutManifest,
  LayoutManifestProvider,
  LayoutResourceManifest,
  MaterializationMode,
  WritebackResourceManifest,
} from '@relayfile/adapter-core';

export const layoutManifest: CoreLayoutManifestProvider = () => ({
  provider: 'jira',
  filenameConvention: '<key-or-slug>__<id>.json',
  aliasSegments: ['by-assignee', 'by-creator', 'by-id', 'by-priority', 'by-title', 'by-state'],
  resources: [
    {
      path: 'jira/issues',
      title: 'Issues',
      materialization: 'eager',
      aliasSegments: ['by-id', 'by-title', 'by-state', 'by-assignee', 'by-creator', 'by-priority'],
      writebackResources: [
        { path: 'jira/issues', schemaId: 'jira/issue' },
        { path: 'jira/issues/comments', schemaId: 'jira/comment' },
        { path: 'jira/issues/transitions', schemaId: 'jira/transition' },
      ],
    },
    {
      path: 'jira/projects',
      title: 'Projects',
      materialization: 'eager',
      aliasSegments: ['by-id', 'by-title'],
      writebackResources: [],
    },
    {
      path: 'jira/sprints',
      title: 'Sprints',
      materialization: 'eager',
      aliasSegments: ['by-id', 'by-title'],
      writebackResources: [],
    },
  ],
});
