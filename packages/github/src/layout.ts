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
  provider: 'github',
  filenameConvention: '<number>__<slug>/meta.json',
  // Top-level aliasSegments is the union of every resource's alias segments
  // so consumers that inspect only the manifest root can discover all
  // lookup keys. `by-name` belongs here because `github/repos` exposes it.
  aliasSegments: ['by-id', 'by-name', 'by-title'],
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
      aliasSegments: ['by-id', 'by-title'],
      writebackResources: [
        { path: 'github/repos/*/*/issues', schemaId: 'github/issue' },
        { path: 'github/repos/*/*/issues/comments', schemaId: 'github/issue-comment' },
      ],
    },
    {
      path: 'github/repos/*/*/pulls',
      title: 'Pull requests',
      materialization: 'eager',
      aliasSegments: ['by-id', 'by-title'],
      writebackResources: [
        { path: 'github/repos/*/*/pulls/reviews', schemaId: 'github/pull-request-review' },
      ],
    },
  ],
});
