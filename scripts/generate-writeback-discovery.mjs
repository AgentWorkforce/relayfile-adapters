import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { adapters } from './writeback-discovery-data.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

for (const adapter of adapters) {
  const adapterRoot = join(root, 'packages', adapter.slug, 'discovery', adapter.slug);
  await writeDiscoveryFile(join(adapterRoot, '.adapter.md'), renderAdapterReadme(adapter));

  for (const endpoint of adapter.endpoints) {
    await writeDiscoveryFile(
      join(root, 'packages', adapter.slug, 'discovery', endpoint.schemaPath.slice(1)),
      `${JSON.stringify(endpoint.schema, null, 2)}\n`,
    );
    await writeDiscoveryFile(
      join(root, 'packages', adapter.slug, 'discovery', endpoint.examplePath.slice(1)),
      `${JSON.stringify(endpoint.example, null, 2)}\n`,
    );
  }
}

async function writeDiscoveryFile(path, content) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

function renderAdapterReadme(adapter) {
  const lines = [
    `# ${adapter.title}`,
    '',
    adapter.overview,
    '',
    'Read-only mounts:',
    ...adapter.readPaths.map(([path, description]) => `- \`${path}\` - ${description}`),
    '',
    'Write endpoints:',
    '| Path | Schema | What it does |',
    '|---|---|---|',
    ...adapter.endpoints.map((endpoint) => `| \`${endpoint.path}\` | \`${endpoint.schemaPath}\` | ${endpoint.description} |`),
    '',
    '## How to use (agents)',
    '1. Read the relevant `*.schema.json` to learn the required shape.',
    '2. Optional: read the matching `new.example.json` for a starter document.',
    '3. Write your document to the `new.json` path.',
    '4. Read back the most-recently-created sibling record written by the adapter.',
    '',
  ];

  return `${lines.join('\n')}`;
}
