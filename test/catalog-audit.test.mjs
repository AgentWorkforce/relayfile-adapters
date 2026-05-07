import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EXECUTION_ROUTING,
  LAUNCH_CATALOG_ENTRIES,
  LAUNCH_TARGETS,
  MIRAGE_TRACKED_COUNT,
  REQUIRED_ANCHORS,
  auditLaunchCatalog,
  findLaunchCatalogEntry,
  renderLaunchCatalogMarkdown,
  summarizeLaunchCatalog,
} from '../scripts/launch-catalog.mjs';

test('launch catalog beats Mirage and satisfies tier floors', () => {
  const summary = summarizeLaunchCatalog();

  assert.equal(summary.total, 54);
  assert.ok(summary.total >= LAUNCH_TARGETS.minimumEntries);
  assert.ok(summary.total > MIRAGE_TRACKED_COUNT);
  assert.ok(summary.byTier.T1 >= LAUNCH_TARGETS.minimumTier1);
  assert.ok(summary.byTier.T2 >= LAUNCH_TARGETS.minimumTier2);
});

test('audit passes for the declared launch catalog', () => {
  const audit = auditLaunchCatalog();

  assert.equal(audit.ok, true, audit.errors.join('\n'));
  assert.deepEqual(audit.requiredAnchors, REQUIRED_ANCHORS);
});

test('declared target endpoints are code-backed catalog routes', () => {
  assert.ok(findLaunchCatalogEntry('local-disk').mirageParity.includes('RAM/Disk/OPFS'));
  assert.ok(findLaunchCatalogEntry('hubspot').routes.writeback.includes('/crm/v3/objects/contacts'));
  assert.ok(findLaunchCatalogEntry('gmail').routes.read.includes('/users/me/messages'));
  assert.ok(findLaunchCatalogEntry('gmail').routes.writeback.includes('/users/me/messages/send'));
  assert.ok(findLaunchCatalogEntry('google-drive').routes.writeback.includes('/upload/drive/v3/files'));
});

test('execution routing is explicit for local, cloud, and MCP callers', () => {
  assert.match(EXECUTION_ROUTING.local, /Local callers/);
  assert.match(EXECUTION_ROUTING.cloud, /Nango\/Pipedream\/Composio/);
  assert.match(EXECUTION_ROUTING.mcp, /MCP callers/);
});

test('audit rejects a catalog missing a required Gmail send route', () => {
  const broken = LAUNCH_CATALOG_ENTRIES.map((item) =>
    item.adapter === 'gmail'
      ? {
          ...item,
          routes: {
            ...item.routes,
            writeback: item.routes.writeback.filter((route) => route !== '/users/me/messages/send'),
          },
        }
      : item,
  );

  const audit = auditLaunchCatalog(broken);

  assert.equal(audit.ok, false);
  assert.ok(audit.errors.some((error) => error.includes('/users/me/messages/send')));
});

test('rendered catalog markdown carries headline counts and provider routing', () => {
  const markdown = renderLaunchCatalogMarkdown();

  assert.match(markdown, /54 entries/);
  assert.match(markdown, /Nango\/Pipedream\/Composio/);
  assert.match(markdown, /\| 38 \| hubspot \| T1 \|/);
});
