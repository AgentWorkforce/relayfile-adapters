import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

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

    assert.deepStrictEqual(tokens.map((token) => token.type), [
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

    assert.strictEqual(tokens[0].type, 'diff_header');
    assert.strictEqual(tokens[0].line, 1);
    assert.strictEqual(tokens[1].type, 'rename');
    assert.strictEqual(tokens[1].line, 2);
    assert.strictEqual(tokens[11].type, 'mode');
    assert.strictEqual(tokens[11].line, 12);
    assert.strictEqual(tokens.at(-1)!.type, 'binary');
    assert.strictEqual(tokens.at(-1)!.line, 18);
  });

  it('parseHunkHeader extracts line numbers correctly', () => {
    assert.deepStrictEqual(parseHunkHeader('@@ -10,3 +20,4 @@'), {
      oldStart: 10,
      oldLines: 3,
      newStart: 20,
      newLines: 4,
    });

    assert.deepStrictEqual(parseHunkHeader('@@ -7 +11 @@ optional context'), {
      oldStart: 7,
      oldLines: 1,
      newStart: 11,
      newLines: 1,
    });
  });

  it('buildPatches splits multi-file diff into patches', () => {
    const patches = buildPatches(tokenize(MULTI_FILE_FIXTURE));

    assert.strictEqual(patches.length, 2);
    assert.strictEqual(patches[0].oldPath, 'src/alpha.ts');
    assert.strictEqual(patches[0].newPath, 'src/alpha.ts');
    assert.strictEqual(patches[0].status, 'modified');
    assert.strictEqual(patches[0].isBinary, false);
    assert.strictEqual(patches[1].oldPath, null);
    assert.strictEqual(patches[1].newPath, 'src/beta.ts');
    assert.strictEqual(patches[1].status, 'added');
    assert.strictEqual(patches[1].isBinary, false);
  });

  it('buildPatches handles added file (new file mode)', () => {
    const [patch] = buildPatches(tokenize(ADDED_FILE_FIXTURE));

    assert.strictEqual(patch.oldPath, null);
    assert.strictEqual(patch.newPath, 'src/new-file.ts');
    assert.strictEqual(patch.status, 'added');
    assert.strictEqual(patch.isBinary, false);
    assert.strictEqual(patch.hunks.length, 1);
    assert.deepStrictEqual(patch.hunks[0]?.lines, [
      { type: 'add', content: 'export const created = true;', newLineNo: 1 },
      { type: 'add', content: 'export const lineCount = 2;', newLineNo: 2 },
    ]);
  });

  it('buildPatches handles deleted file (deleted file mode)', () => {
    const [patch] = buildPatches(tokenize(DELETED_FILE_FIXTURE));

    assert.strictEqual(patch.oldPath, 'src/old-file.ts');
    assert.strictEqual(patch.newPath, null);
    assert.strictEqual(patch.status, 'deleted');
    assert.strictEqual(patch.isBinary, false);
    assert.strictEqual(patch.hunks.length, 1);
    assert.deepStrictEqual(patch.hunks[0]?.lines, [
      { type: 'remove', content: 'export const removed = true;', oldLineNo: 1 },
      { type: 'remove', content: 'export const lineCount = 2;', oldLineNo: 2 },
    ]);
  });

  it('buildPatches handles renamed file (similarity index)', () => {
    const [patch] = buildPatches(tokenize(RENAMED_FILE_FIXTURE));

    assert.strictEqual(patch.oldPath, 'src/old-name.ts');
    assert.strictEqual(patch.newPath, 'src/new-name.ts');
    assert.strictEqual(patch.status, 'renamed');
    assert.strictEqual(patch.isBinary, false);
    assert.strictEqual(patch.hunks.length, 1);
    assert.deepStrictEqual(patch.hunks[0]?.lines, [
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

    assert.strictEqual(patch.oldPath, 'assets/logo.png');
    assert.strictEqual(patch.newPath, 'assets/logo.png');
    assert.strictEqual(patch.status, 'modified');
    assert.strictEqual(patch.isBinary, true);
    assert.deepStrictEqual(patch.hunks, []);
  });

  it('DiffLine has correct line numbers', () => {
    const [patch] = buildPatches(tokenize(LINE_NUMBER_FIXTURE));
    const lines = patch?.hunks[0]?.lines as DiffLine[];

    assert.deepStrictEqual(lines, [
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

    assert.strictEqual(patches.length, 1);
    assert.strictEqual(patches[0].oldPath, 'src/app.ts');
    assert.strictEqual(patches[0].newPath, 'src/app.ts');
    assert.strictEqual(patches[0].status, 'modified');
    assert.strictEqual(patches[0].isBinary, false);
    assert.strictEqual(patches[0]?.hunks.length, 2);
    assert.strictEqual(patches[0]?.hunks[0].oldStart, 1);
    assert.strictEqual(patches[0]?.hunks[0].oldLines, 4);
    assert.strictEqual(patches[0]?.hunks[0].newStart, 1);
    assert.strictEqual(patches[0]?.hunks[0].newLines, 5);
    assert.strictEqual(patches[0]?.hunks[1].oldStart, 10);
    assert.strictEqual(patches[0]?.hunks[1].oldLines, 3);
    assert.strictEqual(patches[0]?.hunks[1].newStart, 11);
    assert.strictEqual(patches[0]?.hunks[1].newLines, 4);
    assert.deepStrictEqual(patches[0]?.hunks[0]?.lines[2], {
      type: 'remove',
      content: 'console.log(oldThing(version));',
      oldLineNo: 3,
    });
    assert.deepStrictEqual(patches[0]?.hunks[0]?.lines[3], {
      type: 'add',
      content: 'const nextVersion = version + 1;',
      newLineNo: 3,
    });
  });

  it('getPatchForFile finds by path', () => {
    const patches = parseDiff(`${RENAMED_FILE_FIXTURE}\n${ADDED_FILE_FIXTURE}`);

    const oldNamePatch = getPatchForFile(patches, 'src/old-name.ts');
    assert.strictEqual(oldNamePatch!.status, 'renamed');
    assert.strictEqual(oldNamePatch!.oldPath, 'src/old-name.ts');
    assert.strictEqual(oldNamePatch!.newPath, 'src/new-name.ts');

    const newNamePatch = getPatchForFile(patches, 'src/new-name.ts');
    assert.strictEqual(newNamePatch!.status, 'renamed');
    assert.strictEqual(newNamePatch!.oldPath, 'src/old-name.ts');
    assert.strictEqual(newNamePatch!.newPath, 'src/new-name.ts');

    const newFilePatch = getPatchForFile(patches, 'src/new-file.ts');
    assert.strictEqual(newFilePatch!.status, 'added');
    assert.strictEqual(newFilePatch!.newPath, 'src/new-file.ts');

    assert.strictEqual(getPatchForFile(patches, 'src/missing.ts'), null);
  });
});
