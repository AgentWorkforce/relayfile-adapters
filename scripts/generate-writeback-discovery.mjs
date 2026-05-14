import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  escapeMarkdownTableCell,
  fullRecordSchema,
  normalizeWritebackDiscoveryData,
} from './writeback-discovery-normalizer.mjs';
import { adapters } from './writeback-discovery-data.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const normalizedAdapters = normalizeWritebackDiscoveryData(adapters).adapters;

for (const adapter of normalizedAdapters) {
  const adapterRoot = join(root, 'packages', adapter.slug, 'discovery', adapter.slug);
  await writeDiscoveryFile(join(adapterRoot, '.adapter.md'), renderAdapterReadme(adapter));
  await writeDiscoveryFile(join(root, 'packages', adapter.slug, 'src', 'resources.ts'), renderResourcesTs(adapter));

  for (const endpoint of adapter.endpoints) {
    const resource = endpoint.resource;
    await writeDiscoveryFile(
      join(root, 'packages', adapter.slug, 'discovery', resource.schemaPath.slice(1)),
      `${JSON.stringify(fullRecordSchema(endpoint.schema), null, 2)}\n`,
    );
    await writeDiscoveryFile(
      join(root, 'packages', adapter.slug, 'discovery', resource.examplePath.slice(1)),
      `${JSON.stringify(endpoint.example, null, 2)}\n`,
    );
  }
}

async function writeDiscoveryFile(path, content) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

function renderAdapterReadme(adapter) {
  const resources = adapter.resources;
  const lines = [
    `# ${adapter.title}`,
    '',
    adapter.overview,
    '',
    'Read-only mounts:',
    ...adapter.readPaths.map(([path, description]) => `- \`${path}\` - ${description}`),
    '',
    'Resources:',
    '',
    '| Resource | Schema | Create example | ID pattern | What it does |',
    '|---|---|---|---|---|',
    ...resources.map((resource) => `| \`${resource.resourcePath}/<id>.json\` | \`${resource.schemaPath}\` | \`${resource.examplePath}\` | \`${escapeMarkdownTableCell(resource.idPatternSource)}\` | ${resource.description} |`),
    '',
    '## Operations',
    '',
    '| To... | Do... |',
    '|---|---|',
    '| Read | `cat <id>.json` |',
    '| Edit | Write a partial JSON object to `<id>.json`. Only included mutable fields PATCH; fields marked `readOnly` in `.schema.json` are rejected. |',
    '| Create | Write JSON to any non-canonical filename such as `create request.json`. The adapter creates the record at `<real-id>.json` and rewrites the draft as `{ "created": "<real-id>", "path": "<resource>/<real-id>.json", "url": "<provider-url>" }`. |',
    '| Delete | `rm <id>.json` for canonical ids. |',
    '',
    '## ID Patterns',
    ...resources.map((resource) => `- \`${resource.resourcePath}/<id>.json\`: \`${resource.idPatternSource}\`. Filenames that do not match this pattern are treated as create drafts.`),
    '',
    '## Write field contracts',
    '',
    ...adapter.endpoints.flatMap((endpoint) => renderEndpointContract(endpoint)),
    '## Create Examples',
    'Read the resource `.schema.json` first, then use the sibling `.create.example.json` as a minimal create document. The example intentionally omits read-only fields.',
    '',
  ];

  return `${lines.join('\n')}`;
}

function renderEndpointContract(endpoint) {
  const resource = endpoint.resource;
  const required = new Set(endpoint.schema.required ?? []);
  const fieldNames = Object.keys(endpoint.schema.properties ?? {});
  const optional = fieldNames.filter((fieldName) => !required.has(fieldName));
  const lines = [
    `### ${endpoint.schema.title}`,
    '',
    `Resource: \`${resource.resourcePath}/<id>.json\``,
    `Schema: \`${resource.schemaPath}\``,
    `Create example: \`${resource.examplePath}\``,
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
    return `one of ${[...new Set(schema.oneOf.map(describeSchemaType))].join(', ')}`;
  }
  if (schema.anyOf) {
    return `any of ${schema.anyOf.map(describeSchemaType).join(', ')}`;
  }
  return 'value';
}

function describeEnum(schema) {
  return Array.isArray(schema.enum) ? ` Allowed values: ${schema.enum.map((value) => `\`${value}\``).join(', ')}.` : '';
}

function renderResourcesTs(adapter) {
  const resources = adapter.resources;
  const lines = [
    'export interface AdapterResourceConfig {',
    '  readonly name: string;',
    '  readonly path: string;',
    '  readonly pathPattern: RegExp;',
    '  readonly idPattern: RegExp;',
    '  readonly schema: string;',
    '  readonly createExample: string;',
    '}',
    '',
    'export const resources = [',
    ...resources.map((resource) => [
      '  {',
      `    name: ${JSON.stringify(resource.name)},`,
      `    path: ${JSON.stringify(resource.resourcePath)},`,
      `    pathPattern: ${resource.pathPatternLiteral},`,
      `    idPattern: ${resource.idPatternLiteral},`,
      `    schema: ${JSON.stringify(`discovery${resource.schemaPath}`)},`,
      `    createExample: ${JSON.stringify(`discovery${resource.examplePath}`)},`,
      '  },',
    ].join('\n')),
    '] as const satisfies readonly AdapterResourceConfig[];',
    '',
    'export function findResourceByPath(path: string): AdapterResourceConfig | undefined {',
    '  const normalizedPath = path.endsWith(".json") ? path : path.replace(/\\/$/, "");',
    '  return resources.find((resource) => resource.pathPattern.test(normalizedPath));',
    '}',
    '',
  ];

  return lines.join('\n');
}
