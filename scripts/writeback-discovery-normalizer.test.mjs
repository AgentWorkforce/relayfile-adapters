import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { adapters } from './writeback-discovery-data.mjs';
import { loadWritebackContracts } from './writeback-contracts.mjs';
import {
  escapeMarkdownTableCell,
  fullRecordSchema,
  normalizeLayoutManifest,
  normalizeWritebackDiscoveryAdapter,
  normalizeWritebackDiscoveryData,
} from './writeback-discovery-normalizer.mjs';

test('loads GitHub writeback operations from a local OpenAPI contract', () => {
  const contracts = loadWritebackContracts();
  const github = contracts.get('github');

  assert.ok(github);
  assert.deepEqual([...github.operations.keys()], ['issues/create', 'issues/create-comment', 'pulls/create-review', 'pulls/merge', 'pulls/create-reply-for-review-comment']);
  assert.equal(github.operations.get('issues/create').requestSchema.required[0], 'title');
  assert.deepEqual(github.operations.get('pulls/create-review').requestSchema.properties.event.enum, ['APPROVE', 'REQUEST_CHANGES', 'COMMENT']);
});

test('loads OpenAPI YAML request schemas with refs, JSON media types, and examples', () => {
  const contractRoot = mkdtempSync(join(tmpdir(), 'writeback-contracts-'));
  const providerRoot = join(contractRoot, 'example');
  mkdirSync(providerRoot, { recursive: true });
  writeFileSync(join(providerRoot, 'shared.yaml'), [
    'components:',
    '  schemas:',
    '    WidgetBase:',
    '      type: object',
    '      required: [name]',
    '      properties:',
    '        name:',
    '          type: string',
    '          description: Widget name.',
    '        status:',
    '          type: string',
    '          enum: [open, closed]',
    '          description: Widget status.',
    '',
  ].join('\n'));
  writeFileSync(join(providerRoot, 'widgets.openapi.yaml'), [
    'openapi: 3.1.0',
    'info:',
    '  title: Example API',
    '  version: "1.0"',
    'paths:',
    '  /widgets:',
    '    post:',
    '      operationId: widgets/create',
    '      summary: Create widget',
    '      requestBody:',
    '        content:',
    '          application/vnd.api+json:',
    '            examples:',
    '              minimal:',
    '                value:',
    '                  name: Demo',
    '                  status: open',
    '            schema:',
    '              allOf:',
    '                - $ref: "./shared.yaml#/components/schemas/WidgetBase"',
    '                - type: object',
    '                  properties:',
    '                    priority:',
    '                      type: integer',
    '                      description: Widget priority.',
    '',
  ].join('\n'));

  const operation = loadWritebackContracts(contractRoot).get('example').operations.get('widgets/create');

  assert.deepEqual(operation.requestSchema.required, ['name']);
  assert.equal(operation.requestSchema.properties.name.description, 'Widget name.');
  assert.deepEqual(operation.requestSchema.properties.status.enum, ['open', 'closed']);
  assert.equal(operation.requestSchema.properties.priority.description, 'Widget priority.');
  assert.deepEqual(operation.example, { name: 'Demo', status: 'open' });
});

test('loads JSON Schema contracts with descriptions, enum values, required fields, and examples', () => {
  const contractRoot = mkdtempSync(join(tmpdir(), 'writeback-contracts-'));
  const providerRoot = join(contractRoot, 'json-provider');
  mkdirSync(providerRoot, { recursive: true });
  writeFileSync(join(providerRoot, 'task.schema.json'), JSON.stringify({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'tasks/create',
    title: 'Create Task',
    description: 'Creates a task from a JSON Schema contract.',
    type: 'object',
    required: ['name', 'state'],
    properties: {
      name: {
        type: 'string',
        description: 'Task name.',
      },
      state: {
        type: 'string',
        enum: ['todo', 'done'],
        description: 'Task state.',
      },
    },
    example: {
      name: 'Demo task',
      state: 'todo',
    },
  }, null, 2));

  const operation = loadWritebackContracts(contractRoot).get('json-provider').operations.get('tasks/create');

  assert.equal(operation.sourceKind, 'json-schema');
  assert.deepEqual(operation.requestSchema.required, ['name', 'state']);
  assert.deepEqual(operation.requestSchema.properties.state.enum, ['todo', 'done']);
  assert.deepEqual(operation.example, { name: 'Demo task', state: 'todo' });
});

test('normalizes endpoints with schemas loaded from integration contracts', () => {
  const github = adapters.find((adapter) => adapter.slug === 'github');
  assert.ok(github);

  const normalized = normalizeWritebackDiscoveryAdapter(github);
  const issueEndpoint = normalized.endpoints.find((endpoint) => endpoint.path === '/github/repos/{owner}/{repo}/issues/new.json');
  const reviewEndpoint = normalized.endpoints.find((endpoint) => endpoint.path === '/github/repos/{owner}/{repo}/pulls/{pullNumber}/reviews/new.json');

  assert.deepEqual(issueEndpoint.schema.required, ['title']);
  assert.equal(issueEndpoint.schema.properties.body.description, 'The contents of the issue.');
  assert.deepEqual(issueEndpoint.example, { title: 'Replace example issue title', body: 'Replace example issue body.', labels: ['triage'] });
  assert.deepEqual(reviewEndpoint.schema.required, ['event', 'body', 'comments']);
  assert.deepEqual(reviewEndpoint.schema.properties.event.enum, ['APPROVE', 'REQUEST_CHANGES', 'COMMENT']);
  assert.equal(reviewEndpoint.schema.properties.metadata.description, 'Optional submission metadata.');
});

test('normalizes existing writeback discovery adapter endpoints without changing generated paths', () => {
  const github = adapters.find((adapter) => adapter.slug === 'github');
  assert.ok(github);

  const normalized = normalizeWritebackDiscoveryAdapter(github);
  const issueEndpoint = normalized.endpoints.find((endpoint) => endpoint.path === '/github/repos/{owner}/{repo}/issues/new.json');
  assert.ok(issueEndpoint);
  assert.match(issueEndpoint.schema.properties.issue_field_values.description, /Issue fields are only available/);
  assert.deepEqual(issueEndpoint.schema.properties.type.type, ['string', 'null']);
  assert.deepEqual(issueEndpoint.resource, {
    name: 'issues',
    resourcePath: '/github/repos/{owner}/{repo}/issues',
    schemaPath: '/github/repos/{owner}/{repo}/issues/.schema.json',
    examplePath: '/github/repos/{owner}/{repo}/issues/.create.example.json',
    description: 'Creates a GitHub issue.',
    pathPatternSource: '^/github/repos/[^/]+/[^/]+/issues(?:/[^/]+(?:\\.json)?)?$',
    pathPatternLiteral: '/^\\/github\\/repos\\/[^\\/]+\\/[^\\/]+\\/issues(?:\\/[^\\/]+(?:\\.json)?)?$/',
    idPatternLiteral: '/^[1-9]\\d*$/',
    idPatternSource: '^[1-9]\\d*$',
  });

  const commentEndpoint = normalized.endpoints.find((endpoint) => endpoint.path === '/github/repos/{owner}/{repo}/issues/{issueNumber}/comments/new.json');
  assert.ok(commentEndpoint);
  assert.deepEqual(commentEndpoint.resource, {
    name: 'issue-comments',
    resourcePath: '/github/repos/{owner}/{repo}/issues/{issueNumber}/comments',
    schemaPath: '/github/repos/{owner}/{repo}/issues/{issueNumber}/comments/.schema.json',
    examplePath: '/github/repos/{owner}/{repo}/issues/{issueNumber}/comments/.create.example.json',
    description: 'Creates or updates a GitHub issue comment.',
    pathPatternSource: '^/github/repos/[^/]+/[^/]+/issues/[^/]+/comments(?:/[^/]+(?:\\.json|/meta\\.json)?)?$',
    pathPatternLiteral: '/^\\/github\\/repos\\/[^\\/]+\\/[^\\/]+\\/issues\\/[^\\/]+\\/comments(?:\\/[^\\/]+(?:\\.json|\\/meta\\.json)?)?$/',
    idPatternLiteral: '/^(?:meta|\\d+)$/',
    idPatternSource: '^(?:meta|\\d+)$',
  });
});

test('normalizes Notion page meta writebacks as pages resources', () => {
  const notion = adapters.find((adapter) => adapter.slug === 'notion');
  assert.ok(notion);

  const normalized = normalizeWritebackDiscoveryAdapter(notion);
  const databasePageEndpoint = normalized.endpoints.find(
    (endpoint) => endpoint.path === '/notion/databases/{databaseId}/pages/{pageId}/meta.json'
  );
  assert.ok(databasePageEndpoint);
  assert.equal(databasePageEndpoint.resource.name, 'pages');
  assert.equal(databasePageEndpoint.resource.resourcePath, '/notion/databases/{databaseId}/pages/{pageId}/meta.json');

  const standalonePageEndpoint = normalized.endpoints.find(
    (endpoint) => endpoint.path === '/notion/pages/{pageId}/meta.json'
  );
  assert.ok(standalonePageEndpoint);
  assert.equal(standalonePageEndpoint.resource.name, 'pages');
  assert.equal(standalonePageEndpoint.resource.resourcePath, '/notion/pages/{pageId}/meta.json');
});

test('normalizes GitLab slugged nested writeback paths to runtime matchers', () => {
  const gitlab = adapters.find((adapter) => adapter.slug === 'gitlab');
  assert.ok(gitlab);

  const normalized = normalizeWritebackDiscoveryAdapter(gitlab);
  const discussionEndpoint = normalized.endpoints.find((endpoint) =>
    endpoint.path === '/gitlab/projects/{projectPath}/merge_requests/{mergeRequestIid}__{slug}/discussions/new.json'
  );
  const commentEndpoint = normalized.endpoints.find((endpoint) =>
    endpoint.path === '/gitlab/projects/{projectPath}/issues/{issueIid}__{slug}/comments/new.json'
  );

  assert.ok(discussionEndpoint, 'expected GitLab merge request discussion endpoint');
  assert.ok(commentEndpoint, 'expected GitLab issue comment endpoint');
  assert.equal(
    discussionEndpoint.resource.pathPatternSource,
    '^/gitlab/projects/.+?/merge_requests/[^/]+(?:__[^/]+)?/discussions(?:/[^/]+(?:\\.json)?)?$',
  );
  assert.equal(
    commentEndpoint.resource.pathPatternSource,
    '^/gitlab/projects/.+?/issues/[^/]+(?:__[^/]+)?/comments(?:/[^/]+(?:\\.json)?)?$',
  );
});

test('attaches optional layoutManifest-style writeback metadata by static path segments', () => {
  const github = adapters.find((adapter) => adapter.slug === 'github');
  assert.ok(github);

  const normalized = normalizeWritebackDiscoveryAdapter(github, {
    layoutManifest: githubLayoutManifest,
  });

  assert.equal(normalized.layoutManifest.provider, 'github');
  assert.deepEqual(normalized.layoutManifest.aliasSegments, ['by-id', 'by-name', 'by-title']);

  const issueEndpoint = normalized.endpoints.find((endpoint) => endpoint.path === '/github/repos/{owner}/{repo}/issues/new.json');
  assert.ok(issueEndpoint);
  assert.equal(issueEndpoint.resource.layoutResource.title, 'Issues');
  assert.deepEqual(issueEndpoint.resource.layoutWritebackResource, {
    path: '/github/repos/*/*/issues',
    schemaId: 'github/issue',
  });

  const commentEndpoint = normalized.endpoints.find((endpoint) => endpoint.path === '/github/repos/{owner}/{repo}/issues/{issueNumber}/comments/new.json');
  assert.ok(commentEndpoint);
  assert.equal(commentEndpoint.resource.layoutResource.title, 'Issues');
  assert.deepEqual(commentEndpoint.resource.layoutWritebackResource, {
    path: '/github/repos/*/*/issues/comments',
    schemaId: 'github/issue-comment',
  });
});

test('does not match layout writeback resources with only a trailing dynamic segment in common', () => {
  const normalized = normalizeWritebackDiscoveryAdapter(
    {
      slug: 'example',
      title: 'Example',
      overview: 'Example adapter.',
      readPaths: [],
      endpoints: [
        {
          path: '/example/widgets/{widgetId}/new.json',
          description: 'Creates a widget child.',
          schema: {
            title: 'Create Widget Child',
            type: 'object',
            properties: {},
          },
          example: {},
        },
      ],
    },
    {
      layoutManifest: {
        provider: 'example',
        filenameConvention: '<slug>__<id>.json',
        aliasSegments: [],
        resources: [
          {
            path: '/example/widgets',
            title: 'Widgets',
            materialization: 'eager',
            aliasSegments: [],
            writebackResources: [
              { path: '/example/widgets', schemaId: 'example/widget' },
            ],
          },
        ],
      },
    },
  );

  assert.equal(normalized.endpoints[0].resource.layoutWritebackResource, undefined);
});

test('does not match layout writeback resources with static segments in different positions', () => {
  const normalized = normalizeWritebackDiscoveryAdapter(
    {
      slug: 'example',
      title: 'Example',
      overview: 'Example adapter.',
      readPaths: [],
      endpoints: [
        {
          path: '/example/widgets/{widgetId}/comments/{commentId}/new.json',
          description: 'Creates a comment child.',
          schema: {
            title: 'Create Comment Child',
            type: 'object',
            properties: {},
          },
          example: {},
        },
      ],
    },
    {
      layoutManifest: {
        provider: 'example',
        filenameConvention: '<slug>__<id>.json',
        aliasSegments: [],
        resources: [
          {
            path: '/example/widgets',
            title: 'Widgets',
            materialization: 'eager',
            aliasSegments: [],
            writebackResources: [
              { path: '/example/widgets/comments/*/*', schemaId: 'example/comment' },
            ],
          },
        ],
      },
    },
  );

  assert.equal(normalized.endpoints[0].resource.layoutWritebackResource, undefined);
});

test('normalizes adapter collections with layout manifests supplied as a provider map', () => {
  const normalized = normalizeWritebackDiscoveryData(adapters, {
    layoutManifests: {
      github: githubLayoutManifest,
    },
  });

  assert.equal(normalized.adapters.length, adapters.length);
  const github = normalized.adapters.find((adapter) => adapter.slug === 'github');
  const jira = normalized.adapters.find((adapter) => adapter.slug === 'jira');
  assert.ok(github?.layoutManifest);
  assert.equal(jira?.layoutManifest, undefined);
});

test('normalizes layout manifest paths to leading-slash paths', () => {
  assert.deepEqual(normalizeLayoutManifest(githubLayoutManifest).resources[1], {
    path: '/github/repos/*/*/issues',
    title: 'Issues',
    materialization: 'eager',
    aliasSegments: ['by-id', 'by-title'],
    writebackResources: [
      { path: '/github/repos/*/*/issues', schemaId: 'github/issue' },
      { path: '/github/repos/*/*/issues/comments', schemaId: 'github/issue-comment' },
    ],
  });
});

test('fullRecordSchema marks provider-managed fields read-only', () => {
  const schema = fullRecordSchema({
    title: 'Create Issue',
    type: 'object',
    required: ['title'],
    properties: {
      title: { type: 'string' },
    },
  });

  assert.equal(schema.title, 'Issue');
  assert.equal(schema.properties.id.readOnly, true);
  assert.equal(schema.properties.updatedAt.format, 'date-time');
  assert.equal(schema.properties.title.readOnly, undefined);
  assert.equal(schema.additionalProperties, false);
});

test('fullRecordSchema allows explicitly writable system field names', () => {
  const schema = fullRecordSchema({
    title: 'Answer Callback',
    type: 'object',
    required: ['callback_query_id'],
    'x-relayfile-writableSystemFields': ['url'],
    properties: {
      callback_query_id: { type: 'string', description: 'Callback query id.' },
      url: { type: 'string', format: 'uri', description: 'Optional URL opened by the client.' },
    },
  });

  assert.deepEqual(schema['x-relayfile-writableSystemFields'], ['url']);
  assert.equal(schema.properties.url.readOnly, undefined);
  assert.equal(schema.properties.id.readOnly, true);
});

test('escapeMarkdownTableCell escapes literal pipes inside regex cells', () => {
  assert.equal(escapeMarkdownTableCell('/^(a|b)$/'), '/^(a\\|b)$/');
});

const githubLayoutManifest = {
  provider: 'github',
  filenameConvention: '<number>__<slug>/meta.json',
  aliasSegments: ['by-id', 'by-name', 'by-title'],
  resources: [
    {
      path: 'github/repos',
      title: 'Repositories',
      materialization: 'lazy',
      aliasSegments: ['by-name'],
      writebackResources: [],
    },
    {
      path: 'github/repos/*/*/issues',
      title: 'Issues',
      materialization: 'eager',
      aliasSegments: ['by-id', 'by-title'],
      writebackResources: [
        { path: 'github/repos/*/*/issues', schemaId: 'github/issue' },
        { path: 'github/repos/*/*/issues/comments', schemaId: 'github/issue-comment' },
      ],
    },
    {
      path: 'github/repos/*/*/pulls',
      title: 'Pull requests',
      materialization: 'eager',
      aliasSegments: ['by-id', 'by-title'],
      writebackResources: [
        { path: 'github/repos/*/*/pulls/reviews', schemaId: 'github/pull-request-review' },
      ],
    },
  ],
};
