import {
  applyEndpointContract,
  loadWritebackContracts,
} from './writeback-contracts.mjs';

export function normalizeWritebackDiscoveryData(adapters, options = {}) {
  const layoutManifestByProvider = normalizeLayoutManifestInput(options.layoutManifests);
  const contractsByProvider = options.contracts ?? loadWritebackContracts(options.contractRoot);
  return {
    adapters: adapters.map((adapter) =>
      normalizeWritebackDiscoveryAdapter(adapter, {
        layoutManifest: layoutManifestByProvider.get(adapter.slug),
        contract: contractsByProvider.get(adapter.slug),
      }),
    ),
  };
}

export function normalizeWritebackDiscoveryAdapter(adapter, options = {}) {
  const layoutManifest = options.layoutManifest
    ? normalizeLayoutManifest(options.layoutManifest)
    : undefined;
  const adapterContract = Object.hasOwn(options, 'contract')
    ? options.contract
    : loadWritebackContracts(options.contractRoot).get(adapter.slug);
  const endpoints = adapter.endpoints.map((endpoint) => {
    const contractedEndpoint = applyEndpointContract(endpoint, adapterContract);
    return {
      ...contractedEndpoint,
      resource: normalizeWritebackEndpointResource(adapter.slug, contractedEndpoint, layoutManifest),
    };
  });
  return {
    slug: adapter.slug,
    title: adapter.title,
    overview: adapter.overview,
    readPaths: adapter.readPaths.map(([path, description]) => [path, description]),
    ...(layoutManifest ? { layoutManifest } : {}),
    endpoints,
    resources: endpoints.map((endpoint) => endpoint.resource),
  };
}

export function fullRecordSchema(schema) {
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

export function escapeMarkdownTableCell(value) {
  return value.replace(/\|/g, '\\|');
}

export function normalizeWritebackEndpointResource(adapterSlug, endpoint, layoutManifest) {
  const resourcePath = endpoint.path.replace(/\/new\.json$/, '');
  const layoutMatch = layoutManifest ? findLayoutWritebackResource(layoutManifest, resourcePath) : undefined;
  return {
    name: resourceNameFor(adapterSlug, resourcePath),
    resourcePath,
    schemaPath: `${resourcePath}/.schema.json`,
    examplePath: `${resourcePath}/.create.example.json`,
    description: endpoint.description,
    pathPatternSource: pathPatternSourceFor(adapterSlug, resourcePath),
    pathPatternLiteral: patternLiteral(pathPatternSourceFor(adapterSlug, resourcePath)),
    ...idPatternFor(adapterSlug, resourcePath),
    ...(layoutMatch
      ? {
          layoutResource: layoutMatch.resource,
          layoutWritebackResource: layoutMatch.writebackResource,
        }
      : {}),
  };
}

export function normalizeLayoutManifest(manifest) {
  return {
    provider: manifest.provider,
    filenameConvention: manifest.filenameConvention,
    aliasSegments: [...(manifest.aliasSegments ?? [])],
    resources: (manifest.resources ?? []).map((resource) => ({
      path: normalizeLayoutPath(resource.path),
      title: resource.title,
      materialization: resource.materialization,
      aliasSegments: [...(resource.aliasSegments ?? [])],
      writebackResources: (resource.writebackResources ?? []).map((writebackResource) => ({
        path: normalizeLayoutPath(writebackResource.path),
        schemaId: writebackResource.schemaId,
      })),
    })),
  };
}

function normalizeLayoutManifestInput(layoutManifests) {
  if (!layoutManifests) {
    return new Map();
  }
  if (layoutManifests instanceof Map) {
    return new Map([...layoutManifests].map(([provider, manifest]) => [provider, normalizeLayoutManifest(manifest)]));
  }
  if (Array.isArray(layoutManifests)) {
    return new Map(layoutManifests.map((manifest) => [manifest.provider, normalizeLayoutManifest(manifest)]));
  }
  return new Map(
    Object.entries(layoutManifests).map(([provider, manifest]) => [
      provider,
      normalizeLayoutManifest({ provider, ...manifest }),
    ]),
  );
}

function findLayoutWritebackResource(layoutManifest, resourcePath) {
  const targetSegments = pathSegments(resourcePath);
  for (const resource of layoutManifest.resources) {
    for (const writebackResource of resource.writebackResources) {
      if (layoutPathMatchesResource(pathSegments(writebackResource.path), targetSegments)) {
        return { resource, writebackResource };
      }
    }
  }
  return undefined;
}

function pathSegments(path) {
  return normalizeLayoutPath(path)
    .split('/')
    .filter(Boolean);
}

function layoutPathMatchesResource(layoutSegments, resourceSegments) {
  let resourceIndex = 0;

  for (const layoutSegment of layoutSegments) {
    const resourceSegment = resourceSegments[resourceIndex];
    if (resourceSegment === undefined) {
      return false;
    }

    if (isDynamicSegment(layoutSegment)) {
      if (!isDynamicSegment(resourceSegment)) {
        return false;
      }
      resourceIndex += 1;
      continue;
    }

    while (isDynamicSegment(resourceSegments[resourceIndex])) {
      resourceIndex += 1;
    }

    if (resourceSegments[resourceIndex] !== layoutSegment) {
      return false;
    }
    resourceIndex += 1;
  }

  return resourceIndex === resourceSegments.length;
}

function isDynamicSegment(segment) {
  return segment === '*' || /^\{[^}]+\}$/.test(segment);
}

function normalizeLayoutPath(path) {
  return `/${String(path).replace(/^\/+/, '').replace(/\/+$/, '')}`;
}

function readOnlyString(description, format) {
  return {
    type: 'string',
    ...(format ? { format } : {}),
    description,
    readOnly: true,
  };
}

function resourceNameFor(adapterSlug, resourcePath) {
  if (adapterSlug === 'github' && resourcePath.includes('/issues/') && resourcePath.endsWith('/comments')) {
    return 'issue-comments';
  }
  if (adapterSlug === 'slack' && resourcePath.includes('/users/') && resourcePath.endsWith('/messages')) {
    return 'direct-messages';
  }
  const last = resourcePath.split('/').filter(Boolean).at(-1);
  if (!last) return adapterSlug;
  if (/^\{[^}]+\}\.json$/u.test(last)) {
    return resourcePath.split('/').filter(Boolean).at(-2) ?? adapterSlug;
  }
  return last.replace(/\.(?:json|md)$/u, '');
}

function pathPatternSourceFor(adapterSlug, resourcePath) {
  if (adapterSlug === 'slack' && resourcePath === '/slack/channels/{channelId}/messages') {
    return '^/slack/channels/[^/]+/messages(?:/[^/]+(?:\\.json|/meta\\.json)?)?$';
  }
  if (adapterSlug === 'gitlab' && resourcePath.includes('/merge_requests/{mergeRequestIid}__{slug}/discussions')) {
    return '^/gitlab/projects/.+?/merge_requests/[^/]+(?:__[^/]+)?/discussions(?:/[^/]+(?:\\.json)?)?$';
  }
  if (adapterSlug === 'gitlab' && resourcePath.includes('/issues/{issueIid}__{slug}/comments')) {
    return '^/gitlab/projects/.+?/issues/[^/]+(?:__[^/]+)?/comments(?:/[^/]+(?:\\.json)?)?$';
  }
  if (adapterSlug === 'github' && resourcePath === '/github/repos/{owner}/{repo}/pulls/{pullNumber}/merge.json') {
    return '^/github/repos/[^/]+/[^/]+/pulls/[1-9]\\d*(?:__[^/]+)?/merge\\.json$';
  }

  const resourceSegments = resourcePath.split('/').filter(Boolean).map((segment) => {
    if (segment === '{projectPath}') {
      return '.+?';
    }
    if (/^\{[^}]+\}$/.test(segment)) {
      return '[^/]+';
    }
    if (segment.includes('{')) {
      return escapeRegex(segment).replace(/\\\{[^}]+\\\}/g, '[^/]+');
    }
    return escapeRegex(segment);
  });
  if (/\.(?:json|md)$/u.test(resourcePath)) {
    return `^/${resourceSegments.join('/')}$`;
  }
  return `^/${resourceSegments.join('/')}(?:/[^/]+(?:\\.json)?)?$`;
}

function idPatternFor(adapterSlug, resourcePath) {
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
    if (resourcePath === '/slack/channels/{channelId}/messages') {
      return pattern('^(?:meta|(?:[A-Za-z0-9_.:-]+--)?\\d{10,}(?:_\\d+)?)$');
    }
    if (resourcePath.endsWith('/replies')) {
      return pattern('^(?:[A-Za-z0-9_.:-]+--)?\\d{10,}(?:_\\d+)?$');
    }
    return pattern('^[A-Za-z0-9_.:-]+(?:--[A-Za-z0-9_.:-]+)*$');
  }
  if (adapterSlug === 'gitlab') {
    return pattern('^[A-Za-z0-9_.:-]+$');
  }
  if (adapterSlug === 'granola') {
    return resourcePath.endsWith('/folders')
      ? pattern('^fol_[A-Za-z0-9]{14}$')
      : pattern('^not_[A-Za-z0-9]{14}$');
  }
  if (adapterSlug === 'reddit') {
    return resourcePath.endsWith('/posts')
      ? pattern('^[A-Za-z0-9_/-]+$')
      : pattern('^[A-Za-z0-9_][A-Za-z0-9_-]{1,63}$');
  }
  if (adapterSlug === 'github') {
    if (resourcePath === '/github/repos/{owner}/{repo}/pulls/{pullNumber}/merge.json') {
      return pattern('^[1-9]\\d*(?:__.*)?$');
    }
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
      ? pattern('^(?:[A-Za-z0-9_.~-]+(?:--|__))?\\d+$')
      : pattern('^(?:[A-Za-z0-9_.~-]+(?:--|__)(?:[A-Z][A-Z0-9]+(?:-\\d+)?|\\d+)|[A-Z][A-Z0-9]+-\\d+|\\d+)$');
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

function patternLiteral(source, flags = '') {
  return `/${source.replaceAll('/', '\\/')}/${flags}`;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
