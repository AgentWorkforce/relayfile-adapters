import assert from 'node:assert/strict';
import test from 'node:test';

import { notionStandalonePagePath, withNotionNamingScope } from '../path-mapper.js';

const PAGE_A = '11111111-1111-1111-1111-111111111111';
const PAGE_B = '22222222-2222-2222-2222-222222222222';

// Two `withNotionNamingScope` invocations running concurrently with overlapping
// awaits used to share a module-level stack and therefore corrupt each other's
// dedupe state. Switching to AsyncLocalStorage isolates each chain so the
// collision-suffix logic only fires when an id repeats *within the same scope*.
test('withNotionNamingScope isolates concurrent scopes', async () => {
  const ready = { a: false, b: false };
  const results = { a: [] as string[], b: [] as string[] };

  const scopeA = withNotionNamingScope(async () => {
    // Materialize a dedupe entry for "Shared" + PAGE_A.
    results.a.push(notionStandalonePagePath(PAGE_A, 'Shared'));
    ready.a = true;
    while (!ready.b) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    // Same human-readable + same id within this scope must return the cached
    // path (no collision suffix), regardless of what scope B is doing.
    results.a.push(notionStandalonePagePath(PAGE_A, 'Shared'));
  });

  const scopeB = withNotionNamingScope(async () => {
    while (!ready.a) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    // Different id, same slug — under a leaked shared scope this would have
    // gained a collision suffix because scope A already added "shared".
    results.b.push(notionStandalonePagePath(PAGE_B, 'Shared'));
    ready.b = true;
  });

  await Promise.all([scopeA, scopeB]);

  assert.equal(results.a.length, 2);
  assert.equal(results.a[0], results.a[1]);
  assert.equal(results.a[0], `/notion/pages/shared__${PAGE_A}.json`);
  // Scope B sees a clean slate — no collision suffix because PAGE_B is the
  // first entry in its own scope.
  assert.equal(results.b[0], `/notion/pages/shared__${PAGE_B}.json`);
});
