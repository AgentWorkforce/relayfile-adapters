// Fails when the committed writeback discovery files differ from a fresh
// generation: stale or missing generated files (data or generator edited
// without running `node scripts/generate-writeback-discovery.mjs`), and
// orphans the generator no longer writes (e.g. a removed endpoint's schema).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { adapters } from './writeback-discovery-data.mjs';
import { generatedPathspecs, orphanedGeneratedFiles } from './writeback-discovery-normalizer.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const pathspecs = generatedPathspecs(adapters);
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });

// Stale or missing: regenerate in place and look for changes.
execFileSync(process.execPath, ['scripts/generate-writeback-discovery.mjs'], { cwd: root, stdio: 'inherit' });
const status = git('status', '--porcelain', '--untracked-files=all', '--', ...pathspecs).trimEnd();

// Orphans: generate into an empty directory for the expected file set.
const outDir = mkdtempSync(join(tmpdir(), 'writeback-discovery-'));
let orphans;
try {
  execFileSync(process.execPath, ['scripts/generate-writeback-discovery.mjs', '--out-dir', outDir], { cwd: root, stdio: 'inherit' });
  const expected = listFiles(outDir).map((path) => relative(outDir, path));
  const tracked = git('ls-files', '--', ...pathspecs).split('\n').filter(Boolean);
  orphans = orphanedGeneratedFiles(tracked, expected);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

if (status || orphans.length > 0) {
  if (status) {
    console.error('Writeback discovery files are out of date. Run `node scripts/generate-writeback-discovery.mjs` and commit the result:');
    console.error(status);
    console.error(git('diff', 'HEAD', '--stat', '--', ...pathspecs).trimEnd());
  }
  if (orphans.length > 0) {
    console.error('Tracked writeback discovery files that the generator no longer writes. Delete them (or restore their endpoint in scripts/writeback-discovery-data.mjs):');
    for (const path of orphans) console.error(`  ${path}`);
  }
  process.exit(1);
}

console.log('Writeback discovery files match a fresh regeneration.');

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}
