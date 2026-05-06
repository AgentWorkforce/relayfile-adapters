import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeLinearPath,
  normalizeLinearObjectType,
  normalizeNangoLinearModel,
  tryNormalizeLinearObjectType,
} from '../path-mapper.js';

describe('linear path-mapper', () => {
  describe('normalizeLinearObjectType', () => {
    it('accepts canonical types', () => {
      assert.equal(normalizeLinearObjectType('issue'), 'issue');
      assert.equal(normalizeLinearObjectType('TEAM'), 'team');
    });

    it('accepts plural aliases', () => {
      assert.equal(normalizeLinearObjectType('issues'), 'issue');
      assert.equal(normalizeLinearObjectType('teams'), 'team');
    });

    it('accepts Nango-style PascalCase model names', () => {
      assert.equal(normalizeLinearObjectType('LinearTeam'), 'team');
      assert.equal(normalizeLinearObjectType('LinearUser'), 'user');
      assert.equal(normalizeLinearObjectType('LinearIssue'), 'issue');
      assert.equal(normalizeLinearObjectType('LinearComment'), 'comment');
      assert.equal(normalizeLinearObjectType('LinearCycle'), 'cycle');
      assert.equal(normalizeLinearObjectType('LinearMilestone'), 'milestone');
      assert.equal(normalizeLinearObjectType('LinearProject'), 'project');
      assert.equal(normalizeLinearObjectType('LinearRoadmap'), 'roadmap');
    });

    it('throws on unknown types', () => {
      assert.throws(() => normalizeLinearObjectType('flarb'));
    });
  });

  describe('tryNormalizeLinearObjectType', () => {
    it('returns undefined on unknown types', () => {
      assert.equal(tryNormalizeLinearObjectType('flarb'), undefined);
    });

    it('returns the resolved type for known input', () => {
      assert.equal(tryNormalizeLinearObjectType('LinearIssue'), 'issue');
    });
  });

  describe('normalizeNangoLinearModel', () => {
    // Each Nango sync emits a single PascalCase model — see
    // cloud/nango-integrations/linear-relay/syncs/*.ts. This test pins those
    // contracts so any future sync rename surfaces here as a failure.
    it('maps every Nango linear-relay sync model', () => {
      assert.equal(normalizeNangoLinearModel('LinearComment'), 'comment');
      assert.equal(normalizeNangoLinearModel('LinearCycle'), 'cycle');
      assert.equal(normalizeNangoLinearModel('LinearIssue'), 'issue');
      assert.equal(normalizeNangoLinearModel('LinearMilestone'), 'milestone');
      assert.equal(normalizeNangoLinearModel('LinearProject'), 'project');
      assert.equal(normalizeNangoLinearModel('LinearRoadmap'), 'roadmap');
      assert.equal(normalizeNangoLinearModel('LinearTeam'), 'team');
      assert.equal(normalizeNangoLinearModel('LinearUser'), 'user');
    });

    it('falls back to alias-map normalization for non-Nango input', () => {
      assert.equal(normalizeNangoLinearModel('issues'), 'issue');
    });
  });

  describe('computeLinearPath', () => {
    it('produces Nango-driven paths from PascalCase model names', () => {
      assert.equal(
        computeLinearPath('LinearTeam', '50cf92f3-f53c-4ab6-bf05-ea76ebd21692'),
        '/linear/teams/50cf92f3-f53c-4ab6-bf05-ea76ebd21692.json',
      );
      assert.equal(
        computeLinearPath('LinearUser', 'usr_123'),
        '/linear/users/usr_123.json',
      );
    });
  });
});
