import { access, readdir, readFile } from 'node:fs/promises';
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
  if (!adapterMd.includes('*.tmp.json') || !adapterMd.includes('*.partial.json')) {
    failures.push(`${adapter.slug}: .adapter.md must document ignored temporary/partial writeback filenames`);
  }

  // Each endpoint contract must list exactly its declared operations, and no
  // Operations line when none are declared (never a blanket default).
  const renderedOperations = renderedOperationsByResource(adapterMd);
  const renderedExampleLabels = renderedExampleLabelsByResource(adapterMd);
  for (const endpoint of hasAdapterMd ? adapter.endpoints : []) {
    const resourcePath = endpoint.path.replace(/\/new\.json$/, '');
    const writePath = /\.(?:json|md)$/.test(resourcePath) ? resourcePath : `${resourcePath}/<id>.json`;
    const expected = Array.isArray(endpoint.operations)
      ? endpoint.operations.length > 0 ? endpoint.operations.map((operation) => `\`${operation}\``).join(', ') : 'read-only'
      : undefined;
    const rendered = renderedOperations.get(writePath);
    if (rendered !== expected) {
      failures.push(`${adapter.slug}: .adapter.md Operations for ${writePath} must be ${expected ?? 'omitted'}, found ${rendered ?? 'none'}`);
    }
    // Update-only resources ship a payload example, never a create draft.
    const updateOnlyExample = endpoint.example !== undefined && Array.isArray(endpoint.operations) && !endpoint.operations.includes('create');
    const exampleLabel = renderedExampleLabels.get(writePath);
    if (updateOnlyExample && exampleLabel !== 'Payload example') {
      failures.push(`${adapter.slug}: .adapter.md must label the ${writePath} example as a payload example, found ${exampleLabel ?? 'none'}`);
    }
  }

  for (const endpoint of adapter.endpoints) {
    const resourcePath = endpoint.path.replace(/\/new\.json$/, '');
    const discoveryPath = endpoint.discoveryPath ?? resourcePath;
    const schemaPath = `${discoveryPath}/.schema.json`;
    const examplePath = `${discoveryPath}/.create.example.json`;

    if (endpoint.path.endsWith('/new.json')) {
      const legacySchemaFile = join(root, 'packages', adapter.slug, 'discovery', endpoint.path.replace(/new\.json$/, 'new.schema.json').slice(1));
      if (await fileExists(legacySchemaFile)) {
        failures.push(`${adapter.slug}: legacy new.schema.json must be renamed to .schema.json: ${legacySchemaFile}`);
      }
    }

    const schemaFile = join(root, 'packages', adapter.slug, 'discovery', schemaPath.slice(1));
    const hasSchema = await assertFile(schemaFile, schemaPath);
    const hasExample = endpoint.example !== undefined;
    const exampleFile = join(root, 'packages', adapter.slug, 'discovery', examplePath.slice(1));
    const hasExampleFile = hasExample ? await assertFile(exampleFile, examplePath) : true;
    if (!hasSchema || !hasExampleFile) {
      continue;
    }

    const schema = await readJson(schemaFile, schemaPath);
    const example = hasExample ? await readJson(exampleFile, examplePath) : undefined;
    if (!schema || (hasExample && !example)) {
      continue;
    }

    validateSchema(adapter.slug, schemaPath, schema);
    if (hasExample) validateExample(adapter.slug, examplePath, schema, example);

    if (!adapterMd.includes(`\`/discovery${schemaPath}\``) || !adapterMd.includes('## Operations') || !adapterMd.includes('## ID Patterns')) {
      failures.push(`${adapter.slug}: .adapter.md must list /discovery${schemaPath} plus Operations and ID Patterns sections`);
    }
    if (hasExample && !adapterMd.includes(`\`/discovery${examplePath}\``)) {
      failures.push(`${adapter.slug}: .adapter.md must list /discovery${examplePath}`);
    }
    for (const unprefixedPath of [schemaPath, examplePath]) {
      if (adapterMd.includes(`\`${unprefixedPath}\``)) {
        failures.push(`${adapter.slug}: .adapter.md must advertise ${unprefixedPath} under the /discovery mount root, not the live resource directory`);
      }
    }
    if (/\.(?:json|md)$/.test(resourcePath) && adapterMd.includes(`\`${resourcePath}/<id>.json\``)) {
      failures.push(`${adapter.slug}: .adapter.md must document exact-file resource ${resourcePath}, not ${resourcePath}/<id>.json`);
    }
  }
}

// Hand-maintained .adapter.md files (adapters outside writeback-discovery-data)
// must also advertise schema/example files at the absolute /discovery mount path.
for (const slug of await readdir(join(root, 'packages'))) {
  const adapterMd = await readOptionalFile(join(root, 'packages', slug, 'discovery', slug, '.adapter.md'));
  const relativePaths = adapterMd.match(/`discovery\/[^`]*\.(?:schema|create\.example)\.json`/g) ?? [];
  for (const relativePath of relativePaths) {
    failures.push(`${slug}: .adapter.md must use the absolute /discovery mount path, not ${relativePath}`);
  }
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'));
  process.exit(1);
}

console.log(`Verified ${adapters.reduce((sum, adapter) => sum + adapter.endpoints.length, 0)} writeback discovery endpoints.`);

function renderedExampleLabelsByResource(adapterMd) {
  const labels = new Map();
  for (const section of adapterMd.split(/^### /m).slice(1)) {
    const resource = section.match(/^Resource: `([^`]+)`$/m)?.[1];
    if (resource) {
      labels.set(resource, section.match(/^(Create example|Payload example): /m)?.[1]);
    }
  }
  return labels;
}

function renderedOperationsByResource(adapterMd) {
  const operations = new Map();
  for (const section of adapterMd.split(/^### /m).slice(1)) {
    const resource = section.match(/^Resource: `([^`]+)`$/m)?.[1];
    if (resource) {
      operations.set(resource, section.match(/^Operations: (.+)\.$/m)?.[1]);
    }
  }
  return operations;
}

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

  const writableSystemFields = new Set(schema['x-relayfile-writableSystemFields'] ?? []);
  for (const systemField of ['id', 'createdAt', 'updatedAt', 'url', '_webhook', '_connection']) {
    if (!schema.properties[systemField]) {
      failures.push(`${adapterSlug}: ${schemaPath} must include system field ${systemField}`);
    } else if (!writableSystemFields.has(systemField) && schema.properties[systemField].readOnly !== true) {
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
