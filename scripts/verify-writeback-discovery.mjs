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

  const resourcesTsPath = join(root, 'packages', adapter.slug, 'src', 'resources.ts');
  await assertFile(resourcesTsPath, `${adapter.slug} resource config`);
  const resourcesTs = await readOptionalFile(resourcesTsPath);
  if (!resourcesTs.includes('pathPattern: /') || !resourcesTs.includes('idPattern: /')) {
    failures.push(`${adapter.slug}: src/resources.ts must declare pathPattern and idPattern regexes`);
  }

  const adapterMdPath = join(root, 'packages', adapter.slug, 'discovery', adapter.slug, '.adapter.md');
  const hasAdapterMd = await assertFile(adapterMdPath, `${adapter.slug} adapter README`);
  const adapterMd = hasAdapterMd ? await readFile(adapterMdPath, 'utf8') : '';

  for (const endpoint of adapter.endpoints) {
    const resourcePath = endpoint.path.replace(/\/new\.json$/, '');
    const schemaPath = `${resourcePath}/.schema.json`;
    const examplePath = `${resourcePath}/.create.example.json`;

    const legacySchemaFile = join(root, 'packages', adapter.slug, 'discovery', endpoint.path.replace(/new\.json$/, 'new.schema.json').slice(1));
    if (await fileExists(legacySchemaFile)) {
      failures.push(`${adapter.slug}: legacy new.schema.json must be renamed to .schema.json: ${legacySchemaFile}`);
    }

    const schemaFile = join(root, 'packages', adapter.slug, 'discovery', schemaPath.slice(1));
    const exampleFile = join(root, 'packages', adapter.slug, 'discovery', examplePath.slice(1));
    const hasSchema = await assertFile(schemaFile, schemaPath);
    const hasExample = await assertFile(exampleFile, examplePath);
    if (!hasSchema || !hasExample) {
      continue;
    }

    const schema = await readJson(schemaFile, schemaPath);
    const example = await readJson(exampleFile, examplePath);
    if (!schema || !example) {
      continue;
    }

    validateSchema(adapter.slug, schemaPath, schema);
    validateExample(adapter.slug, examplePath, schema, example);

    if (!adapterMd.includes(`\`${schemaPath}\``) || !adapterMd.includes('## Operations') || !adapterMd.includes('## ID Patterns')) {
      failures.push(`${adapter.slug}: .adapter.md must list ${schemaPath} plus Operations and ID Patterns sections`);
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

async function readOptionalFile(path) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return '';
  }
}

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function validateSchema(adapterSlug, schemaPath, schema) {
  if (schema.$schema !== 'https://json-schema.org/draft/2020-12/schema') {
    failures.push(`${adapterSlug}: ${schemaPath} must use JSON Schema draft 2020-12`);
  }
  if (schema.type !== 'object') {
    failures.push(`${adapterSlug}: ${schemaPath} must describe an object`);
  }
  if (!Array.isArray(schema.required)) {
    failures.push(`${adapterSlug}: ${schemaPath} must include an explicit required array`);
  }
  if (!schema.properties || typeof schema.properties !== 'object') {
    failures.push(`${adapterSlug}: ${schemaPath} must include properties`);
    return;
  }

  for (const [name, property] of Object.entries(schema.properties)) {
    if (!property || typeof property !== 'object' || typeof property.description !== 'string' || property.description.length === 0) {
      failures.push(`${adapterSlug}: ${schemaPath} property ${name} needs a field-level description`);
    }
  }

  for (const systemField of ['id', 'createdAt', 'updatedAt', 'url', '_webhook', '_connection']) {
    if (!schema.properties[systemField]) {
      failures.push(`${adapterSlug}: ${schemaPath} must include system field ${systemField}`);
    } else if (schema.properties[systemField].readOnly !== true) {
      failures.push(`${adapterSlug}: ${schemaPath} system field ${systemField} must be readOnly`);
    }
  }
}

function validateExample(adapterSlug, examplePath, schema, example) {
  if (!example || typeof example !== 'object' || Array.isArray(example)) {
    failures.push(`${adapterSlug}: ${examplePath} must contain a JSON object example`);
    return;
  }

  for (const requiredKey of schema.required ?? []) {
    if (!(requiredKey in example)) {
      failures.push(`${adapterSlug}: ${examplePath} missing required key ${requiredKey}`);
    }
  }
}
