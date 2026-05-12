import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { adapters } from './writeback-discovery-data.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

for (const adapter of adapters) {
  const adapterRoot = join(root, 'packages', adapter.slug, 'discovery', adapter.slug);
  await writeDiscoveryFile(join(adapterRoot, '.adapter.md'), renderAdapterReadme(adapter));
  await writeDiscoveryFile(join(root, 'packages', adapter.slug, 'src', 'resources.ts'), renderResourcesTs(adapter));

  for (const endpoint of adapter.endpoints) {
    const resource = resourceMetadata(adapter, endpoint);
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
  const resources = adapter.endpoints.map((endpoint) => resourceMetadata(adapter, endpoint));
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
  const resource = resourceMetadata({ slug: '' }, endpoint);
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
  const resources = adapter.endpoints.map((endpoint) => resourceMetadata(adapter, endpoint));
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

function fullRecordSchema(schema) {
  const properties = {
    ...schema.properties,
    id: readOnlyString('Provider canonical record id.'),
    createdAt: readOnlyString('Provider creation timestamp.', 'date-time'),
    updatedAt: readOnlyString('Provider last update timestamp.', 'date-time'),
    url: readOnlyString('Provider URL for the record.', 'uri'),
    identifier: readOnlyString('Provider human-readable identifier or key.'),
    provider: readOnlyString('Relayfile provider name.'),
    objectType: readOnlyString('Relayfile object type.'),
    objectId: readOnlyString('Relayfile object id.'),
    workspaceId: readOnlyString('Relayfile workspace id.'),
    connectionId: readOnlyString('Relayfile connection id.'),
    _webhook: {
      type: 'object',
      description: 'Provider webhook metadata captured during sync.',
      readOnly: true,
      additionalProperties: true,
    },
    _connection: {
      type: 'object',
      description: 'Relayfile connection metadata captured during sync.',
      readOnly: true,
      additionalProperties: true,
    },
  };

  return {
    ...schema,
    title: schema.title.replace(/^Create /, ''),
    description: 'Full resource record schema. Fields marked readOnly are synced from the provider and cannot be written by agents.',
    properties,
    additionalProperties: false,
  };
}

function readOnlyString(description, format) {
  return {
    type: 'string',
    ...(format ? { format } : {}),
    description,
    readOnly: true,
  };
}

function resourceMetadata(adapter, endpoint) {
  const resourcePath = endpoint.path.replace(/\/new\.json$/, '');
  return {
    name: resourceNameFor(adapter.slug, resourcePath),
    resourcePath,
    schemaPath: `${resourcePath}/.schema.json`,
    examplePath: `${resourcePath}/.create.example.json`,
    description: endpoint.description,
    pathPatternLiteral: patternLiteral(pathPatternSourceFor(resourcePath)),
    ...idPatternFor(adapter.slug, resourcePath),
  };
}

function resourceNameFor(adapterSlug, resourcePath) {
  if (adapterSlug === 'github' && resourcePath.includes('/issues/') && resourcePath.endsWith('/comments')) {
    return 'issue-comments';
  }
  if (adapterSlug === 'slack' && resourcePath.includes('/users/') && resourcePath.endsWith('/messages')) {
    return 'direct-messages';
  }
  return resourcePath.split('/').filter(Boolean).at(-1) ?? adapterSlug;
}

function pathPatternSourceFor(resourcePath) {
  const resourceSegments = resourcePath.split('/').filter(Boolean).map((segment) => {
    if (segment === '{projectPath}') {
      return '.+?';
    }
    if (/^\{[^}]+\}$/.test(segment)) {
      return '[^/]+';
    }
    return escapeRegex(segment);
  });
  return `^/${resourceSegments.join('/')}(?:/[^/]+(?:\\.json)?)?$`;
}

function idPatternFor(adapterSlug, resourcePath) {
  // Patterns must stay in lockstep with each adapter's `src/resources.ts`.
  // Path-mappers emit canonical filenames as either `<id>` or
  // `<slug>(?:--|__)<id>`, so most adapters allow an optional slug prefix.
  // Editors: when adjusting an idPattern in resources.ts, mirror the change
  // here — the discovery generator overwrites resources.ts on regeneration.
  if (adapterSlug === 'linear') {
    return pattern('^(?:[A-Za-z0-9_.~-]+(?:--|__))?(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$', 'i');
  }
  if (adapterSlug === 'notion') {
    return pattern('^(?:[A-Za-z0-9_.~-]+(?:--|__))?(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$', 'i');
  }
  if (adapterSlug === 'slack') {
    if (resourcePath.includes('/users/') && resourcePath.endsWith('/messages')) {
      return pattern('^$');
    }
    if (resourcePath.endsWith('/messages') || resourcePath.endsWith('/replies')) {
      return pattern('^(?:[A-Za-z0-9_.:-]+--)?\\d{10,}(?:_\\d+)?$');
    }
    return pattern('^[A-Za-z0-9_.:-]+(?:--[A-Za-z0-9_.:-]+)*$');
  }
  if (adapterSlug === 'gitlab') {
    return pattern('^[A-Za-z0-9_.:-]+$');
  }
  if (adapterSlug === 'github') {
    if (resourcePath.endsWith('/issues')) {
      return pattern('^[1-9]\\d*$');
    }
    return pattern('^\\d+$');
  }
  if (adapterSlug === 'hubspot' || adapterSlug === 'pipedrive' || adapterSlug === 'asana') {
    return pattern('^(?:[A-Za-z0-9_.~-]+--)?\\d+$');
  }
  if (adapterSlug === 'jira') {
    if (resourcePath.endsWith('/transitions')) {
      return pattern('^$');
    }
    return resourcePath.includes('/comments')
      ? pattern('^(?:[A-Za-z0-9_.~-]+--)?\\d+$')
      : pattern('^(?:[A-Za-z0-9_.~-]+--(?:[A-Z][A-Z0-9]+(?:-\\d+)?|\\d+)|[A-Z][A-Z0-9]+-\\d+|\\d+)$');
  }
  if (adapterSlug === 'salesforce') {
    return pattern('^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$');
  }
  if (adapterSlug === 'teams') {
    return pattern('^[A-Za-z0-9_.=!-]+$');
  }
  if (adapterSlug === 'clickup') {
    return pattern('^(?:[A-Za-z0-9_.~-]+--)?[A-Za-z0-9_]+$');
  }
  if (adapterSlug === 'confluence') {
    return pattern('^(?:[A-Za-z0-9_.~-]+(?:--|__))?\\d+$');
  }
  if (adapterSlug === 'intercom') {
    return pattern('^[A-Za-z0-9_-]+$');
  }
  if (adapterSlug === 'zendesk') {
    return pattern('^\\d+$');
  }
  if (adapterSlug === 'google-calendar') {
    return pattern('^[a-v0-9]{5,1024}$');
  }
  return pattern('^[A-Za-z0-9_.:-]+$');
}

function pattern(source, flags = '') {
  return {
    idPatternLiteral: patternLiteral(source, flags),
    idPatternSource: source,
  };
}

// GitHub markdown tables split cells on every literal `|`, so a regex like
// `(a|b)` would render as four columns. Backslash-escape pipes inside the
// inline-code cell so the table stays intact.
function escapeMarkdownTableCell(value) {
  return value.replace(/\|/g, '\\|');
}

function patternLiteral(source, flags = '') {
  return `/${source.replaceAll('/', '\\/')}/${flags}`;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
