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
  aliasSegments: ['by-database', 'by-edited', 'by-id', 'by-name', 'by-parent', 'by-title'],
  resources: [
    {
      path: 'notion/pages',
      title: 'Pages',
      materialization: 'eager',
      aliasSegments: ['by-id', 'by-title', 'by-database', 'by-parent', 'by-edited'],
      writebackResources: [
        { path: 'notion/pages/*', schemaId: 'notion/page' },
        { path: 'notion/pages/*/properties', schemaId: 'notion/page-properties' },
        { path: 'notion/pages/*/content', schemaId: 'notion/page-content' },
        { path: 'notion/pages/*/comments', schemaId: 'notion/comment' },
      ],
    },
    {
      path: 'notion/databases',
      title: 'Databases',
      materialization: 'eager',
      aliasSegments: ['by-id', 'by-title'],
      writebackResources: [
        { path: 'notion/databases', schemaId: 'notion/database' },
        { path: 'notion/databases/*/pages', schemaId: 'notion/page' },
        { path: 'notion/databases/*/pages/*', schemaId: 'notion/page' },
        { path: 'notion/databases/*/pages/*/properties', schemaId: 'notion/page-properties' },
        { path: 'notion/databases/*/pages/*/content', schemaId: 'notion/page-content' },
        { path: 'notion/databases/*/pages/*/comments', schemaId: 'notion/comment' },
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
