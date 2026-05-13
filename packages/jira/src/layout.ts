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
  provider: 'jira',
  filenameConvention: '<key-or-slug>__<id>.json',
  aliasSegments: ['by-id', 'by-title', 'by-state'],
  resources: [
    {
      path: 'jira/issues',
      title: 'Issues',
      materialization: 'eager',
      aliasSegments: ['by-id', 'by-title', 'by-state'],
      writebackResources: [
        { path: 'jira/issues', schemaId: 'jira/issue' },
        { path: 'jira/issues/comments', schemaId: 'jira/comment' },
        { path: 'jira/issues/transitions', schemaId: 'jira/transition' },
      ],
    },
    {
      path: 'jira/projects',
      title: 'Projects',
      materialization: 'eager',
      aliasSegments: ['by-id', 'by-title'],
      writebackResources: [],
    },
    {
      path: 'jira/sprints',
      title: 'Sprints',
      materialization: 'eager',
      aliasSegments: ['by-id', 'by-title'],
      writebackResources: [],
    },
  ],
});
