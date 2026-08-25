import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildRepoIndexFile,
  buildRepoIssuesIndexFile,
  buildRepoPullsIndexFile,
  normalizeRecordIndexRows,
  normalizeRepoIndexRows,
  parseIndexRows,
  type GitHubRecordIndexRow,
} from '../index-emitter.js';
import { GITHUB_LAYOUT_PROMPT } from '../layout-prompt.js';

/** Run `fn` with `console.warn` captured, returning everything it emitted. */
function captureWarnings<T>(fn: () => T): { result: T; warnings: string[] } {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((arg) => String(arg)).join(' '));
  };
  try {
    return { result: fn(), warnings };
  } finally {
    console.warn = original;
  }
}

const PULLS_INDEX_PATH = '/github/repos/octocat/hello-world/pulls/_index.json';

describe('_index.json shape contract (issue #271)', () => {
  it('every canonical index builder emits a bare top-level array', () => {
    const row: GitHubRecordIndexRow = {
      id: '42',
      title: 'a pull',
      updated: '2026-05-02T00:00:00Z',
      number: 42,
      state: 'open',
    };

    for (const built of [
      buildRepoPullsIndexFile('octocat', 'hello-world', [row]),
      buildRepoIssuesIndexFile('octocat', 'hello-world', [row]),
      buildRepoIndexFile([{ id: 'octocat/hello-world', title: 'octocat/hello-world', updated: '' }]),
    ]) {
      const parsed = JSON.parse(built.content) as unknown;
      assert.ok(
        Array.isArray(parsed),
        `${built.path} must serialize as a top-level array, got ${typeof parsed}`,
      );
    }
  });

  it('parses the documented top-level array without warning', () => {
    const content = buildRepoPullsIndexFile('octocat', 'hello-world', [
      { id: '42', title: 'a pull', updated: '2026-05-02T00:00:00Z', number: 42, state: 'open' },
    ]).content;

    const { result, warnings } = captureWarnings(() =>
      parseIndexRows<GitHubRecordIndexRow>(content, { path: PULLS_INDEX_PATH }),
    );

    assert.equal(result.length, 1);
    assert.equal(result[0]?.number, 42);
    assert.deepEqual(warnings, []);
  });

  it('still reads a legacy `{ "pulls": [...] }` index and says so', () => {
    // The shape the eager backfill wrote before this fix. An already-ingested
    // mount can still hold it, so the reader must recover the rows.
    const legacy = JSON.stringify({
      pulls: [{ number: 42, title: 'a pull', state: 'open', url: 'https://example.test/42' }],
    });

    const { result, warnings } = captureWarnings(() =>
      normalizeRecordIndexRows(parseIndexRows<unknown>(legacy, { path: PULLS_INDEX_PATH })),
    );

    assert.equal(result.length, 1, 'legacy wrapped rows must still be readable');
    assert.equal(result[0]?.number, 42);
    assert.equal(result[0]?.id, '42', 'a legacy row has no `id`; it is derived from `number`');
    assert.equal(result[0]?.updated, '', 'a legacy row has no `updated`; it must not be undefined');
    assert.equal(warnings.length, 1, 'reading a legacy shape must be visible');
    assert.match(warnings[0] ?? '', /index shape mismatch/);
    assert.match(warnings[0] ?? '', /legacy/);
    assert.match(warnings[0] ?? '', /pulls\/_index\.json/);
  });

  it('still reads a legacy `{ "repos": [{ owner, repo }] }` root index and says so', () => {
    const legacy = JSON.stringify({
      repos: [{ owner: 'octocat', repo: 'hello-world', url: 'https://github.com/octocat/hello-world' }],
    });

    const { result, warnings } = captureWarnings(() =>
      normalizeRepoIndexRows(parseIndexRows<unknown>(legacy, { path: '/github/repos/_index.json' })),
    );

    assert.equal(result.length, 1);
    assert.equal(result[0]?.id, 'octocat/hello-world');
    assert.equal(result[0]?.updated, '');
    assert.equal(warnings.length, 1);
  });

  it('warns loudly when a record index turns out to be an alias directory manifest', () => {
    const manifest = JSON.stringify({
      rows: [
        { title: 'by-id', file: 'by-id/' },
        { title: 'by-title', file: 'by-title/' },
      ],
    });

    const { result, warnings } = captureWarnings(() =>
      parseIndexRows<GitHubRecordIndexRow>(manifest, { path: PULLS_INDEX_PATH }),
    );

    assert.deepEqual(result, [], 'a manifest carries no records; behaviour must still fail closed');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? '', /alias directory manifest/);
  });

  it('warns on malformed JSON and on an unrecognised object, and still falls back to empty', () => {
    for (const [content, expected] of [
      ['{not json', /not valid JSON/],
      [JSON.stringify({ unexpected: 'shape' }), /neither the documented top-level array/],
    ] as const) {
      const { result, warnings } = captureWarnings(() =>
        parseIndexRows<GitHubRecordIndexRow>(content, { path: PULLS_INDEX_PATH }),
      );
      assert.deepEqual(result, []);
      assert.equal(warnings.length, 1);
      assert.match(warnings[0] ?? '', expected);
    }
  });

  it('does not warn on a missing or empty index — that is not a shape mismatch', () => {
    const { warnings } = captureWarnings(() => {
      parseIndexRows<GitHubRecordIndexRow>(undefined, { path: PULLS_INDEX_PATH });
      parseIndexRows<GitHubRecordIndexRow>('', { path: PULLS_INDEX_PATH });
      parseIndexRows<GitHubRecordIndexRow>('[]', { path: PULLS_INDEX_PATH });
    });
    assert.deepEqual(warnings, []);
  });

  it('sorts rows recovered from a legacy index without throwing on missing fields', () => {
    const legacy = JSON.stringify({
      pulls: [
        { number: 7, title: 'seven', state: 'open' },
        { number: 3, title: 'three', state: 'closed' },
      ],
    });

    const rows = captureWarnings(() =>
      normalizeRecordIndexRows(parseIndexRows<unknown>(legacy, { path: PULLS_INDEX_PATH })),
    ).result;

    // Sorting happens inside the builder; before normalization these rows had
    // no `updated` and no `id`, which made the comparator throw.
    const content = buildRepoPullsIndexFile('octocat', 'hello-world', rows).content;
    assert.deepEqual(
      (JSON.parse(content) as GitHubRecordIndexRow[]).map((row) => row.number),
      [3, 7],
    );
  });

  it('documents headRef as present on pull rows and absent on issue rows', () => {
    assert.match(GITHUB_LAYOUT_PROMPT, /headRef/);
    assert.match(
      GITHUB_LAYOUT_PROMPT,
      /present on pull rows and absent on issue rows/,
      'the layout prompt must state where headRef applies',
    );
    assert.match(
      GITHUB_LAYOUT_PROMPT,
      /alias directory manifest/,
      'the layout prompt must document the alias `_index.json` collision',
    );
  });
});
