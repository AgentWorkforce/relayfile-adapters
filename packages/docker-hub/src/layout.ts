import type { LayoutManifestProvider as CoreLayoutManifestProvider } from '@relayfile/adapter-core';

export type {
  LayoutManifest,
  LayoutManifestProvider,
  LayoutResourceManifest,
  MaterializationMode,
  WritebackResourceManifest,
} from '@relayfile/adapter-core';

export const layoutManifest: CoreLayoutManifestProvider = () => ({
  provider: 'docker-hub',
  filenameConvention: 'repositories use /repositories/<namespace>/<name>.json; tags and webhooks live under their parent repository',
  aliasSegments: ['by-id', 'by-namespace', 'by-repository'],
  resources: [
    {
      path: 'docker-hub/repositories',
      title: 'Repositories',
      materialization: 'eager',
      aliasSegments: ['by-id', 'by-namespace'],
      writebackResources: [],
    },
    {
      path: 'docker-hub/tags',
      title: 'Tags',
      materialization: 'eager',
      aliasSegments: ['by-id'],
      writebackResources: [],
    },
    {
      path: 'docker-hub/webhooks',
      title: 'Webhooks',
      materialization: 'eager',
      aliasSegments: ['by-id', 'by-repository'],
      writebackResources: [],
    },
  ],
});
