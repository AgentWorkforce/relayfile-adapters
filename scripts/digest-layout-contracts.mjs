#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
const packagesDir = join(root, 'packages');

const nonProviderPackages = new Set(['core', 'webhook-server']);
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
    needles: ['generic upstream', 'issue-tracking', 'by-state', 'by-assignee', 'by-creator', 'by-priority', 'test:digest-contracts'],
  },
];

const executableRegressionContracts = [
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

function main() {
const failures = [];

verifyNoProviderDigestHandlerContract(failures);

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

verifyGithubRepoLayoutDoesNotAdvertiseMissingAliases(failures);

for (const contract of executableRegressionContracts) {
  const testPath = join(packagesDir, contract.provider, contract.file);
  if (!existsSync(testPath)) {
    failures.push(`${contract.provider}: missing executable regression contract ${contract.file}`);
    continue;
  }
  const source = readFileSync(testPath, 'utf8');
  if (contract.file.endsWith('.test.ts')) {
    if (!activeRegressionContractSatisfied(source, contract.needles)) {
      failures.push(`${contract.provider}: ${contract.label} (${contract.file} must cover all required evidence in a live assertion test)`);
    }
    continue;
  }
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

console.log('Verified adapter metadata/layout contracts do not require provider digest handlers.');
console.log(`Verified ${categoryResourceContracts.length} category resource contracts.`);
console.log(`Verified ${executableRegressionContracts.length} executable regression contracts.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

function providerPackages() {
  return readdirSync(packagesDir)
    .filter((name) => existsSync(join(packagesDir, name, 'package.json')))
    .filter((name) => !nonProviderPackages.has(name))
    .sort();
}

export function activeRegressionContractSatisfied(source, needles) {
  return activeTestBlocks(source).some((block) => (
    hasAssertion(block) && needles.every((needle) => block.includes(needle))
  ));
}

export function activeTestHasAssertion(source, pattern) {
  return activeTestBlocks(source).some((block) => pattern.test(block) && hasAssertion(block));
}

function activeTestBlocks(source) {
  const blocks = [];
  const callPattern = /(?:^|[^\w.])(test|it)\s*\(/gu;
  let match;
  while ((match = callPattern.exec(source)) !== null) {
    const keyword = match[1];
    const keywordIndex = keyword ? source.indexOf(keyword, match.index) : match.index;
    const openParen = source.indexOf('(', keywordIndex + (keyword?.length ?? 0));
    const closeParen = findMatchingParen(source, openParen);
    if (closeParen > openParen) {
      blocks.push(stripComments(source.slice(keywordIndex, closeParen + 1)));
      callPattern.lastIndex = closeParen + 1;
    }
  }
  return blocks;
}

function hasAssertion(block) {
  return /(?:^|[^\w.])assert\.(?:deepEqual|equal|match|ok|rejects|throws|notEqual|notDeepEqual)\s*\(/u.test(block);
}

function stripComments(source) {
  let output = '';
  let i = 0;
  let quote = null;
  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1];
    if (quote) {
      output += char;
      if (char === '\\') {
        output += next ?? '';
        i += 2;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      i += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      output += char;
      i += 1;
      continue;
    }
    if (char === '/' && next === '/' && source[i - 1] !== '\\') {
      while (i < source.length && source[i] !== '\n') {
        output += ' ';
        i += 1;
      }
      continue;
    }
    if (char === '/' && next === '*' && source[i - 1] !== '\\') {
      output += '  ';
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        output += source[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      output += '  ';
      i += 2;
      continue;
    }
    output += char;
    i += 1;
  }
  return output;
}

function findMatchingParen(source, openParen) {
  let depth = 0;
  let quote = null;
  for (let i = openParen; i < source.length; i += 1) {
    const char = source[i];
    if (quote) {
      if (char === '\\') {
        i += 1;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '/' && source[i + 1] === '/' && source[i - 1] !== '\\') {
      i += 1;
      while (i < source.length && source[i] !== '\n') {
        i += 1;
      }
      continue;
    }
    if (char === '/' && source[i + 1] === '*' && source[i - 1] !== '\\') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        i += 1;
      }
      i += 1;
      continue;
    }
    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

function verifyGithubRepoLayoutDoesNotAdvertiseMissingAliases(failures) {
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

function verifyNoProviderDigestHandlerContract(failures) {
  const source = readFileSync(new URL(import.meta.url), 'utf8');
  const forbiddenNeedles = [
    ['missing src/', 'digest', '.ts'],
    ['package barrel must export src/', 'digest', '.ts'],
    ['missing ', 'digest', ' test'],
    ['Digest', 'Section'],
    ['ctx', '.changeEvents'],
  ].map((parts) => parts.join(''));

  for (const needle of forbiddenNeedles) {
    if (source.includes(needle)) {
      failures.push(`digest/layout contract script still contains stale provider digest requirement: ${needle}`);
    }
  }
}
