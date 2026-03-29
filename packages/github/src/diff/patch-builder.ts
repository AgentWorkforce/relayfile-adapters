import { parseHunkHeader, tokenize, type DiffToken } from './tokenizer.js';

export type FilePatchStatus = 'added' | 'deleted' | 'modified' | 'renamed';
export type DiffLineType = 'add' | 'remove' | 'context';

export interface FilePatch {
  oldPath: string | null;
  newPath: string | null;
  status: FilePatchStatus;
  isBinary: boolean;
  hunks: Hunk[];
}

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface DiffLine {
  type: DiffLineType;
  content: string;
  oldLineNo?: number;
  newLineNo?: number;
}

interface DiffHeaderPaths {
  oldPath: string | null;
  newPath: string | null;
}

export function buildPatches(tokens: DiffToken[]): FilePatch[] {
  const groups = groupTokensByDiffHeader(tokens);
  return groups.map((group) => buildFilePatch(group));
}

export function parseDiff(rawDiff: string): FilePatch[] {
  return buildPatches(tokenize(rawDiff));
}

export function getPatchForFile(patches: FilePatch[], path: string): FilePatch | null {
  return patches.find((patch) => patch.oldPath === path || patch.newPath === path) ?? null;
}

function groupTokensByDiffHeader(tokens: DiffToken[]): DiffToken[][] {
  const groups: DiffToken[][] = [];
  let current: DiffToken[] | null = null;

  for (const token of tokens) {
    if (token.type === 'diff_header') {
      if (current && current.length > 0) {
        groups.push(current);
      }

      current = [token];
      continue;
    }

    if (current) {
      current.push(token);
    }
  }

  if (current && current.length > 0) {
    groups.push(current);
  }

  return groups;
}

function buildFilePatch(tokens: DiffToken[]): FilePatch {
  const header = tokens[0];
  if (!header || header.type !== 'diff_header') {
    throw new Error('Each patch must begin with a diff header token.');
  }

  const headerPaths = parseDiffHeaderPaths(header.value);
  const oldFileToken = tokens.find((token) => token.type === 'old_file');
  const newFileToken = tokens.find((token) => token.type === 'new_file');
  const oldPath = oldFileToken ? parseFileMarkerPath(oldFileToken.value) : headerPaths.oldPath;
  const newPath = newFileToken ? parseFileMarkerPath(newFileToken.value) : headerPaths.newPath;

  return {
    oldPath,
    newPath,
    status: determineStatus(tokens, oldPath, newPath),
    isBinary: tokens.some((token) => token.type === 'binary'),
    hunks: buildHunks(tokens),
  };
}

function determineStatus(
  tokens: DiffToken[],
  oldPath: string | null,
  newPath: string | null,
): FilePatchStatus {
  const hasRenameMetadata = tokens.some((token) => token.type === 'rename');
  const hasNewFileMode = tokens.some(
    (token) => token.type === 'mode' && token.value.startsWith('new file mode '),
  );
  const hasDeletedFileMode = tokens.some(
    (token) => token.type === 'mode' && token.value.startsWith('deleted file mode '),
  );

  if (hasNewFileMode || oldPath === null) {
    return 'added';
  }

  if (hasDeletedFileMode || newPath === null) {
    return 'deleted';
  }

  if (hasRenameMetadata || oldPath !== newPath) {
    return 'renamed';
  }

  return 'modified';
}

function buildHunks(tokens: DiffToken[]): Hunk[] {
  const hunks: Hunk[] = [];
  let currentHunk: Hunk | null = null;
  let oldLineNo = 0;
  let newLineNo = 0;

  for (const token of tokens) {
    if (token.type === 'hunk_header') {
      const parsed = parseHunkHeader(token.value);
      currentHunk = {
        oldStart: parsed.oldStart,
        oldLines: parsed.oldLines,
        newStart: parsed.newStart,
        newLines: parsed.newLines,
        lines: [],
      };
      hunks.push(currentHunk);
      oldLineNo = parsed.oldStart;
      newLineNo = parsed.newStart;
      continue;
    }

    if (!currentHunk) {
      continue;
    }

    if (token.type === 'context') {
      currentHunk.lines.push({
        type: 'context',
        content: token.value.slice(1),
        oldLineNo,
        newLineNo,
      });
      oldLineNo += 1;
      newLineNo += 1;
      continue;
    }

    if (token.type === 'remove') {
      currentHunk.lines.push({
        type: 'remove',
        content: token.value.slice(1),
        oldLineNo,
      });
      oldLineNo += 1;
      continue;
    }

    if (token.type === 'add') {
      currentHunk.lines.push({
        type: 'add',
        content: token.value.slice(1),
        newLineNo,
      });
      newLineNo += 1;
    }
  }

  return hunks;
}

function parseDiffHeaderPaths(header: string): DiffHeaderPaths {
  const prefix = 'diff --git ';
  if (!header.startsWith(prefix)) {
    throw new Error(`Invalid diff header: ${header}`);
  }

  const parts = splitGitFields(header.slice(prefix.length));
  const oldPath = parts[0] ? normalizeGitPath(parts[0]) : null;
  const newPath = parts[1] ? normalizeGitPath(parts[1]) : null;

  return { oldPath, newPath };
}

function parseFileMarkerPath(line: string): string | null {
  const rawPath = readLeadingPathField(line.slice(4).trimStart());
  return normalizeGitPath(rawPath);
}

function normalizeGitPath(rawPath: string | null): string | null {
  if (!rawPath || rawPath === '/dev/null') {
    return null;
  }

  if (rawPath.startsWith('a/') || rawPath.startsWith('b/')) {
    return rawPath.slice(2);
  }

  return rawPath;
}

function readLeadingPathField(value: string): string | null {
  if (value.length === 0) {
    return null;
  }

  if (value.startsWith('"')) {
    return readQuotedField(value).field;
  }

  const tabIndex = value.indexOf('\t');
  return tabIndex === -1 ? value : value.slice(0, tabIndex);
}

function splitGitFields(value: string): string[] {
  const fields: string[] = [];
  let cursor = 0;

  while (cursor < value.length) {
    while (cursor < value.length && value[cursor] === ' ') {
      cursor += 1;
    }

    if (cursor >= value.length) {
      break;
    }

    if (value[cursor] === '"') {
      const { field, nextIndex } = readQuotedField(value, cursor);
      fields.push(field);
      cursor = nextIndex;
      continue;
    }

    const nextSpace = value.indexOf(' ', cursor);
    if (nextSpace === -1) {
      fields.push(value.slice(cursor));
      break;
    }

    fields.push(value.slice(cursor, nextSpace));
    cursor = nextSpace + 1;
  }

  return fields;
}

function readQuotedField(value: string, startIndex = 0): { field: string; nextIndex: number } {
  let index = startIndex + 1;
  let field = '';

  while (index < value.length) {
    const char = value[index];

    if (char === '\\') {
      const next = value[index + 1];
      if (next === undefined) {
        break;
      }

      field += next;
      index += 2;
      continue;
    }

    if (char === '"') {
      return { field, nextIndex: index + 1 };
    }

    field += char;
    index += 1;
  }

  return { field, nextIndex: index };
}
