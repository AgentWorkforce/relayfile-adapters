import type { LayoutManifestProvider as CoreLayoutManifestProvider } from '@relayfile/adapter-core';

export type {
  LayoutManifest,
  LayoutManifestProvider,
  LayoutResourceManifest,
  MaterializationMode,
  WritebackResourceManifest,
} from '@relayfile/adapter-core';

export const layoutManifest: CoreLayoutManifestProvider = () => ({
  provider: 'confluence',
  filenameConvention: '<slug>__<id>.json',
  aliasSegments: ['by-edited', 'by-id', 'by-key', 'by-parent', 'by-space', 'by-state', 'by-title'],
  resources: [
    {
      path: 'confluence/pages',
      title: 'Pages',
      materialization: 'eager',
      aliasSegments: ['by-id', 'by-title', 'by-state', 'by-space', 'by-parent', 'by-edited'],
      writebackResources: [
        { path: 'confluence/pages', schemaId: 'confluence/page' },
      ],
    },
    {
      path: 'confluence/spaces',
      title: 'Spaces',
      materialization: 'eager',
      aliasSegments: ['by-id', 'by-title', 'by-key'],
      writebackResources: [],
    },
  ],
});
