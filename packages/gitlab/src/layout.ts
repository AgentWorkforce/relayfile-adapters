import type { LayoutManifestProvider as CoreLayoutManifestProvider } from '@relayfile/adapter-core';

export type {
  LayoutManifest,
  LayoutManifestProvider,
  LayoutResourceManifest,
  MaterializationMode,
  WritebackResourceManifest,
} from '@relayfile/adapter-core';

export const layoutManifest: CoreLayoutManifestProvider = () => ({
  provider: 'gitlab',
  filenameConvention: '<id>__<slug>/meta.json',
  aliasSegments: ['by-assignee', 'by-creator', 'by-id', 'by-priority', 'by-ref', 'by-state', 'by-status', 'by-title'],
  resources: [
    {
      path: 'gitlab/projects',
      title: 'Projects',
      materialization: 'eager',
      aliasSegments: [],
      writebackResources: [],
    },
    {
      path: 'gitlab/projects/**/merge_requests',
      title: 'Merge requests',
      materialization: 'eager',
      aliasSegments: ['by-id', 'by-title', 'by-state', 'by-assignee', 'by-creator', 'by-priority'],
      writebackResources: [
        { path: 'gitlab/projects/**/merge_requests', schemaId: 'gitlab/merge-request' },
        { path: 'gitlab/projects/**/merge_requests/discussions', schemaId: 'gitlab/merge-request-discussion' },
      ],
    },
    {
      path: 'gitlab/projects/**/issues',
      title: 'Issues',
      materialization: 'eager',
      aliasSegments: ['by-id', 'by-title', 'by-state', 'by-assignee', 'by-creator', 'by-priority'],
      writebackResources: [
        { path: 'gitlab/projects/**/issues', schemaId: 'gitlab/issue' },
        { path: 'gitlab/projects/**/issues/comments', schemaId: 'gitlab/issue-comment' },
      ],
    },
    {
      path: 'gitlab/projects/**/pipelines',
      title: 'Pipelines',
      materialization: 'eager',
      aliasSegments: ['by-id', 'by-ref', 'by-status'],
      writebackResources: [],
    },
    {
      path: 'gitlab/projects/**/commits',
      title: 'Commits',
      materialization: 'eager',
      aliasSegments: ['by-id', 'by-title'],
      writebackResources: [],
    },
    {
      path: 'gitlab/projects/**/deployments',
      title: 'Deployments',
      materialization: 'eager',
      aliasSegments: ['by-status'],
      writebackResources: [],
    },
    {
      path: 'gitlab/projects/**/tags',
      title: 'Tags',
      materialization: 'eager',
      aliasSegments: ['by-ref'],
      writebackResources: [],
    },
  ],
});
