import { readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import YAML from 'yaml';

const scriptsRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptsRoot);
const defaultContractRoot = join(scriptsRoot, 'integration-contracts');
const OPENAPI_METHODS = ['delete', 'get', 'patch', 'post', 'put'];
let defaultContractsCache;

export function loadWritebackContracts(contractRoot = defaultContractRoot) {
  if (contractRoot === defaultContractRoot && defaultContractsCache) {
    return defaultContractsCache;
  }

  const contractsByProvider = new Map();
  let providers;
  try {
    providers = readdirSync(contractRoot, { withFileTypes: true });
  } catch {
    return contractsByProvider;
  }

  for (const providerDir of providers) {
    if (!providerDir.isDirectory()) {
      continue;
    }
    const provider = providerDir.name;
    const providerRoot = join(contractRoot, provider);
    const operations = new Map();
    const sources = [];

    for (const file of readdirSync(providerRoot, { withFileTypes: true })) {
      if (!file.isFile()) {
        continue;
      }
      const sourcePath = join(providerRoot, file.name);
      const source = loadContractSource(sourcePath);
      if (!source) {
        continue;
      }
      sources.push({
        path: sourcePath,
        kind: source.kind,
        title: source.title,
        sourceUrl: source.sourceUrl,
      });
      for (const operation of source.operations) {
        operations.set(operation.operationId, operation);
      }
    }

    if (operations.size > 0) {
      contractsByProvider.set(provider, { provider, sources, operations });
    }
  }

  if (contractRoot === defaultContractRoot) {
    defaultContractsCache = contractsByProvider;
  }

  return contractsByProvider;
}

export function applyEndpointContract(endpoint, adapterContract) {
  if (!endpoint.contract) {
    return endpoint;
  }
  if (!adapterContract) {
    throw new Error(`Missing contract source for ${endpoint.path}`);
  }

  const operation = adapterContract.operations.get(endpoint.contract.operationId);
  if (!operation) {
    throw new Error(`Missing contract operation ${endpoint.contract.operationId} for ${endpoint.path}`);
  }

  const schema = mergeJsonSchema(
    operation.requestSchema,
    endpoint.contract.schemaOverrides ?? {},
  );

  const contractSource = {
    operationId: operation.operationId,
    sourceKind: operation.sourceKind,
    sourcePath: toRepoRelativePath(operation.sourcePath),
    sourceUrl: operation.sourceUrl,
  };

  return {
    ...endpoint,
    title: endpoint.title ?? operation.summary ?? endpoint.contract.operationId,
    description: endpoint.description ?? operation.description ?? operation.summary ?? '',
    schema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title: endpoint.title ?? operation.summary ?? endpoint.contract.operationId,
      description: operation.description ?? operation.summary ?? '',
      type: 'object',
      required: [],
      properties: {},
      additionalProperties: false,
      ...schema,
      'x-relayfile-source': contractSource,
    },
    example: endpoint.example ?? operation.example ?? {},
    contractSource,
  };
}

function loadContractSource(sourcePath) {
  const extension = extname(sourcePath);
  if (!['.yaml', '.yml', '.json'].includes(extension)) {
    return undefined;
  }

  const raw = parseStructuredFile(sourcePath);
  if (isOpenApiManifest(raw)) {
    return openApiManifestContractSource(sourcePath, raw);
  }
  if (isOpenApiDocument(raw)) {
    return openApiContractSource(sourcePath, raw);
  }
  if (raw?.$schema || raw?.type || raw?.properties) {
    return jsonSchemaContractSource(sourcePath, raw);
  }
  return undefined;
}

function parseStructuredFile(sourcePath) {
  const text = readFileSync(sourcePath, 'utf8');
  if (['.yaml', '.yml'].includes(extname(sourcePath))) {
    return YAML.parse(text);
  }
  return JSON.parse(text);
}

function isOpenApiDocument(value) {
  return value && typeof value === 'object' && typeof value.openapi === 'string' && value.paths;
}

function isOpenApiManifest(value) {
  return value
    && typeof value === 'object'
    && value.kind === 'openapi'
    && typeof value.sourcePath === 'string'
    && Array.isArray(value.operations);
}

function openApiManifestContractSource(sourcePath, manifest) {
  const sourceDocumentPath = resolve(dirname(sourcePath), manifest.sourcePath);
  const sourceDocument = parseStructuredFile(sourceDocumentPath);
  if (!isOpenApiDocument(sourceDocument)) {
    throw new Error(`OpenAPI contract manifest ${sourcePath} points at a non-OpenAPI source: ${manifest.sourcePath}`);
  }

  const operationIds = manifest.operations.map((entry) => typeof entry === 'string' ? entry : entry.operationId);
  const source = openApiContractSource(sourceDocumentPath, sourceDocument, new Set(operationIds));
  const operationsById = new Map(source.operations.map((operation) => [operation.operationId, operation]));
  const sourceUrl = manifest.sourceUrl ?? manifest['x-relayfile-source']?.url ?? source.sourceUrl;
  const operations = manifest.operations.map((entry) => {
    const operationId = typeof entry === 'string' ? entry : entry.operationId;
    if (!operationId) {
      throw new Error(`OpenAPI contract manifest ${sourcePath} has an operation without operationId`);
    }
    const operation = operationsById.get(operationId);
    if (!operation) {
      throw new Error(`OpenAPI contract manifest ${sourcePath} references missing operation ${operationId}`);
    }
    return {
      ...operation,
      summary: entry.summary ?? operation.summary,
      description: entry.description ?? operation.description,
      sourcePath: sourceDocumentPath,
      sourceUrl,
    };
  });

  return {
    kind: 'openapi-manifest',
    title: manifest.title ?? source.title,
    sourceUrl,
    operations,
  };
}

function openApiContractSource(sourcePath, document, operationIdFilter) {
  const context = contractContext(sourcePath, document);
  const operations = [];
  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    if (!pathItem || typeof pathItem !== 'object') {
      continue;
    }
    for (const method of OPENAPI_METHODS) {
      const operation = pathItem[method];
      if (!operation || typeof operation !== 'object' || typeof operation.operationId !== 'string') {
        continue;
      }
      if (operationIdFilter && !operationIdFilter.has(operation.operationId)) {
        continue;
      }
      const requestBody = resolveJsonValue(operation.requestBody, context);
      const requestMedia = pickJsonRequestMedia(requestBody?.content);
      const requestSchema = requestMedia?.schema ? resolveJsonValue(requestMedia.schema, context) : undefined;
      if (!requestSchema) {
        continue;
      }
      operations.push({
        operationId: operation.operationId,
        method: method.toUpperCase(),
        path,
        summary: operation.summary,
        description: operation.description,
        requestSchema: normalizeJsonSchema(resolveAllOf(requestSchema)),
        example: firstDefined([
          requestMedia.example,
          firstOpenApiExample(requestMedia.examples, context),
          requestSchema.example,
          firstArrayEntry(requestSchema.examples),
        ]),
        sourceKind: 'openapi',
        sourcePath,
        sourceUrl: document['x-relayfile-source']?.url,
      });
    }
  }

  return {
    kind: 'openapi',
    title: document.info?.title,
    sourceUrl: document['x-relayfile-source']?.url,
    operations,
  };
}

function jsonSchemaContractSource(sourcePath, schema) {
  const context = contractContext(sourcePath, schema);
  const resolvedSchema = resolveJsonValue(schema, context);
  const operationId = resolvedSchema['x-relayfile-operation-id'] ?? resolvedSchema.$id ?? resolvedSchema.title ?? sourcePath;
  return {
    kind: 'json-schema',
    title: resolvedSchema.title,
    sourceUrl: resolvedSchema['x-relayfile-source']?.url,
    operations: [
      {
        operationId,
        summary: resolvedSchema.title,
        description: resolvedSchema.description,
        requestSchema: normalizeJsonSchema(resolveAllOf(resolvedSchema)),
        example: firstDefined([
          resolvedSchema.example,
          firstArrayEntry(resolvedSchema.examples),
        ]),
        sourceKind: 'json-schema',
        sourcePath,
        sourceUrl: resolvedSchema['x-relayfile-source']?.url,
      },
    ],
  };
}

function pickJsonRequestMedia(content) {
  if (!content || typeof content !== 'object') {
    return undefined;
  }
  if (content['application/json']) {
    return content['application/json'];
  }
  const jsonLike = Object.entries(content).find(([contentType]) => /\bjson\b|\+json\b/i.test(contentType));
  return jsonLike?.[1];
}

function contractContext(sourcePath, document) {
  return {
    sourcePath,
    sourceDir: dirname(sourcePath),
    document,
  };
}

function resolveJsonValue(value, context, seen = new Set()) {
  if (!value || typeof value !== 'object') {
    return value;
  }

  if (typeof value.$ref === 'string') {
    const refKey = `${context.sourcePath}:${value.$ref}`;
    if (seen.has(refKey)) {
      throw new Error(`Circular $ref in writeback contract: ${value.$ref}`);
    }
    seen.add(refKey);
    const resolved = resolveJsonValue(readRef(value.$ref, context), context, seen);
    seen.delete(refKey);

    const { $ref, ...siblings } = value;
    if (Object.keys(siblings).length === 0) {
      return resolved;
    }
    return mergeJsonSchema(resolved, resolveJsonValue(siblings, context, seen));
  }

  if (Array.isArray(value)) {
    return value.map((entry) => resolveJsonValue(entry, context, seen));
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, resolveJsonValue(entry, context, seen)]),
  );
}

function readRef(ref, context) {
  const [filePart, pointerPart = ''] = ref.split('#');
  if (!filePart) {
    return readJsonPointer(context.document, `#${pointerPart}`);
  }

  const refPath = resolve(context.sourceDir, filePart);
  const document = parseStructuredFile(refPath);
  return resolveJsonValue(readJsonPointer(document, `#${pointerPart}`), contractContext(refPath, document));
}

function readJsonPointer(document, pointer) {
  if (!pointer || pointer === '#') {
    return document;
  }
  if (!pointer.startsWith('#/')) {
    throw new Error(`Unsupported writeback contract pointer: ${pointer}`);
  }

  return pointer
    .slice(2)
    .split('/')
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce((current, segment) => {
      if (current?.[segment] === undefined) {
        throw new Error(`Missing JSON pointer segment "${segment}" in ${pointer}`);
      }
      return current[segment];
    }, document);
}

function firstOpenApiExample(examples, context) {
  if (!examples || typeof examples !== 'object') {
    return undefined;
  }
  const example = resolveJsonValue(Object.values(examples)[0], context);
  return example?.value ?? example;
}

function firstArrayEntry(values) {
  return Array.isArray(values) ? values[0] : undefined;
}

function firstDefined(values) {
  return values.find((value) => value !== undefined);
}

function resolveAllOf(schema) {
  if (!schema || typeof schema !== 'object') {
    return schema;
  }
  if (Array.isArray(schema)) {
    return schema.map(resolveAllOf);
  }

  const withoutAllOf = Object.fromEntries(
    Object.entries(schema)
      .filter(([key]) => key !== 'allOf')
      .map(([key, value]) => [key, resolveAllOf(value)]),
  );

  if (!Array.isArray(schema.allOf)) {
    return withoutAllOf;
  }

  return schema.allOf
    .map(resolveAllOf)
    .reduce((merged, entry) => mergeJsonSchema(merged, entry), withoutAllOf);
}

function normalizeJsonSchema(schema) {
  if (!schema || typeof schema !== 'object') {
    return {};
  }
  const output = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'nullable' && value === true) {
      continue;
    }
    output[key] = normalizeJsonSchemaValue(value);
  }
  if (schema.nullable === true && typeof schema.type === 'string') {
    output.type = [schema.type, 'null'];
  }
  return output;
}

function normalizeJsonSchemaValue(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeJsonSchemaValue);
  }
  if (value && typeof value === 'object') {
    return normalizeJsonSchema(value);
  }
  return value;
}

function mergeJsonSchema(base, override) {
  if (Array.isArray(base) || Array.isArray(override)) {
    return override === undefined ? base : override;
  }
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override === undefined ? base : override;
  }

  const merged = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (key === 'properties' && isPlainObject(value)) {
      merged.properties = mergeJsonSchema(base.properties ?? {}, value);
      continue;
    }
    if (key === 'items' && isPlainObject(value)) {
      merged.items = mergeJsonSchema(base.items ?? {}, value);
      continue;
    }
    merged[key] = mergeJsonSchema(base[key], value);
  }
  return merged;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toRepoRelativePath(path) {
  const relativePath = relative(repoRoot, path);
  return relativePath.startsWith('..') ? path : relativePath;
}
