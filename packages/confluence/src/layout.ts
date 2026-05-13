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
  provider: 'confluence',
  filenameConvention: '<slug>__<id>.json',
  aliasSegments: ['by-id', 'by-title', 'by-state'],
  resources: [
    {
      path: 'confluence/pages',
      title: 'Pages',
      materialization: 'eager',
      aliasSegments: ['by-id', 'by-title', 'by-state'],
      writebackResources: [
        { path: 'confluence/pages', schemaId: 'confluence/page' },
      ],
    },
    {
      path: 'confluence/spaces',
      title: 'Spaces',
      materialization: 'eager',
      aliasSegments: ['by-id', 'by-title'],
      writebackResources: [],
    },
  ],
});
