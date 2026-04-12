import type { NotionVfsFile } from '../types.js';

export type DiscoveryDepth = 'metadata' | 'full';

export interface ContentMetadataItem {
  id: string;
  type: 'database' | 'page';
  title?: string;
  path?: string;
  lastModified?: string;
  parentId?: string;
}

export interface ContentMetadataManifest {
  generatedAt: string;
  itemCount: number;
  items: ContentMetadataItem[];
}

export interface DiscoverOptions {
  depth?: DiscoveryDepth;
  concurrency?: number;
  signal?: AbortSignal;
  ingestDatabases?: boolean;
  ingestPages?: boolean;
}

export interface DiscoverResult {
  manifest: ContentMetadataManifest;
  ingestedFiles: NotionVfsFile[];
}
