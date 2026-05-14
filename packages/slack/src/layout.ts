import type { LayoutManifestProvider as CoreLayoutManifestProvider } from '@relayfile/adapter-core';

export type {
  LayoutManifest,
  LayoutManifestProvider,
  LayoutResourceManifest,
  MaterializationMode,
  WritebackResourceManifest,
} from '@relayfile/adapter-core';

export const layoutManifest: CoreLayoutManifestProvider = () => ({
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
