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
    '',
    '| Path | Schema | What it does |',
    '|---|---|---|',
    ...adapter.endpoints.map((endpoint) => `| \`${endpoint.path}\` | \`${endpoint.schemaPath}\` | ${endpoint.description} |`),
    '',
    '## Write field contracts',
    '',
    ...adapter.endpoints.flatMap((endpoint) => renderEndpointContract(endpoint)),
    '## How to use (agents)',
    '1. Read the relevant `*.schema.json` to learn the required shape.',
    '2. Optional: read the matching `new.example.json` for a starter document.',
    '3. Write your document to the `new.json` path.',
    '4. Read back the most-recently-created sibling record written by the adapter.',
    '',
  ];

  return `${lines.join('\n')}`;
}

function renderEndpointContract(endpoint) {
  const required = new Set(endpoint.schema.required ?? []);
  const fieldNames = Object.keys(endpoint.schema.properties ?? {});
  const optional = fieldNames.filter((fieldName) => !required.has(fieldName));
  const lines = [
    `### ${endpoint.schema.title}`,
    '',
    `Path: \`${endpoint.path}\``,
    `Schema: \`${endpoint.schemaPath}\``,
    `Example: \`${endpoint.examplePath}\``,
    `Required fields: ${required.size > 0 ? [...required].map((fieldName) => `\`${fieldName}\``).join(', ') : 'none at the top level'}.`,
    `Optional fields: ${optional.length > 0 ? optional.map((fieldName) => `\`${fieldName}\``).join(', ') : 'none'}.`,
    ...renderValidationNotes(endpoint.schema),
    '',
    'Fields:',
    '',
    ...renderSchemaFields(endpoint.schema),
    '',
  ];

  return lines;
}

function renderValidationNotes(schema) {
  const notes = [];
  const anyOfFields = describeRequiredBranches(schema.anyOf);
  if (anyOfFields.length > 0) {
    notes.push(`Validation: provide at least one of ${anyOfFields.join(', ')}.`);
  }
  if (schema.oneOf) {
    notes.push(`Validation: satisfy exactly one of ${schema.oneOf.length} allowed payload shapes.`);
  }
  return notes;
}

function describeRequiredBranches(branches) {
  if (!Array.isArray(branches)) {
    return [];
  }

  return branches.flatMap((branch) => {
    if (!Array.isArray(branch.required)) {
      return [];
    }
    return branch.required.map((fieldName) => {
      const nested = branch.properties?.[fieldName]?.required;
      if (Array.isArray(nested) && nested.length === 1) {
        return `\`${fieldName}.${nested[0]}\``;
      }
      return `\`${fieldName}\``;
    });
  });
}

function renderSchemaFields(schema, prefix = '') {
  const required = new Set(schema.required ?? []);
  const properties = schema.properties ?? {};
  const lines = [];

  for (const [fieldName, property] of Object.entries(properties)) {
    const path = prefix ? `${prefix}.${fieldName}` : fieldName;
    const status = required.has(fieldName) ? 'required' : 'optional';
    const description = property.description ?? 'No description provided.';
    lines.push(`- \`${path}\` (${status}, ${describeSchemaType(property)}) - ${description}${describeEnum(property)}`);

    if (property.type === 'object' && property.properties) {
      lines.push(...renderSchemaFields(property, path));
    }

    if (property.type === 'array' && property.items?.type === 'object' && property.items.properties) {
      lines.push(...renderSchemaFields(property.items, `${path}[]`));
    }
  }

  if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
    lines.push(`- additional properties (optional, ${describeSchemaType(schema.additionalProperties)}) - ${schema.additionalProperties.description ?? 'Provider-specific writable fields.'}`);
  }

  return lines;
}

function describeSchemaType(schema) {
  if (Array.isArray(schema.type)) {
    return schema.type.join(' or ');
  }
  if (schema.type) {
    return schema.format ? `${schema.type}, ${schema.format}` : schema.type;
  }
  if (schema.enum) {
    return 'enum';
  }
  if (schema.oneOf) {
    return `one of ${schema.oneOf.map(describeSchemaType).join(', ')}`;
  }
  if (schema.anyOf) {
    return `any of ${schema.anyOf.map(describeSchemaType).join(', ')}`;
  }
  return 'value';
}

function describeEnum(schema) {
  return Array.isArray(schema.enum) ? ` Allowed values: ${schema.enum.map((value) => `\`${value}\``).join(', ')}.` : '';
}
