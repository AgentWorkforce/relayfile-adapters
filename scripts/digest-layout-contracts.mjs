#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const packagesDir = join(root, 'packages');

const nonProviderPackages = new Set(['core', 'webhook-server']);
const appendOnlyLifecycleProviders = new Set(['segment']);

const categoryResourceContracts = [
  {
    category: 'issue-tracking',
    provider: 'github',
    resource: 'github/repos/*/*/issues',
    aliases: ['by-state', 'by-assignee', 'by-creator', 'by-priority'],
  },
  {
    category: 'issue-tracking',
    provider: 'github',
    resource: 'github/repos/*/*/pulls',
    aliases: ['by-state', 'by-assignee', 'by-creator', 'by-priority'],
  },
  {
    category: 'issue-tracking',
    provider: 'gitlab',
    resource: 'gitlab/projects/**/issues',
    aliases: ['by-state', 'by-assignee', 'by-creator', 'by-priority'],
  },
  {
    category: 'issue-tracking',
    provider: 'gitlab',
    resource: 'gitlab/projects/**/merge_requests',
    aliases: ['by-state', 'by-assignee', 'by-creator', 'by-priority'],
  },
  {
    category: 'issue-tracking',
    provider: 'jira',
    resource: 'jira/issues',
    aliases: ['by-state', 'by-assignee', 'by-creator', 'by-priority'],
  },
  {
    category: 'issue-tracking',
    provider: 'linear',
    resource: 'linear/issues',
    aliases: ['by-state', 'by-assignee', 'by-creator', 'by-priority'],
  },
  {
    category: 'task-management',
    provider: 'asana',
    resource: 'asana/tasks',
    aliases: ['by-state', 'by-assignee', 'by-creator', 'by-priority'],
  },
  {
    category: 'task-management',
    provider: 'clickup',
    resource: 'clickup/tasks',
    aliases: ['by-state', 'by-assignee', 'by-creator', 'by-priority'],
  },
  {
    category: 'ci-deploy',
    provider: 'gitlab',
    resource: 'gitlab/projects/**/pipelines',
    aliases: ['by-status'],
  },
  {
    category: 'ci-deploy',
    provider: 'gitlab',
    resource: 'gitlab/projects/**/deployments',
    aliases: ['by-status'],
  },
  {
    category: 'knowledge',
    provider: 'confluence',
    resource: 'confluence/pages',
    aliases: ['by-state'],
  },
];

const requiredDocs = [
  {
    file: 'AGENTS.md',
    needles: ['Relayfile Integration Digest Contract', 'test:digest-contracts', 'category matrix', 'materialized canonical mirror'],
  },
  {
    file: '.claude/rules/relayfile-integration-digests.md',
    needles: ['category matrix', 'test:digest-contracts'],
  },
  {
    file: '.claude/rules/alias-subtrees.md',
    needles: ['by-state', 'by-assignee', 'by-creator', 'by-priority', 'category matrix', 'Materialized canonical mirror'],
  },
  {
    file: 'docs/digest-layout-contract.md',
    needles: ['issue-tracking', 'by-state', 'by-assignee', 'by-creator', 'by-priority', 'test:digest-contracts'],
  },
];

const executableRegressionContracts = [
  {
    provider: 'jira',
    file: 'src/digest.test.ts',
    needles: ['jiraIssuePath(', 'release-plan__ENG-42'],
    label: 'digest tests must use the real <slug>__<id> path mapper output',
  },
  {
    provider: 'jira',
    file: 'src/__tests__/emit-auxiliary-files.test.ts',
    needles: ['jiraIssueByTitleAliasPath', 'jiraProjectByTitleAliasPath', 'jiraSprintByTitleAliasPath'],
    label: 'layout-advertised by-title aliases must be emitted and reconciled',
  },
  {
    provider: 'jira',
    file: 'src/layout.ts',
    needles: ['by-key'],
    label: 'layout manifest must advertise emitted Jira by-key aliases',
  },
  {
    provider: 'gitlab',
    file: 'test/emit-auxiliary-files.test.ts',
    needles: ['moves pipeline and deployment by-status aliases on status transitions', 'by-status/running', 'by-status/failed'],
    label: 'ci/deploy by-status aliases must reconcile on transitions',
  },
  {
    provider: 'gitlab',
    file: 'test/emit-auxiliary-delete.test.ts',
    needles: ['GitLab commit tombstones delete canonical and title aliases', 'by-title/ship-fix__abc123'],
    label: 'commit tombstones must delete canonical and alias files',
  },
  {
    provider: 'jira',
    file: 'src/__tests__/webhook-normalizer.test.ts',
    needles: ['classifies canceled issue status transitions as completed events', 'Cancelled'],
    label: 'canceled terminal webhook states must normalize to completed events',
  },
  {
    provider: 'github',
    file: 'src/digest.test.ts',
    needles: ['path-only Relayfile change events', "path: '/github/repos/acme/api/issues/46__path-only/meta.json'"],
    label: 'digest tests must cover path-only Relayfile events',
  },
  {
    provider: 'github',
    file: 'src/__tests__/emit-auxiliary-files.test.ts',
    needles: ['index-only bare PR tombstone', 'githubByAssigneeAliasPath', 'githubByPriorityAliasPath'],
    label: 'bare tombstone recovery must delete aliases even when the by-id alias is missing',
  },
  {
    provider: 'linear',
    file: 'src/layout.ts',
    needles: ['by-uuid'],
    label: 'layout manifest must advertise emitted Linear by-uuid aliases',
  },
  {
    provider: 'asana',
    file: 'src/__tests__/emit-auxiliary-files.test.ts',
    needles: ['asanaTaskByStatePath', 'asanaTaskByAssigneePath', 'asanaTaskByCreatorPath', 'asanaTaskByPriorityPath'],
    label: 'task-management aliases must be materially emitted and reconciled',
  },
  {
    provider: 'clickup',
    file: 'src/__tests__/emit-auxiliary-files.test.ts',
    needles: ['clickUpTaskByStatePath', 'clickUpTaskByAssigneePath', 'clickUpTaskByCreatorPath', 'clickUpTaskByPriorityPath'],
    label: 'task-management aliases must be materially emitted and reconciled',
  },
  {
    provider: 'notion',
    file: 'src/layout.ts',
    needles: ['by-database', 'by-parent'],
    label: 'layout manifest must advertise emitted Notion relationship aliases',
  },
  {
    provider: 'confluence',
    file: 'src/layout.ts',
    needles: ['by-space', 'by-parent', 'by-key'],
    label: 'layout manifest must advertise emitted Confluence relationship aliases',
  },
];

const failures = [];

for (const provider of providerPackages()) {
  const packageRoot = join(packagesDir, provider);
  const digestPath = join(packageRoot, 'src', 'digest.ts');
  const indexPath = join(packageRoot, 'src', 'index.ts');
  const digestTestPaths = [
    join(packageRoot, 'src', 'digest.test.ts'),
    join(packageRoot, 'src', '__tests__', 'digest.test.ts'),
    join(packageRoot, 'test', 'digest.test.ts'),
  ].filter(existsSync);

  if (!existsSync(digestPath)) {
    failures.push(`${provider}: missing src/digest.ts`);
    continue;
  }

  const digestSource = readFileSync(digestPath, 'utf8');
  if (!/ctx\.changeEvents\s*\(\s*\{\s*providers\s*:\s*\[\s*ctx\.provider\s*\]\s*\}\s*\)/u.test(digestSource)) {
    failures.push(`${provider}: digest must scope ctx.changeEvents to ctx.provider`);
  }
  if (!digestSource.includes('event.path') || !digestSource.includes('digestEventPath')) {
    failures.push(`${provider}: digest must accept path-only Relayfile change events, not only canonicalPath`);
  }
  if (
    digestSource.includes(`startsWith('/${provider}/')`)
    && !digestSource.includes(`event.canonicalPath === '/${provider}'`)
    && !digestSource.includes(`canonicalPath === '/${provider}'`)
    && !digestSource.includes(`digestEventPath(event) === '/${provider}'`)
  ) {
    failures.push(`${provider}: digest canonical-path filter must accept exact /${provider}`);
  }
  const pathMapperPath = join(packageRoot, 'src', 'path-mapper.ts');
  if (existsSync(pathMapperPath)) {
    for (const actualRoot of relayfileRoots(readFileSync(pathMapperPath, 'utf8'))) {
      const root = actualRoot.replace(/^\/+/u, '');
      if (!digestAcceptsExactRoot(digestSource, root)) {
        failures.push(`${provider}: digest canonical-path filter must accept actual Relayfile root ${actualRoot}`);
      }
      if (!digestAcceptsRootChildren(digestSource, root)) {
        failures.push(`${provider}: digest canonical-path filter must accept children under actual Relayfile root ${actualRoot}`);
      }
    }
  }

  if (!existsSync(indexPath) || !readFileSync(indexPath, 'utf8').includes("from './digest.js'")) {
    failures.push(`${provider}: package barrel must export src/digest.ts`);
  }

  if (digestTestPaths.length === 0) {
    failures.push(`${provider}: missing digest test`);
    continue;
  }

  const testSource = digestTestPaths.map((path) => readFileSync(path, 'utf8')).join('\n');
  assertTestMentions(provider, testSource, /deterministic|sorted/i, 'deterministic sorting');
  assertTestMentions(provider, testSource, /empty/i, 'empty-window behavior');
  assertTestMentions(
    provider,
    testSource,
    /create|created|update|updated|upsert|upserted|upload|uploaded|insert|inserted|set|sent|received/i,
    'create/update classification',
  );
  if (appendOnlyLifecycleProviders.has(provider)) {
    assertTestMentions(provider, digestSource, /append-only|immutable/i, 'documented append-only lifecycle exception');
    assertTestMentions(provider, testSource, /upsert|upserted/i, 'append-only upsert classification');
  } else {
    assertTestMentions(
      provider,
      testSource,
      /delete|deleted|remove|removed|closed|merged|archiv|completed|canceled|cancelled|resolved|solved|trashed|locked|failed|succeeded|refunded|voided|expired|truncate/i,
      'provider lifecycle classification',
    );
  }
}

for (const contract of categoryResourceContracts) {
  const layoutPath = join(packagesDir, contract.provider, 'src', 'layout.ts');
  if (!existsSync(layoutPath)) {
    failures.push(`${contract.provider}: ${contract.category} contract requires src/layout.ts`);
    continue;
  }

  const layoutSource = readFileSync(layoutPath, 'utf8');
  const aliases = aliasesForResource(layoutSource, contract.resource);
  if (!aliases) {
    failures.push(`${contract.provider}: layout missing resource ${contract.resource}`);
    continue;
  }

  for (const alias of contract.aliases) {
    if (!aliases.includes(alias)) {
      failures.push(`${contract.provider}: ${contract.resource} missing ${alias} for ${contract.category}`);
    }
  }
}

verifyGithubRepoLayoutDoesNotAdvertiseMissingAliases();

for (const contract of executableRegressionContracts) {
  const testPath = join(packagesDir, contract.provider, contract.file);
  if (!existsSync(testPath)) {
    failures.push(`${contract.provider}: missing executable regression contract ${contract.file}`);
    continue;
  }
  const source = readFileSync(testPath, 'utf8');
  for (const needle of contract.needles) {
    if (!source.includes(needle)) {
      failures.push(`${contract.provider}: ${contract.label} (missing "${needle}" in ${contract.file})`);
    }
  }
}

for (const doc of requiredDocs) {
  const docPath = join(root, doc.file);
  if (!existsSync(docPath)) {
    failures.push(`missing required digest contract doc ${doc.file}`);
    continue;
  }
  const source = readFileSync(docPath, 'utf8');
  for (const needle of doc.needles) {
    if (!source.includes(needle)) {
      failures.push(`${doc.file}: missing "${needle}"`);
    }
  }
}

if (failures.length > 0) {
  console.error('Digest/layout contract check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Verified digest contracts for ${providerPackages().length} provider packages.`);
console.log(`Verified ${categoryResourceContracts.length} category resource contracts.`);
console.log(`Verified ${executableRegressionContracts.length} executable regression contracts.`);

function providerPackages() {
  return readdirSync(packagesDir)
    .filter((name) => existsSync(join(packagesDir, name, 'package.json')))
    .filter((name) => !nonProviderPackages.has(name))
    .sort();
}

function assertTestMentions(provider, source, pattern, label) {
  if (!pattern.test(source)) {
    failures.push(`${provider}: digest test must cover ${label}`);
  }
}

function relayfileRoots(pathMapperSource) {
  const roots = new Set();
  for (const match of pathMapperSource.matchAll(/(?:export\s+)?const\s+[A-Z0-9_]*(?:ROOT|PATH_ROOT|RELAYFILE_ROOT|DEFAULT_ROOT)\s*=\s*['"](\/[a-z0-9-]+)['"]/gu)) {
    roots.add(match[1]);
  }
  return [...roots].sort();
}

function digestAcceptsExactRoot(digestSource, root) {
  return (
    digestSource.includes(`event.canonicalPath === '${root}'`)
    || digestSource.includes(`event.canonicalPath === "${root}"`)
    || digestSource.includes(`event.canonicalPath === "/${root}"`)
    || digestSource.includes(`event.canonicalPath === '/${root}'`)
    || digestSource.includes(`canonicalPath === '${root}'`)
    || digestSource.includes(`canonicalPath === "${root}"`)
    || digestSource.includes(`canonicalPath === "/${root}"`)
    || digestSource.includes(`canonicalPath === '/${root}'`)
    || digestSource.includes(`digestEventPath(event) === '${root}'`)
    || digestSource.includes(`digestEventPath(event) === "${root}"`)
    || digestSource.includes(`digestEventPath(event) === "/${root}"`)
    || digestSource.includes(`digestEventPath(event) === '/${root}'`)
  );
}

function verifyGithubRepoLayoutDoesNotAdvertiseMissingAliases() {
  const layoutPath = join(packagesDir, 'github', 'src', 'layout.ts');
  const emitterPath = join(packagesDir, 'github', 'src', 'emit-auxiliary-files.ts');
  if (!existsSync(layoutPath) || !existsSync(emitterPath)) {
    return;
  }
  const layoutSource = readFileSync(layoutPath, 'utf8');
  const emitterSource = readFileSync(emitterPath, 'utf8');
  const repoResourceAdvertisesByName =
    /path:\s*['"]github\/repos['"][\s\S]*?aliasSegments:\s*\[[^\]]*['"]by-name['"]/u.test(layoutSource);
  const repoEmitterWritesByName =
    /githubRepo(?:sitory)?ByName|repos\/by-name|by-name/u.test(emitterSource);
  if (repoResourceAdvertisesByName && !repoEmitterWritesByName) {
    failures.push('github: layout advertises github/repos by-name but repository emitter does not materialize a by-name alias');
  }
}

function digestAcceptsRootChildren(digestSource, root) {
  return (
    digestSource.includes(`startsWith('${root}/')`)
    || digestSource.includes(`startsWith("${root}/")`)
    || digestSource.includes(`startsWith('/${root}/')`)
    || digestSource.includes(`startsWith("/${root}/")`)
  );
}

function aliasesForResource(layoutSource, resourcePath) {
  const resourceIndex = layoutSource.indexOf(`path: '${resourcePath}'`);
  if (resourceIndex < 0) return null;
  const nextResourceIndex = layoutSource.indexOf('path:', resourceIndex + 1);
  const resourceEnd = nextResourceIndex < 0 ? layoutSource.length : nextResourceIndex;
  const aliasIndex = layoutSource.indexOf('aliasSegments:', resourceIndex);
  if (aliasIndex < 0 || aliasIndex >= resourceEnd) return null;
  const aliasMatch = layoutSource.slice(aliasIndex, resourceEnd).match(/aliasSegments:\s*\[([^\]]*)\]/u);
  if (!aliasMatch) return null;
  return Array.from(aliasMatch[1].matchAll(/'([^']+)'/gu), (match) => match[1]);
}
