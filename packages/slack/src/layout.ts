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
  provider: 'slack',
  filenameConvention: '<id>__<slug>/meta.json',
  aliasSegments: ['by-id', 'by-name'],
  resources: [
    {
      path: 'slack/channels',
      title: 'Channels',
      materialization: 'eager',
      aliasSegments: ['by-id', 'by-name'],
      writebackResources: [
        { path: 'slack/channels/messages', schemaId: 'slack/message' },
        { path: 'slack/channels/messages/reactions', schemaId: 'slack/reaction' },
      ],
    },
    {
      path: 'slack/users',
      title: 'Users',
      materialization: 'eager',
      aliasSegments: ['by-id', 'by-name'],
      writebackResources: [],
    },
  ],
});
