import type { LayoutManifestProvider as CoreLayoutManifestProvider } from '@relayfile/adapter-core';

export type {
  LayoutManifest,
  LayoutManifestProvider,
  LayoutResourceManifest,
  MaterializationMode,
  WritebackResourceManifest,
} from '@relayfile/adapter-core';

export const layoutManifest: CoreLayoutManifestProvider = () => ({
  provider: 'x',
  filenameConvention: '<slug>__<id>.json for flat records; <id>__<slug>/meta.json for saved searches',
  aliasSegments: ['by-author', 'by-conversation', 'by-id', 'by-query', 'by-username'],
  resources: [
    {
      path: 'x/searches',
      title: 'Searches',
      materialization: 'eager',
      aliasSegments: ['by-id', 'by-query'],
      writebackResources: [],
    },
    {
      path: 'x/posts',
      title: 'Posts',
      materialization: 'eager',
      aliasSegments: ['by-id', 'by-author', 'by-conversation', 'by-query'],
      writebackResources: [],
    },
    {
      path: 'x/users',
      title: 'Users',
      materialization: 'lazy',
      aliasSegments: ['by-id', 'by-username'],
      writebackResources: [],
    },
  ],
});
