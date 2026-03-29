import { describe, expect, it } from 'vitest';

import {
  buildPatches,
  getPatchForFile,
  parseDiff,
  type DiffLine,
} from '../patch-builder.js';
import { parseHunkHeader, tokenize } from '../tokenizer.js';

const TOKEN_FIXTURE = `diff --git a/src/old-name.ts b/src/new-name.ts
similarity index 93%
rename from src/old-name.ts
rename to src/new-name.ts
--- a/src/old-name.ts
+++ b/src/new-name.ts
@@ -1,2 +1,2 @@
-export const name = 'old';
+export const name = 'new';
 export const stable = true;
diff --git a/src/added.ts b/src/added.ts
new file mode 100644
--- /dev/null
+++ b/src/added.ts
@@ -0,0 +1 @@
+export const added = true;
diff --git a/assets/logo.png b/assets/logo.png
Binary files a/assets/logo.png and b/assets/logo.png differ`;

const MULTI_FILE_FIXTURE = `diff --git a/src/alpha.ts b/src/alpha.ts
--- a/src/alpha.ts
+++ b/src/alpha.ts
@@ -1,2 +1,2 @@
-export const alpha = 1;
+export const alpha = 2;
 export const label = 'alpha';
diff --git a/src/beta.ts b/src/beta.ts
new file mode 100644
--- /dev/null
+++ b/src/beta.ts
@@ -0,0 +1,2 @@
+export const beta = 1;
+export const enabled = true;`;

const ADDED_FILE_FIXTURE = `diff --git a/src/new-file.ts b/src/new-file.ts
new file mode 100644
--- /dev/null
+++ b/src/new-file.ts
@@ -0,0 +1,2 @@
+export const created = true;
+export const lineCount = 2;`;

const DELETED_FILE_FIXTURE = `diff --git a/src/old-file.ts b/src/old-file.ts
deleted file mode 100644
--- a/src/old-file.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-export const removed = true;
-export const lineCount = 2;`;

const RENAMED_FILE_FIXTURE = `diff --git a/src/old-name.ts b/src/new-name.ts
similarity index 93%
rename from src/old-name.ts
rename to src/new-name.ts
--- a/src/old-name.ts
+++ b/src/new-name.ts
@@ -1,2 +1,2 @@
-export const name = 'old';
+export const name = 'new';
 export const stable = true;`;

const BINARY_FILE_FIXTURE = `diff --git a/assets/logo.png b/assets/logo.png
Binary files a/assets/logo.png and b/assets/logo.png differ`;

const LINE_NUMBER_FIXTURE = `diff --git a/src/line-numbers.ts b/src/line-numbers.ts
--- a/src/line-numbers.ts
+++ b/src/line-numbers.ts
@@ -10,3 +10,4 @@
 const keep = true;
-const removeMe = true;
+const addMe = true;
+const addMeToo = true;
 return keep;`;

const REALISH_DIFF_FIXTURE = `diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,4 +1,5 @@
 import { oldThing } from './old';
 const version = 1;
-console.log(oldThing(version));
+const nextVersion = version + 1;
+console.log(oldThing(nextVersion));
 export default version;
@@ -10,3 +11,4 @@ export function run(): void {
   start();
+  finish();
 }`;

describe('diff parser', () => {
  it('tokenize identifies all token types', () => {
    const tokens = tokenize(TOKEN_FIXTURE);

    expect(tokens.map((token) => token.type)).toEqual([
      'diff_header',
      'rename',
      'rename',
      'rename',
      'old_file',
      'new_file',
      'hunk_header',
      'remove',
      'add',
      'context',
      'diff_header',
      'mode',
      'old_file',
      'new_file',
      'hunk_header',
      'add',
      'diff_header',
      'binary',
    ]);

    expect(tokens[0]).toMatchObject({ type: 'diff_header', line: 1 });
    expect(tokens[1]).toMatchObject({ type: 'rename', line: 2 });
    expect(tokens[11]).toMatchObject({ type: 'mode', line: 12 });
    expect(tokens.at(-1)).toMatchObject({ type: 'binary', line: 18 });
  });

  it('parseHunkHeader extracts line numbers correctly', () => {
    expect(parseHunkHeader('@@ -10,3 +20,4 @@')).toEqual({
      oldStart: 10,
      oldLines: 3,
      newStart: 20,
      newLines: 4,
    });

    expect(parseHunkHeader('@@ -7 +11 @@ optional context')).toEqual({
      oldStart: 7,
      oldLines: 1,
      newStart: 11,
      newLines: 1,
    });
  });

  it('buildPatches splits multi-file diff into patches', () => {
    const patches = buildPatches(tokenize(MULTI_FILE_FIXTURE));

    expect(patches).toHaveLength(2);
    expect(patches[0]).toMatchObject({
      oldPath: 'src/alpha.ts',
      newPath: 'src/alpha.ts',
      status: 'modified',
      isBinary: false,
    });
    expect(patches[1]).toMatchObject({
      oldPath: null,
      newPath: 'src/beta.ts',
      status: 'added',
      isBinary: false,
    });
  });

  it('buildPatches handles added file (new file mode)', () => {
    const [patch] = buildPatches(tokenize(ADDED_FILE_FIXTURE));

    expect(patch).toMatchObject({
      oldPath: null,
      newPath: 'src/new-file.ts',
      status: 'added',
      isBinary: false,
    });
    expect(patch.hunks).toHaveLength(1);
    expect(patch.hunks[0]?.lines).toEqual([
      { type: 'add', content: 'export const created = true;', newLineNo: 1 },
      { type: 'add', content: 'export const lineCount = 2;', newLineNo: 2 },
    ]);
  });

  it('buildPatches handles deleted file (deleted file mode)', () => {
    const [patch] = buildPatches(tokenize(DELETED_FILE_FIXTURE));

    expect(patch).toMatchObject({
      oldPath: 'src/old-file.ts',
      newPath: null,
      status: 'deleted',
      isBinary: false,
    });
    expect(patch.hunks).toHaveLength(1);
    expect(patch.hunks[0]?.lines).toEqual([
      { type: 'remove', content: 'export const removed = true;', oldLineNo: 1 },
      { type: 'remove', content: 'export const lineCount = 2;', oldLineNo: 2 },
    ]);
  });

  it('buildPatches handles renamed file (similarity index)', () => {
    const [patch] = buildPatches(tokenize(RENAMED_FILE_FIXTURE));

    expect(patch).toMatchObject({
      oldPath: 'src/old-name.ts',
      newPath: 'src/new-name.ts',
      status: 'renamed',
      isBinary: false,
    });
    expect(patch.hunks).toHaveLength(1);
    expect(patch.hunks[0]?.lines).toEqual([
      { type: 'remove', content: "export const name = 'old';", oldLineNo: 1 },
      { type: 'add', content: "export const name = 'new';", newLineNo: 1 },
      {
        type: 'context',
        content: 'export const stable = true;',
        oldLineNo: 2,
        newLineNo: 2,
      },
    ]);
  });

  it('buildPatches handles binary file', () => {
    const [patch] = buildPatches(tokenize(BINARY_FILE_FIXTURE));

    expect(patch).toMatchObject({
      oldPath: 'assets/logo.png',
      newPath: 'assets/logo.png',
      status: 'modified',
      isBinary: true,
      hunks: [],
    });
  });

  it('DiffLine has correct line numbers', () => {
    const [patch] = buildPatches(tokenize(LINE_NUMBER_FIXTURE));
    const lines = patch?.hunks[0]?.lines as DiffLine[];

    expect(lines).toEqual([
      {
        type: 'context',
        content: 'const keep = true;',
        oldLineNo: 10,
        newLineNo: 10,
      },
      {
        type: 'remove',
        content: 'const removeMe = true;',
        oldLineNo: 11,
      },
      {
        type: 'add',
        content: 'const addMe = true;',
        newLineNo: 11,
      },
      {
        type: 'add',
        content: 'const addMeToo = true;',
        newLineNo: 12,
      },
      {
        type: 'context',
        content: 'return keep;',
        oldLineNo: 12,
        newLineNo: 13,
      },
    ]);
  });

  it('parseDiff end-to-end with real-ish diff', () => {
    const patches = parseDiff(REALISH_DIFF_FIXTURE);

    expect(patches).toHaveLength(1);
    expect(patches[0]).toMatchObject({
      oldPath: 'src/app.ts',
      newPath: 'src/app.ts',
      status: 'modified',
      isBinary: false,
    });
    expect(patches[0]?.hunks).toHaveLength(2);
    expect(patches[0]?.hunks[0]).toMatchObject({
      oldStart: 1,
      oldLines: 4,
      newStart: 1,
      newLines: 5,
    });
    expect(patches[0]?.hunks[1]).toMatchObject({
      oldStart: 10,
      oldLines: 3,
      newStart: 11,
      newLines: 4,
    });
    expect(patches[0]?.hunks[0]?.lines[2]).toEqual({
      type: 'remove',
      content: 'console.log(oldThing(version));',
      oldLineNo: 3,
    });
    expect(patches[0]?.hunks[0]?.lines[3]).toEqual({
      type: 'add',
      content: 'const nextVersion = version + 1;',
      newLineNo: 3,
    });
  });

  it('getPatchForFile finds by path', () => {
    const patches = parseDiff(`${RENAMED_FILE_FIXTURE}\n${ADDED_FILE_FIXTURE}`);

    expect(getPatchForFile(patches, 'src/old-name.ts')).toMatchObject({
      status: 'renamed',
      oldPath: 'src/old-name.ts',
      newPath: 'src/new-name.ts',
    });
    expect(getPatchForFile(patches, 'src/new-name.ts')).toMatchObject({
      status: 'renamed',
      oldPath: 'src/old-name.ts',
      newPath: 'src/new-name.ts',
    });
    expect(getPatchForFile(patches, 'src/new-file.ts')).toMatchObject({
      status: 'added',
      newPath: 'src/new-file.ts',
    });
    expect(getPatchForFile(patches, 'src/missing.ts')).toBeNull();
  });
});
