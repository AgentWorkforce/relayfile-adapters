// Fails when regenerating writeback discovery files changes the committed tree,
// i.e. scripts/writeback-discovery-data.mjs (or the generator) was edited
// without running `node scripts/generate-writeback-discovery.mjs`.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const generatedPaths = [':(glob)packages/*/discovery/**', ':(glob)packages/*/src/resources.ts'];

execFileSync(process.execPath, ['scripts/generate-writeback-discovery.mjs'], { cwd: root, stdio: 'inherit' });

const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--', ...generatedPaths], {
  cwd: root,
  encoding: 'utf8',
});

if (status.trim()) {
  console.error('Writeback discovery files are out of date. Run `node scripts/generate-writeback-discovery.mjs` and commit the result:');
  console.error(status.trimEnd());
  console.error(execFileSync('git', ['diff', '--stat', '--', ...generatedPaths], { cwd: root, encoding: 'utf8' }).trimEnd());
  process.exit(1);
}

console.log('Writeback discovery files match a fresh regeneration.');
