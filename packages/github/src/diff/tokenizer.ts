export type TokenType =
  | 'diff_header'
  | 'old_file'
  | 'new_file'
  | 'hunk_header'
  | 'add'
  | 'remove'
  | 'context'
  | 'binary'
  | 'rename'
  | 'mode';

export interface DiffToken {
  type: TokenType;
  value: string;
  line: number;
}

export interface ParsedHunkHeader {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
}

const HUNK_HEADER_PATTERN = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)?$/;
const NO_NEWLINE_MARKER = '\\ No newline at end of file';

export function parseHunkHeader(line: string): ParsedHunkHeader {
  const match = HUNK_HEADER_PATTERN.exec(line);
  if (!match) {
    throw new Error(`Invalid unified diff hunk header: ${line}`);
  }

  return {
    oldStart: Number.parseInt(match[1], 10),
    oldLines: match[2] === undefined ? 1 : Number.parseInt(match[2], 10),
    newStart: Number.parseInt(match[3], 10),
    newLines: match[4] === undefined ? 1 : Number.parseInt(match[4], 10),
  };
}

export function tokenize(rawDiff: string): DiffToken[] {
  const tokens: DiffToken[] = [];
  const lines = rawDiff.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const value = lines[index] ?? '';
    const line = index + 1;

    if (value === '' || value === NO_NEWLINE_MARKER) {
      continue;
    }

    const token = classifyLine(value, line);
    if (token) {
      tokens.push(token);
    }
  }

  return tokens;
}

function classifyLine(value: string, line: number): DiffToken | null {
  if (value.startsWith('diff --git ')) {
    return { type: 'diff_header', value, line };
  }

  if (value.startsWith('Binary files ') || value === 'GIT binary patch') {
    return { type: 'binary', value, line };
  }

  if (
    value.startsWith('similarity index ') ||
    value.startsWith('rename from ') ||
    value.startsWith('rename to ')
  ) {
    return { type: 'rename', value, line };
  }

  if (
    value.startsWith('new file mode ') ||
    value.startsWith('deleted file mode ') ||
    value.startsWith('old mode ') ||
    value.startsWith('new mode ')
  ) {
    return { type: 'mode', value, line };
  }

  if (value.startsWith('--- ')) {
    return { type: 'old_file', value, line };
  }

  if (value.startsWith('+++ ')) {
    return { type: 'new_file', value, line };
  }

  if (value.startsWith('@@ ')) {
    parseHunkHeader(value);
    return { type: 'hunk_header', value, line };
  }

  if (value.startsWith('+')) {
    return { type: 'add', value, line };
  }

  if (value.startsWith('-')) {
    return { type: 'remove', value, line };
  }

  if (value.startsWith(' ')) {
    return { type: 'context', value, line };
  }

  return null;
}
