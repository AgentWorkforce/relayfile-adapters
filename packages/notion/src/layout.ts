import type { LayoutManifestProvider as CoreLayoutManifestProvider } from '@relayfile/adapter-core';

export type {
  LayoutManifest,
  LayoutManifestProvider,
  LayoutResourceManifest,
  MaterializationMode,
  WritebackResourceManifest,
} from '@relayfile/adapter-core';

export const layoutManifest: CoreLayoutManifestProvider = () => ({
  provider: 'notion',
  filenameConvention: '<slug>__<id>.json',
  aliasSegments: ['by-id', 'by-title', 'by-name'],
  resources: [
    {
      path: 'notion/pages',
      title: 'Pages',
      materialization: 'eager',
      aliasSegments: ['by-id', 'by-title'],
      writebackResources: [
        { path: 'notion/pages', schemaId: 'notion/page' },
        { path: 'notion/pages/comments', schemaId: 'notion/comment' },
      ],
    },
    {
      path: 'notion/databases',
      title: 'Databases',
      materialization: 'eager',
      aliasSegments: ['by-id', 'by-title'],
      writebackResources: [
        { path: 'notion/databases', schemaId: 'notion/database' },
      ],
    },
    {
      path: 'notion/users',
      title: 'Users',
      materialization: 'eager',
      aliasSegments: ['by-id', 'by-name'],
      writebackResources: [],
    },
  ],
});
