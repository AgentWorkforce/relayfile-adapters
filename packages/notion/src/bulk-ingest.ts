import type { RelayFileClient, WriteQueuedResponse } from '@relayfile/sdk';
import { ingestDatabaseArtifacts } from './databases/ingestion.js';
import { ingestPageArtifacts, retrievePage } from './pages/ingestion.js';
import type { NotionApiClient } from './client.js';
import type { NotionVfsFile } from './types.js';

export async function collectWorkspaceFiles(client: NotionApiClient): Promise<NotionVfsFile[]> {
  const files: NotionVfsFile[] = [];

  for (const databaseId of client.config.databaseIds ?? []) {
    files.push(...(await ingestDatabaseArtifacts(client, databaseId)));
  }

  for (const pageId of client.config.pageIds ?? []) {
    const page = await retrievePage(client, pageId);
    files.push(...(await ingestPageArtifacts(client, page)));
  }

  return files;
}

export async function writeWorkspaceFiles(
  relayClient: RelayFileClient,
  workspaceId: string,
  files: NotionVfsFile[],
): Promise<WriteQueuedResponse[]> {
  return Promise.all(
    files.map(async (file) => {
      const baseRevision = await resolveBaseRevision(relayClient, workspaceId, file.path);
      return relayClient.writeFile({
        workspaceId,
        path: file.path,
        baseRevision,
        contentType: file.contentType,
        content: file.content,
        semantics: file.semantics,
      });
    }),
  );
}

async function resolveBaseRevision(relayClient: RelayFileClient, workspaceId: string, path: string): Promise<string> {
  try {
    const existing = await relayClient.readFile(workspaceId, path);
    return existing.revision;
  } catch {
    return '0';
  }
}
