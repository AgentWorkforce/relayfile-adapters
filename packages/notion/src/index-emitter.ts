import {
  notionDatabasePagesIndexPath,
  notionDatabasesIndexPath,
  notionPagesIndexPath,
} from './path-mapper.js';
import type { NotionVfsFile } from './types.js';

interface NotionIndexRow {
  id: string;
  title: string;
  updated: string;
}

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const DATABASE_METADATA_PATTERN = /^\/notion\/databases\/([^/]+)\/metadata\.json$/u;
const DATABASE_PAGE_PATTERN = /^\/notion\/databases\/([^/]+)\/pages\/([^/]+)\.json$/u;
const STANDALONE_PAGE_PATTERN = /^\/notion\/pages\/([^/]+)\.json$/u;

export function buildIndexFiles(files: NotionVfsFile[]): NotionVfsFile[] {
  const databaseRows: NotionIndexRow[] = [];
  const standalonePageRows: NotionIndexRow[] = [];
  const databasePageRows = new Map<string, NotionIndexRow[]>();
  const knownDatabaseDirectories = new Set<string>();

  for (const file of files) {
    const databaseMetadataMatch = file.path.match(DATABASE_METADATA_PATTERN);
    if (databaseMetadataMatch) {
      const databaseDirectory = decodeURIComponent(databaseMetadataMatch[1] ?? '');
      knownDatabaseDirectories.add(databaseDirectory);
      databaseRows.push(toDatabaseRow(file));
      continue;
    }

    const databasePageMatch = file.path.match(DATABASE_PAGE_PATTERN);
    if (databasePageMatch) {
      const databaseDirectory = decodeURIComponent(databasePageMatch[1] ?? '');
      knownDatabaseDirectories.add(databaseDirectory);
      const rows = databasePageRows.get(databaseDirectory) ?? [];
      rows.push(toPageRow(file));
      databasePageRows.set(databaseDirectory, rows);
      continue;
    }

    if (STANDALONE_PAGE_PATTERN.test(file.path)) {
      standalonePageRows.push(toPageRow(file));
    }
  }

  const indexFiles: NotionVfsFile[] = [
    createIndexFile(notionDatabasesIndexPath(), databaseRows),
    createIndexFile(notionPagesIndexPath(), standalonePageRows),
  ];

  for (const databaseDirectory of [...knownDatabaseDirectories].sort()) {
    indexFiles.push(
      createIndexFile(
        notionDatabasePagesIndexPath(databaseDirectory),
        databasePageRows.get(databaseDirectory) ?? [],
      ),
    );
  }

  return indexFiles.sort((left, right) => left.path.localeCompare(right.path));
}

function toDatabaseRow(file: NotionVfsFile): NotionIndexRow {
  const record = parseCanonicalRecord(file);
  return {
    id: readString(record.id),
    title: readString(record.title),
    updated: readString(record.lastEditedTime) || readString(record.createdTime),
  };
}

function toPageRow(file: NotionVfsFile): NotionIndexRow {
  const record = parseCanonicalRecord(file);
  return {
    id: readString(record.id),
    title: readString(record.title),
    updated: readString(record.lastEditedTime) || readString(record.createdTime),
  };
}

function createIndexFile(path: string, rows: NotionIndexRow[]): NotionVfsFile {
  const sortedRows = [...rows].sort(compareIndexRows);
  return {
    path,
    contentType: JSON_CONTENT_TYPE,
    content: `${JSON.stringify(sortedRows)}\n`,
  };
}

function parseCanonicalRecord(file: NotionVfsFile): Record<string, unknown> {
  try {
    const parsed = JSON.parse(file.content) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function compareIndexRows(left: NotionIndexRow, right: NotionIndexRow): number {
  if (left.updated !== right.updated) {
    return right.updated.localeCompare(left.updated);
  }
  return left.id.localeCompare(right.id);
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
