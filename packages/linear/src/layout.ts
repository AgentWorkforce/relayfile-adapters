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
  provider: 'linear',
  filenameConvention: '<identifier>__<uuid>.json',
  // Top-level aliasSegments is the union of every resource's alias segments
  // so consumers that inspect only the manifest root can discover all
  // lookup keys. `by-name` belongs here because `linear/teams` exposes it.
  aliasSegments: ['by-id', 'by-name', 'by-title', 'by-state'],
  resources: [
    {
      path: 'linear/issues',
      title: 'Issues',
      materialization: 'eager',
      aliasSegments: ['by-id', 'by-title', 'by-state'],
      writebackResources: [
        { path: 'linear/issues', schemaId: 'linear/issue' },
        { path: 'linear/issues/comments', schemaId: 'linear/comment' },
      ],
    },
    {
      path: 'linear/projects',
      title: 'Projects',
      materialization: 'eager',
      aliasSegments: ['by-id', 'by-title'],
      writebackResources: [],
    },
    {
      path: 'linear/teams',
      title: 'Teams',
      materialization: 'eager',
      aliasSegments: ['by-id', 'by-name'],
      writebackResources: [],
    },
  ],
});
