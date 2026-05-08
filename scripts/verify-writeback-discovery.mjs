import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { adapters } from './writeback-discovery-data.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const failures = [];

for (const adapter of adapters) {
  const packageJsonPath = join(root, 'packages', adapter.slug, 'package.json');
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  if (!Array.isArray(packageJson.files) || !packageJson.files.includes('discovery')) {
    failures.push(`${adapter.slug}: package.json files must include discovery so mounted workspaces can ship schema assets`);
  }

  const adapterMdPath = join(root, 'packages', adapter.slug, 'discovery', adapter.slug, '.adapter.md');
  const hasAdapterMd = await assertFile(adapterMdPath, `${adapter.slug} adapter README`);
  const adapterMd = hasAdapterMd ? await readFile(adapterMdPath, 'utf8') : '';

  for (const endpoint of adapter.endpoints) {
    if (!endpoint.path.endsWith('/new.json')) {
      failures.push(`${adapter.slug}: write endpoint must be a new.json template: ${endpoint.path}`);
    }
    if (endpoint.schemaPath !== endpoint.path.replace(/new\.json$/, 'new.schema.json')) {
      failures.push(`${adapter.slug}: schema is not a sibling of ${endpoint.path}`);
    }
    if (endpoint.examplePath !== endpoint.path.replace(/new\.json$/, 'new.example.json')) {
      failures.push(`${adapter.slug}: example is not a sibling of ${endpoint.path}`);
    }

    const schemaFile = join(root, 'packages', adapter.slug, 'discovery', endpoint.schemaPath.slice(1));
    const exampleFile = join(root, 'packages', adapter.slug, 'discovery', endpoint.examplePath.slice(1));
    const hasSchema = await assertFile(schemaFile, endpoint.schemaPath);
    const hasExample = await assertFile(exampleFile, endpoint.examplePath);
    if (!hasSchema || !hasExample) {
      continue;
    }

    const schema = await readJson(schemaFile, endpoint.schemaPath);
    const example = await readJson(exampleFile, endpoint.examplePath);
    if (!schema || !example) {
      continue;
    }
    validateSchema(adapter.slug, endpoint, schema);
    validateExample(adapter.slug, endpoint, schema, example);

    if (!adapterMd.includes(`\`${endpoint.path}\``) || !adapterMd.includes(`\`${endpoint.schemaPath}\``)) {
      failures.push(`${adapter.slug}: .adapter.md does not list ${endpoint.path} with ${endpoint.schemaPath}`);
    }
  }
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'));
  process.exit(1);
}

console.log(`Verified ${adapters.reduce((sum, adapter) => sum + adapter.endpoints.length, 0)} writeback discovery endpoints.`);

async function assertFile(path, label) {
  try {
    await access(path);
    return true;
  } catch {
    failures.push(`missing ${label}: ${path}`);
    return false;
  }
}

async function readJson(path, label) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    failures.push(`${label} must contain valid JSON: ${error.message}`);
    return null;
  }
}

function validateSchema(adapterSlug, endpoint, schema) {
  if (schema.$schema !== 'https://json-schema.org/draft/2020-12/schema') {
    failures.push(`${adapterSlug}: ${endpoint.schemaPath} must use JSON Schema draft 2020-12`);
  }
  if (schema.type !== 'object') {
    failures.push(`${adapterSlug}: ${endpoint.schemaPath} must describe an object`);
  }
  if (!Array.isArray(schema.required)) {
    failures.push(`${adapterSlug}: ${endpoint.schemaPath} must include an explicit required array`);
  }
  if (!schema.properties || typeof schema.properties !== 'object') {
    failures.push(`${adapterSlug}: ${endpoint.schemaPath} must include properties`);
    return;
  }

  for (const [name, property] of Object.entries(schema.properties)) {
    if (!property || typeof property !== 'object' || typeof property.description !== 'string' || property.description.length === 0) {
      failures.push(`${adapterSlug}: ${endpoint.schemaPath} property ${name} needs a field-level description`);
    }
  }
}

function validateExample(adapterSlug, endpoint, schema, example) {
  if (!example || typeof example !== 'object' || Array.isArray(example)) {
    failures.push(`${adapterSlug}: ${endpoint.examplePath} must contain a JSON object example`);
    return;
  }

  for (const requiredKey of schema.required ?? []) {
    if (!(requiredKey in example)) {
      failures.push(`${adapterSlug}: ${endpoint.examplePath} missing required key ${requiredKey}`);
    }
  }
}
