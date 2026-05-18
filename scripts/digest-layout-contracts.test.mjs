import assert from 'node:assert/strict';
import test from 'node:test';

import {
  activeRegressionContractSatisfied,
  activeTestHasAssertion,
} from './digest-layout-contracts.mjs';

test('digest contract coverage rejects keyword-only comments without a live assertion', () => {
  const source = `
    test('deterministic sorting is mentioned in the title', () => {
      // empty window, created, deleted, and deterministic sorting
      const unused = 'created deleted deterministic sorted empty';
    });
  `;

  assert.equal(activeTestHasAssertion(source, /deterministic|sorted/i), false);
  assert.equal(activeTestHasAssertion(source, /empty/i), false);
});

test('digest contract coverage ignores skipped tests even when they contain assertions', () => {
  const source = `
    test.skip('deterministic sorting', () => {
      assert.deepEqual(actual.bullets, expected.bullets);
    });
    it.skip('empty window', () => {
      assert.equal(actual, null);
    });
  `;

  assert.equal(activeTestHasAssertion(source, /deterministic|sorted/i), false);
  assert.equal(activeTestHasAssertion(source, /empty/i), false);
});

test('digest contract coverage accepts a live assertion test', () => {
  const source = `
    test('digest returns deterministic bullets sorted by event time and id', () => {
      assert.deepEqual(actual.bullets, [
        { text: 'record a was created' },
        { text: 'record b was updated' },
      ]);
    });
  `;

  assert.equal(activeTestHasAssertion(source, /deterministic|sorted/i), true);
});

test('digest contract coverage ignores closing parens inside comments when slicing test blocks', () => {
  const source = `
    test('empty window behavior', () => {
      // changeEvents() is empty and should not close this test block early )
      /* assert.equal(fakeCall()), also ignored ) */
      const path = '/provider/root'.replace(/^\\//u, '');
      assert.equal(actual, null);
    });
  `;

  assert.equal(activeTestHasAssertion(source, /empty/i), true);
});

test('executable regression contracts require all evidence in one live assertion test', () => {
  const needles = ['githubByAssigneeAliasPath', 'githubByPriorityAliasPath'];
  const splitEvidence = `
    test('first half', () => {
      assert.ok(source.includes('githubByAssigneeAliasPath'));
    });
    test('second half', () => {
      assert.ok(source.includes('githubByPriorityAliasPath'));
    });
  `;
  const liveEvidence = `
    test('index-only bare PR tombstone removes aliases', () => {
      assert.ok(deletedPaths.has(githubByAssigneeAliasPath('acme', 'widgets', 'pulls', 'mona', 42)));
      assert.ok(deletedPaths.has(githubByPriorityAliasPath('acme', 'widgets', 'pulls', 'high', 42)));
    });
  `;

  assert.equal(activeRegressionContractSatisfied(splitEvidence, needles), false);
  assert.equal(activeRegressionContractSatisfied(liveEvidence, needles), true);
});

test('digest contract coverage slices parenthesized test calls from the test token', () => {
  const source = `
    suite(test('first split evidence', () => {
      assert.ok(source.includes('needle-a'));
    }), test('second split evidence', () => {
      assert.ok(source.includes('needle-b'));
    }));
  `;

  assert.equal(activeRegressionContractSatisfied(source, ['needle-a', 'needle-b']), false);
});
