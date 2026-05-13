import {
  notionDatabasePagesIndexPath,
  notionDatabasesIndexPath,
  notionPagesIndexPath,
  notionRootIndexPath,
  notionUsersIndexPath,
} from './path-mapper.js';
import type { NotionVfsFile } from './types.js';

export interface NotionRootIndexRow {
  id: string;
  title: string;
}

export interface NotionRootIndexFile {
  path: string;
  contentType: 'application/json; charset=utf-8';
  content: string;
}

/**
 * Build `/notion/_index.json` — a static listing of top-level resource roots
 * the Notion adapter exposes. Mirrors the slack pattern so an agent can
 * `ls /notion/` and discover the available buckets.
 */
export function buildNotionRootIndexFile(
  rows: NotionRootIndexRow[] = [
    { id: 'pages', title: 'Pages' },
    { id: 'databases', title: 'Databases' },
    { id: 'users', title: 'Users' },
  ],
): NotionRootIndexFile {
  return {
    path: notionRootIndexPath(),
    contentType: 'application/json; charset=utf-8',
    content: `${JSON.stringify(rows)}\n`,
  };
}

/**
 * `_index.json` row schema.
 *
 * Each row carries both the canonical Notion UUID **and** the human-readable
 * identifier so an agent can resolve a UUID without reading every record:
 *
 *   jq '.[] | select(.title=="Tasks") | .id' /notion/databases/_index.json
 *
 * `parent_id` and `parent_type` were added so the index doubles as a
 * cheap workspace topology — agents can answer "what are this page's
 * siblings?" or "which database is this page in?" from the index alone.
 *
 * `parent_type` is one of:
 *   - `database`  — page lives in a database (parent is the database UUID)
 *   - `page`      — page is a child of another page (parent is a page UUID)
 *   - `workspace` — page lives directly under the workspace root
 *
 * For database rows, `parent_id` is null and `parent_type` is "workspace"
 * because Notion's API doesn't surface a stable parent for databases at
 * normalize time. The fields are emitted anyway so the row shape is
 * uniform across all notion `_index.json` files.
 */
interface NotionIndexRow {
  id: string;
  title: string;
  updated: string;
  parent_id: string | null;
  parent_type: 'database' | 'page' | 'workspace';
}

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const DATABASE_METADATA_PATTERN = /^\/notion\/databases\/([^/]+)\/metadata\.json$/u;
const DATABASE_PAGE_PATTERN = /^\/notion\/databases\/([^/]+)\/pages\/([^/]+)\.json$/u;
const STANDALONE_PAGE_PATTERN = /^\/notion\/pages\/([^/]+)\.json$/u;
const USER_PATTERN = /^\/notion\/users\/([^/]+)\.json$/u;

export function buildIndexFiles(files: NotionVfsFile[]): NotionVfsFile[] {
  const databaseRows: NotionIndexRow[] = [];
  const standalonePageRows: NotionIndexRow[] = [];
  const userRows: NotionIndexRow[] = [];
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
      continue;
    }

    if (USER_PATTERN.test(file.path)) {
      userRows.push(toUserRow(file));
    }
  }

  const indexFiles: NotionVfsFile[] = [
    createIndexFile(notionDatabasesIndexPath(), databaseRows),
    createIndexFile(notionPagesIndexPath(), standalonePageRows),
  ];

  if (userRows.length > 0) {
    indexFiles.push(createIndexFile(notionUsersIndexPath(), userRows));
  }

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
  // Notion databases don't carry a stable parent in the normalized
  // record shape today. We still emit the parent fields so every row in
  // every notion `_index.json` has the same key set and downstream
  // consumers don't have to special-case database rows.
  return {
    id: readString(record.id),
    title: readString(record.title),
    updated: readString(record.lastEditedTime) || readString(record.createdTime),
    parent_id: null,
    parent_type: 'workspace',
  };
}

function toPageRow(file: NotionVfsFile): NotionIndexRow {
  const record = parseCanonicalRecord(file);
  const parent = readParent(record.parent);
  return {
    id: readString(record.id),
    title: readString(record.title),
    updated: readString(record.lastEditedTime) || readString(record.createdTime),
    parent_id: parent.id,
    parent_type: parent.type,
  };
}

function toUserRow(file: NotionVfsFile): NotionIndexRow {
  const record = parseCanonicalRecord(file);
  return {
    id: readString(record.id),
    title: readString(record.name),
    updated: readString(record.lastEditedTime) || readString(record.createdTime),
    parent_id: null,
    parent_type: 'workspace',
  };
}

/**
 * Extract `(parent_id, parent_type)` from a normalized page record. The
 * normalized shape uses Notion's native `parent` discriminated union:
 *   { type: 'database_id', database_id: '<uuid>' }
 *   { type: 'page_id', page_id: '<uuid>' }
 *   { type: 'workspace', workspace: true }
 *   { type: 'block_id', block_id: '<uuid>' }   ← treated as 'page' since
 *                                                blocks live under pages
 */
function readParent(parent: unknown): { id: string | null; type: NotionIndexRow['parent_type'] } {
  if (!parent || typeof parent !== 'object') {
    return { id: null, type: 'workspace' };
  }
  const record = parent as Record<string, unknown>;
  const type = record.type;
  if (type === 'database_id') {
    return { id: readString(record.database_id) || null, type: 'database' };
  }
  if (type === 'page_id') {
    return { id: readString(record.page_id) || null, type: 'page' };
  }
  if (type === 'block_id') {
    return { id: readString(record.block_id) || null, type: 'page' };
  }
  return { id: null, type: 'workspace' };
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
