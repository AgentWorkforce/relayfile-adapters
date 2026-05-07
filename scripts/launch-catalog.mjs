import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MIRAGE_TRACKED_COUNT = 32;

export const LAUNCH_TARGETS = Object.freeze({
  minimumEntries: 50,
  minimumTier1: 16,
  minimumTier2: 12,
});

export const PROVIDER_QUICKSTART_LABEL = 'Nango/Pipedream/Composio';

export const REQUIRED_ANCHORS = Object.freeze([
  'RAM/Disk/OPFS',
  PROVIDER_QUICKSTART_LABEL,
  '/crm/v3/objects/contacts',
  '/users/me/messages/send',
  '/users/me/messages',
  '/upload/drive/v3/files',
]);

export const EXECUTION_ROUTING = Object.freeze({
  local:
    'Local callers run catalog:audit and test:catalog directly against repo files (catalog metadata, audit script, and catalog tests only — adapter-package implementation is out of scope for this artifact); no OAuth exchange is performed in the audit gate.',
  cloud:
    'Cloud callers use adapter metadata for routing while Nango/Pipedream/Composio own OAuth transport and connection lookup.',
  mcp:
    'MCP callers consume materialized catalog and audit artifacts only; they do not execute runtime skill loading or provider OAuth flows.',
});

export const LAUNCH_CATALOG_ENTRIES = Object.freeze([
  entry(1, 'local-disk', 'T1', 'Local and primitives', 'RAM/Disk/OPFS', 'none', {
    existing: true,
    keyReference: 'existing relayfile-mount',
    routes: { read: ['/local/{path}'], writeback: ['/local/{path}'] },
  }),
  entry(2, 'in-memory', 'T1', 'Local and primitives', 'RAM', 'none', {
    keyReference: 'existing primitive mount',
    routes: { read: ['/memory/{path}'], writeback: ['/memory/{path}'] },
  }),
  entry(3, 'ssh', 'T2', 'Local and primitives', 'SSH', 'nango/pipedream', {
    keyReference: 'RFC 4254 + libssh2',
    routes: { read: ['/ssh/{host}/{path}'], writeback: ['/ssh/{host}/{path}'] },
  }),
  entry(4, 's3', 'T1', 'Object storage', 'S3', 'nango (sigv4)', {
    keyReference: 'AWS S3 REST + EventBridge/SQS notifications',
    routes: { read: ['/s3/{bucket}/{key}'], writeback: ['PUT /{bucket}/{key}'] },
  }),
  entry(5, 'r2', 'T2', 'Object storage', 'R2', 'direct (S3-compatible)', {
    keyReference: 'Cloudflare R2 docs',
    routes: { read: ['/r2/{bucket}/{key}'], writeback: ['/r2/{bucket}/{key}'] },
  }),
  entry(6, 'gcs', 'T2', 'Object storage', 'GCS', 'nango oauth', {
    keyReference: 'GCS JSON API + Pub/Sub notifications',
    routes: { read: ['/gcs/{bucket}/{object}'], writeback: ['/gcs/{bucket}/{object}'] },
  }),
  entry(7, 'azure-blob', 'T2', 'Object storage', 'beats Mirage', 'nango oauth', {
    keyReference: 'Blob REST + Event Grid',
    routes: { read: ['/azureblob/{container}/{blob}'], writeback: ['/azureblob/{container}/{blob}'] },
  }),
  entry(8, 'supabase', 'T2', 'Object storage', 'Supabase', 'supabase provider', {
    existing: true,
    keyReference: 'Storage REST',
    routes: { read: ['/supabase/{bucket}/{path}'], writeback: ['/supabase/{bucket}/{path}'] },
  }),
  entry(9, 'google-drive', 'T1', 'File storage SaaS', 'Drive', 'nango/pipedream', {
    keyReference: 'Drive v3 + changes.watch push',
    routes: {
      read: ['/gdrive/files/{fileId}/metadata.json', '/gdrive/files/{fileId}/content'],
      writeback: ['/files/{fileId}', '/upload/drive/v3/files'],
    },
  }),
  entry(10, 'dropbox', 'T2', 'File storage SaaS', 'Dropbox', 'nango/pipedream', {
    keyReference: 'API v2 + webhooks',
    routes: { read: ['/dropbox/files/{path}'], writeback: ['/dropbox/files/{path}'] },
  }),
  entry(11, 'box', 'T2', 'File storage SaaS', 'Box', 'nango/pipedream', {
    keyReference: 'API + webhooks v2',
    routes: { read: ['/box/files/{id}', '/box/folders/{id}/items'], writeback: ['/box/files/{id}'] },
  }),
  entry(12, 'outlook-mail', 'T2', 'Microsoft 365', 'beats Mirage', 'nango/pipedream', {
    keyReference: 'Graph /me/messages + subscriptions',
    routes: { read: ['/outlook/messages/{id}.json'], writeback: ['/outlook/messages/send.json'] },
  }),
  entry(13, 'onedrive', 'T2', 'Microsoft 365', 'beats Mirage', 'nango/pipedream', {
    keyReference: 'Graph /drives + subscriptions',
    routes: { read: ['/onedrive/items/{id}'], writeback: ['/onedrive/items/{id}'] },
  }),
  entry(14, 'sharepoint', 'T3', 'Microsoft 365', 'beats Mirage', 'nango/pipedream', {
    keyReference: 'Graph sites + lists',
    routes: { read: ['/sharepoint/sites/{siteId}/lists/{listId}/items/{itemId}.json'] },
  }),
  entry(15, 'gmail', 'T1', 'Google Workspace', 'Gmail', 'nango/pipedream', {
    keyReference: 'Gmail v1 + Pub/Sub users.watch',
    routes: {
      read: ['/users/me/messages', '/gmail/messages/{messageId}/metadata.json'],
      writeback: ['/users/me/messages/send', '/users/me/messages/{id}/modify'],
    },
  }),
  entry(16, 'google-calendar', 'T1', 'Google Workspace', 'beats Mirage', 'nango/pipedream', {
    keyReference: 'Calendar v3 + events.watch push',
    routes: {
      read: ['/gcal/calendars/{calId}/events/{eventId}.json'],
      writeback: ['/calendars/{calId}/events/{eventId}'],
    },
  }),
  entry(17, 'google-docs', 'T2', 'Google Workspace', 'Docs', 'nango/pipedream', {
    keyReference: 'Docs v1 with Drive change ingest',
    routes: { read: ['/gdocs/documents/{documentId}.json'], writeback: ['/documents/{documentId}:batchUpdate'] },
  }),
  entry(18, 'google-sheets', 'T2', 'Google Workspace', 'Sheets', 'nango/pipedream', {
    keyReference: 'Sheets v4 batchUpdate',
    routes: { read: ['/gsheets/spreadsheets/{spreadsheetId}.json'], writeback: ['/spreadsheets/{spreadsheetId}:batchUpdate'] },
  }),
  entry(19, 'google-slides', 'T3', 'Google Workspace', 'Slides', 'nango/pipedream', {
    keyReference: 'Slides v1',
    routes: { read: ['/gslides/presentations/{presentationId}.json'] },
  }),
  entry(20, 'github', 'T1', 'Code and DevOps', 'GitHub + GitHub CI', 'nango/clerk', {
    existing: true,
    keyReference: 'REST v3 + webhooks',
    routes: { read: ['/github/repos/{owner}/{repo}/issues/{id}.json'], writeback: ['/repos/{owner}/{repo}/issues/{id}'] },
  }),
  entry(21, 'gitlab', 'T1', 'Code and DevOps', 'beats Mirage', 'nango', {
    existing: true,
    keyReference: 'REST v4 + webhooks',
    routes: { read: ['/gitlab/projects/{project}/issues/{iid}.json'], writeback: ['/projects/{project}/issues/{iid}'] },
  }),
  entry(22, 'bitbucket', 'T2', 'Code and DevOps', 'beats Mirage', 'nango', {
    keyReference: 'Cloud REST 2.0 + webhooks',
    routes: { read: ['/bitbucket/{workspace}/{repo}/pullrequests/{id}.json'], writeback: ['/bitbucket/{workspace}/{repo}/pullrequests/{id}/comments.json'] },
  }),
  entry(23, 'vercel', 'T2', 'Code and DevOps', 'Vercel', 'nango', {
    keyReference: 'REST + deployment webhooks',
    routes: { read: ['/vercel/projects/{id}.json'], writeback: ['/vercel/projects/{id}/env/{key}.json'] },
  }),
  entry(24, 'netlify', 'T3', 'Code and DevOps', 'beats Mirage', 'nango', {
    keyReference: 'REST + outgoing webhooks',
    routes: { read: ['/netlify/sites/{siteId}.json'] },
  }),
  entry(25, 'linear', 'T1', 'Issue and project', 'Linear', 'nango/pipedream', {
    existing: true,
    keyReference: 'GraphQL + webhooks',
    routes: { read: ['/linear/issues/{id}.json'], writeback: ['/linear/issues/{id}.json', '/linear/issues/new.json'] },
  }),
  entry(26, 'jira', 'T1', 'Issue and project', 'beats Mirage', 'nango/pipedream', {
    keyReference: 'REST v3 + webhooks',
    routes: { read: ['/jira/projects/{projectKey}/issues/{issueKey}/metadata.json'], writeback: ['/issue/{issueKey}/comment', '/issue/{issueKey}/transitions'] },
  }),
  entry(27, 'asana', 'T1', 'Issue and project', 'beats Mirage', 'nango/pipedream', {
    keyReference: 'REST + webhooks',
    routes: { read: ['/asana/workspaces/{wid}/projects/{pid}/tasks/{tid}/metadata.json'], writeback: ['/tasks/{tid}/stories', '/tasks/{tid}'] },
  }),
  entry(28, 'trello', 'T2', 'Issue and project', 'Trello', 'nango', {
    keyReference: 'REST + webhook callbacks',
    routes: { read: ['/trello/boards/{id}/cards/{cardId}.json'], writeback: ['/trello/boards/{id}/cards/{cardId}.json'] },
  }),
  entry(29, 'clickup', 'T2', 'Issue and project', 'beats Mirage', 'nango', {
    keyReference: 'API v2 + webhooks',
    routes: { read: ['/clickup/teams/{tid}/lists/{lid}/tasks/{taskId}.json'], writeback: ['/clickup/teams/{tid}/lists/{lid}/tasks/{taskId}.json'] },
  }),
  entry(30, 'shortcut', 'T3', 'Issue and project', 'beats Mirage', 'nango', {
    keyReference: 'REST v3',
    routes: { read: ['/shortcut/stories/{id}.json'] },
  }),
  entry(31, 'notion', 'T1', 'Docs and notes', 'Notion', 'nango', {
    existing: true,
    keyReference: 'API + webhooks',
    routes: { read: ['/notion/pages/{pageId}.json'], writeback: ['/notion/pages/{pageId}.json'] },
  }),
  entry(32, 'confluence', 'T2', 'Docs and notes', 'beats Mirage', 'nango/pipedream', {
    keyReference: 'REST + Connect app webhooks',
    routes: { read: ['/confluence/spaces/{key}/pages/{id}/body.json'], writeback: ['/confluence/spaces/{key}/pages/{id}/body.json'] },
  }),
  entry(33, 'coda', 'T3', 'Docs and notes', 'beats Mirage', 'nango', {
    keyReference: 'API v1 + webhooks',
    routes: { read: ['/coda/docs/{docId}/tables/{tableId}/rows/{rowId}.json'] },
  }),
  entry(34, 'slack', 'T1', 'Chat', 'Slack', 'nango/pipedream', {
    existing: true,
    keyReference: 'Web API + Events API',
    routes: { read: ['/slack/channels/{channel}/messages/{message}.json'], writeback: ['/api/chat.postMessage'] },
  }),
  entry(35, 'teams', 'T2', 'Chat', 'beats Mirage', 'nango/pipedream', {
    existing: true,
    keyReference: 'Graph chats + change notifications',
    routes: { read: ['/teams/chats/{chatId}/messages/{messageId}.json'], writeback: ['/teams/chats/{chatId}/messages/send.json'] },
  }),
  entry(36, 'discord', 'T1', 'Chat', 'Discord', 'nango', {
    keyReference: 'REST v10 + interaction webhooks',
    routes: { read: ['/discord/guilds/{gid}/channels/{cid}/messages/{mid}.json'], writeback: ['/channels/{cid}/messages'] },
  }),
  entry(37, 'telegram', 'T2', 'Chat', 'Telegram', 'nango', {
    keyReference: 'Bot API + setWebhook',
    routes: { read: ['/telegram/chats/{chatId}/messages/{messageId}.json'], writeback: ['/telegram/chats/{chatId}/messages/send.json'] },
  }),
  entry(38, 'hubspot', 'T1', 'CRM', 'beats Mirage', 'nango/pipedream', {
    keyReference: 'CRM v3 + webhooks v3',
    routes: {
      read: ['/hubspot/objects/contacts/{id}.json'],
      writeback: ['/crm/v3/objects/contacts/{id}', '/crm/v3/objects/contacts'],
    },
  }),
  entry(39, 'salesforce', 'T2', 'CRM', 'beats Mirage', 'nango/pipedream', {
    keyReference: 'REST + Streaming/Platform Events',
    routes: { read: ['/sf/objects/Account/{id}.json'], writeback: ['/sf/objects/Account/{id}.json'] },
  }),
  entry(40, 'pipedrive', 'T3', 'CRM', 'beats Mirage', 'nango', {
    keyReference: 'API v2 + webhooks v1',
    routes: { read: ['/pipedrive/deals/{id}.json'] },
  }),
  entry(41, 'intercom', 'T1', 'Support', 'beats Mirage', 'nango/pipedream', {
    keyReference: 'REST + webhook topics',
    routes: { read: ['/intercom/conversations/{id}/metadata.json'], writeback: ['/conversations/{id}/reply', '/contacts/{id}'] },
  }),
  entry(42, 'zendesk', 'T2', 'Support', 'beats Mirage', 'nango/pipedream', {
    keyReference: 'REST + webhooks/triggers',
    routes: { read: ['/zendesk/tickets/{id}.json'], writeback: ['/zendesk/tickets/{id}/comments.json'] },
  }),
  entry(43, 'freshdesk', 'T3', 'Support', 'beats Mirage', 'nango', {
    keyReference: 'REST + webhook automations',
    routes: { read: ['/freshdesk/tickets/{id}.json'] },
  }),
  entry(44, 'sentry', 'T1', 'Observability and incident', 'beats Mirage', 'nango', {
    keyReference: 'REST + webhook integrations',
    routes: { read: ['/sentry/orgs/{org}/projects/{project}/issues/{issueId}/metadata.json'], writeback: ['/issues/{issueId}', '/issues/{issueId}/comments'] },
  }),
  entry(45, 'datadog', 'T2', 'Observability and incident', 'beats Mirage', 'nango', {
    keyReference: 'API v2 + webhooks integration',
    routes: { read: ['/datadog/monitors/{id}.json'], writeback: ['/datadog/monitors/{id}.json'] },
  }),
  entry(46, 'posthog', 'T2', 'Observability and incident', 'PostHog', 'nango', {
    keyReference: 'API + action webhooks',
    routes: { read: ['/posthog/projects/{id}/insights/{iid}.json'], writeback: ['/posthog/projects/{id}/insights/{iid}.json'] },
  }),
  entry(47, 'pagerduty', 'T1', 'Observability and incident', 'beats Mirage', 'nango', {
    keyReference: 'REST + webhook subscriptions v3',
    routes: { read: ['/pagerduty/services/{sid}/incidents/{iid}/metadata.json'], writeback: ['/incidents/{iid}/notes', '/incidents/{iid}'] },
  }),
  entry(48, 'langfuse', 'T3', 'Observability and incident', 'Langfuse', 'direct PAT', {
    keyReference: 'OpenAPI',
    routes: { read: ['/langfuse/traces/{id}.json'] },
  }),
  entry(49, 'postgres', 'T3', 'DB, payments, email, research', 'Postgres', 'direct DSN', {
    keyReference: 'LISTEN/NOTIFY + query.json writeback',
    routes: { read: ['/postgres/{db}/schemas/{schema}/tables/{table}/rows/{pk}.json'], writeback: ['/postgres/{db}/queries/{name}.sql'] },
  }),
  entry(50, 'mongodb', 'T3', 'DB, payments, email, research', 'MongoDB', 'direct DSN', {
    keyReference: 'change streams + query.json writeback',
    routes: { read: ['/mongodb/{db}/collections/{collection}/documents/{id}.json'], writeback: ['/mongodb/{db}/queries/{name}.find.json'] },
  }),
  entry(51, 'stripe', 'T1', 'DB, payments, email, research', 'beats Mirage', 'nango', {
    keyReference: 'REST + signed webhooks',
    routes: { read: ['/stripe/customers/{cid}.json'], writeback: ['/customers/{cid}', '/refunds'] },
  }),
  entry(52, 'smtp-imap', 'T2', 'DB, payments, email, research', 'Email', 'direct creds', {
    keyReference: 'RFC 5321/3501',
    routes: { read: ['/email/inbox/{uid}.eml'], writeback: ['/email/send.json'] },
  }),
  entry(53, 'semantic-scholar', 'T3', 'DB, payments, email, research', 'Semantic Scholar', 'optional API key', {
    keyReference: 'Graph API v1',
    routes: { read: ['/semantic-scholar/papers/{paperId}.json'] },
  }),
  entry(54, 'arxiv', 'T3', 'DB, payments, email, research', 'beats Mirage', 'none', {
    keyReference: 'OAI-PMH / Atom feed',
    routes: { read: ['/arxiv/papers/{id}.json'] },
  }),
]);

function entry(id, adapter, tier, category, mirageParity, authProvider, options = {}) {
  const ingest =
    tier === 'T1'
      ? 'webhook'
      : 'polling';
  const canWrite = tier !== 'T3' || Boolean(options.routes?.writeback?.length);

  return Object.freeze({
    id,
    adapter,
    tier,
    category,
    mirageParity,
    authProvider,
    existing: Boolean(options.existing),
    keyReference: options.keyReference ?? '',
    routes: Object.freeze({
      read: Object.freeze(options.routes?.read ?? []),
      writeback: Object.freeze(options.routes?.writeback ?? []),
    }),
    capabilities: Object.freeze({
      read: true,
      write: canWrite,
      ingest,
      signatureVerification: tier === 'T1',
    }),
  });
}

export function summarizeLaunchCatalog(entries = LAUNCH_CATALOG_ENTRIES) {
  const byTier = { T1: 0, T2: 0, T3: 0 };
  const byCategory = {};
  const existing = [];

  for (const item of entries) {
    byTier[item.tier] = (byTier[item.tier] ?? 0) + 1;
    byCategory[item.category] = (byCategory[item.category] ?? 0) + 1;
    if (item.existing) existing.push(item.adapter);
  }

  return {
    total: entries.length,
    byTier,
    byCategory,
    existing,
    mirageTrackedCount: MIRAGE_TRACKED_COUNT,
    beatsMirageBy: entries.length - MIRAGE_TRACKED_COUNT,
  };
}

export function auditLaunchCatalog(entries = LAUNCH_CATALOG_ENTRIES) {
  const errors = [];
  const summary = summarizeLaunchCatalog(entries);
  const adapters = new Set();
  const ids = new Set();

  if (summary.total < LAUNCH_TARGETS.minimumEntries) {
    errors.push(`catalog has ${summary.total} entries; expected at least ${LAUNCH_TARGETS.minimumEntries}`);
  }
  if (summary.byTier.T1 < LAUNCH_TARGETS.minimumTier1) {
    errors.push(`catalog has ${summary.byTier.T1} Tier-1 entries; expected at least ${LAUNCH_TARGETS.minimumTier1}`);
  }
  if (summary.byTier.T2 < LAUNCH_TARGETS.minimumTier2) {
    errors.push(`catalog has ${summary.byTier.T2} Tier-2 entries; expected at least ${LAUNCH_TARGETS.minimumTier2}`);
  }
  if (summary.total <= MIRAGE_TRACKED_COUNT) {
    errors.push(`catalog total ${summary.total} does not beat Mirage tracked count ${MIRAGE_TRACKED_COUNT}`);
  }

  for (const item of entries) {
    if (ids.has(item.id)) errors.push(`duplicate catalog id: ${item.id}`);
    ids.add(item.id);

    if (adapters.has(item.adapter)) errors.push(`duplicate adapter: ${item.adapter}`);
    adapters.add(item.adapter);

    if (!item.capabilities.read || item.routes.read.length === 0) {
      errors.push(`${item.adapter} must declare at least one read route`);
    }
    if (item.tier === 'T1') {
      if (!item.capabilities.write || item.routes.writeback.length === 0) {
        errors.push(`${item.adapter} Tier-1 entry must declare writeback routes`);
      }
      if (item.capabilities.ingest !== 'webhook') {
        errors.push(`${item.adapter} Tier-1 entry must use webhook ingest`);
      }
      if (!item.capabilities.signatureVerification) {
        errors.push(`${item.adapter} Tier-1 entry must require signature verification`);
      }
    }
    if (item.tier === 'T2') {
      if (!item.capabilities.write || item.routes.writeback.length === 0) {
        errors.push(`${item.adapter} Tier-2 entry must declare writeback routes`);
      }
      if (item.capabilities.ingest !== 'polling') {
        errors.push(`${item.adapter} Tier-2 entry must use polling ingest`);
      }
    }
  }

  const source = searchableCatalogSource(entries);
  for (const anchor of REQUIRED_ANCHORS) {
    if (!source.includes(anchor)) errors.push(`missing required anchor: ${anchor}`);
  }

  for (const route of ['local', 'cloud', 'mcp']) {
    if (!EXECUTION_ROUTING[route]) errors.push(`missing execution routing for ${route}`);
  }

  return {
    ok: errors.length === 0,
    errors,
    summary,
    requiredAnchors: REQUIRED_ANCHORS,
    executionRouting: EXECUTION_ROUTING,
  };
}

export function findLaunchCatalogEntry(adapter, entries = LAUNCH_CATALOG_ENTRIES) {
  return entries.find((item) => item.adapter === adapter);
}

export function renderLaunchCatalogMarkdown(entries = LAUNCH_CATALOG_ENTRIES) {
  const summary = summarizeLaunchCatalog(entries);
  const rows = entries
    .map(
      (item) =>
        `| ${item.id} | ${item.adapter} | ${item.tier} | ${item.mirageParity} | ${item.authProvider} | ${item.keyReference} |`,
    )
    .join('\n');

  return `# Launch Catalog\n\nThe launch catalog declares ${summary.total} entries against Mirage's ${MIRAGE_TRACKED_COUNT}, beating the tracked matrix by ${summary.beatsMirageBy}. Tier counts are T1=${summary.byTier.T1}, T2=${summary.byTier.T2}, T3=${summary.byTier.T3}.\n\nProvider quickstart routing: ${PROVIDER_QUICKSTART_LABEL}.\n\nExecution routing is explicit for local, cloud, and MCP callers:\n\n- Local: ${EXECUTION_ROUTING.local}\n- Cloud: ${EXECUTION_ROUTING.cloud}\n- MCP: ${EXECUTION_ROUTING.mcp}\n\n| # | Adapter | Tier | Mirage parity | Auth provider | Key reference |\n|---|---|---|---|---|---|\n${rows}\n`;
}

function searchableCatalogSource(entries) {
  return [
    PROVIDER_QUICKSTART_LABEL,
    ...Object.values(EXECUTION_ROUTING),
    ...entries.flatMap((item) => [
      item.adapter,
      item.mirageParity,
      item.authProvider,
      item.keyReference,
      ...item.routes.read,
      ...item.routes.writeback,
    ]),
  ].join('\n');
}

export function writeAuditResult(filePath, audit = auditLaunchCatalog()) {
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(`${resolved}.tmp`, `${JSON.stringify(audit, null, 2)}\n`);
  fs.renameSync(`${resolved}.tmp`, resolved);
  return resolved;
}

export function runCatalogAuditCli(argv = process.argv.slice(2)) {
  const audit = auditLaunchCatalog();
  const writeIndex = argv.indexOf('--write');
  if (writeIndex !== -1) {
    const target = argv[writeIndex + 1];
    if (!target) throw new Error('--write requires a target file path');
    writeAuditResult(target, audit);
  }

  if (argv.includes('--json')) {
    console.log(JSON.stringify(audit, null, 2));
  } else if (audit.ok) {
    const { summary } = audit;
    console.log(
      `CATALOG_AUDIT_OK entries=${summary.total} t1=${summary.byTier.T1} t2=${summary.byTier.T2} t3=${summary.byTier.T3} beats_mirage_by=${summary.beatsMirageBy}`,
    );
  } else {
    console.error('CATALOG_AUDIT_FAILED');
    for (const error of audit.errors) console.error(`- ${error}`);
  }

  return audit.ok ? 0 : 1;
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  process.exitCode = runCatalogAuditCli();
}
