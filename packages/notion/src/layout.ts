export type MaterializationMode = 'eager' | 'lazy';

export interface WritebackResourceManifest {
  readonly path: string;
  readonly schemaId: string;
}

export interface LayoutResourceManifest {
  readonly path: string;
  readonly title: string;
  readonly materialization: MaterializationMode;
  readonly aliasSegments: readonly string[];
  readonly writebackResources: readonly WritebackResourceManifest[];
}

export interface LayoutManifest {
  readonly provider: string;
  readonly filenameConvention: string;
  readonly aliasSegments: readonly string[];
  readonly resources: readonly LayoutResourceManifest[];
}

export type LayoutManifestProvider = () => LayoutManifest;

export const layoutManifest: LayoutManifestProvider = () => ({
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
