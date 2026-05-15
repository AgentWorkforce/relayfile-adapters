import type { LayoutManifestProvider as CoreLayoutManifestProvider } from '@relayfile/adapter-core';

export type {
  LayoutManifest,
  LayoutManifestProvider,
  LayoutResourceManifest,
  MaterializationMode,
  WritebackResourceManifest,
} from '@relayfile/adapter-core';

export const layoutManifest: CoreLayoutManifestProvider = () => ({
  provider: 'github',
  filenameConvention: '<number>__<slug>/meta.json',
  // Top-level aliasSegments is the union of every resource's alias segments
  // so consumers that inspect only the manifest root can discover all
  // lookup keys. `by-name` belongs here because `github/repos` exposes it.
  aliasSegments: ['by-id', 'by-name', 'by-state', 'by-title'],
  resources: [
    {
      path: 'github/repos',
      title: 'Repositories',
      materialization: 'lazy',
      aliasSegments: ['by-name'],
      writebackResources: [],
    },
    {
      path: 'github/repos/*/*/issues',
      title: 'Issues',
      materialization: 'eager',
      aliasSegments: ['by-id', 'by-title', 'by-state'],
      writebackResources: [
        { path: 'github/repos/*/*/issues', schemaId: 'github/issue' },
        { path: 'github/repos/*/*/issues/comments', schemaId: 'github/issue-comment' },
      ],
    },
    {
      path: 'github/repos/*/*/pulls',
      title: 'Pull requests',
      materialization: 'eager',
      aliasSegments: ['by-id', 'by-title', 'by-state'],
      writebackResources: [
        { path: 'github/repos/*/*/pulls/reviews', schemaId: 'github/pull-request-review' },
      ],
    },
  ],
});
