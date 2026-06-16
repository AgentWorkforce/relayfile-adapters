import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  matchesMaterializationTarget,
  normalizeMaterializationPolicy,
  resolveTargetMaterialization,
  shouldWriteWebhookForTarget,
  type AdapterMaterializationPolicy,
} from './materialization-policy.js';

const RESOURCES = ['issues', 'merge_requests'] as const;
const STATES = ['opened', 'closed', 'all'] as const;

describe('materialization policy utilities', () => {
  it('normalizes default aliases and resource-specific rules', () => {
    const policy = normalizeMaterializationPolicy(
      {
        default: 'none',
        webhookWritesForLazyTargets: false,
        rules: [
          {
            projects: ['acme/*'],
            resources: ['issues'],
            filter: { state: 'opened', labels: ['factory'] },
            merge_requests: {
              mode: 'all',
              incremental: true,
            },
          },
        ],
      },
      {
        defaultMode: 'eager',
        resources: RESOURCES,
        stateValues: STATES,
        targetKey: 'projects',
      },
    );

    assert.deepEqual(policy, {
      default: 'lazy',
      webhookWritesForLazyTargets: false,
      rules: [
        {
          projects: ['acme/*'],
          resources: ['issues'],
          filter: { state: 'opened', labels: ['factory'], since: undefined },
          merge_requests: {
            mode: 'eager',
            filter: undefined,
            since: undefined,
            incremental: true,
          },
        },
      ],
    });
  });

  it('resolves first-match target rules with resource list fallback', () => {
    const policy: AdapterMaterializationPolicy<
      (typeof RESOURCES)[number],
      (typeof STATES)[number],
      'projects'
    > = {
      default: 'lazy',
      rules: [
        {
          projects: ['acme/api'],
          resources: ['issues'],
          filter: { state: 'opened' },
        },
        {
          projects: ['acme/*'],
          resources: ['merge_requests'],
        },
      ],
    };

    assert.deepEqual(
      resolveTargetMaterialization(policy, 'acme/api', {}, {
        resources: RESOURCES,
        targetKey: 'projects',
      }),
      {
        issues: { mode: 'eager', filter: { state: 'opened' }, since: undefined },
        merge_requests: { mode: 'lazy', filter: { state: 'opened' }, since: undefined },
      },
    );
  });

  it('uses cursor for incremental resource policies', () => {
    const policy = normalizeMaterializationPolicy(
      {
        default: 'lazy',
        rules: [
          {
            projects: ['acme/api'],
            merge_requests: { mode: 'eager', incremental: true },
          },
        ],
      },
      {
        defaultMode: 'lazy',
        resources: RESOURCES,
        stateValues: STATES,
        targetKey: 'projects',
      },
    );

    assert.deepEqual(
      resolveTargetMaterialization(policy, 'acme/api', { cursor: '2026-06-01T00:00:00Z' }, {
        resources: RESOURCES,
        targetKey: 'projects',
      }).merge_requests,
      {
        mode: 'eager',
        filter: undefined,
        since: '2026-06-01T00:00:00Z',
      },
    );
  });

  it('lets resource-level incremental false override rule-level incremental true', () => {
    const policy = normalizeMaterializationPolicy(
      {
        default: 'lazy',
        rules: [
          {
            projects: ['acme/api'],
            incremental: true,
            issues: { mode: 'eager', incremental: false },
            merge_requests: { mode: 'eager' },
          },
        ],
      },
      {
        defaultMode: 'lazy',
        resources: RESOURCES,
        stateValues: STATES,
        targetKey: 'projects',
      },
    );

    const plan = resolveTargetMaterialization(policy, 'acme/api', { cursor: '2026-06-01T00:00:00Z' }, {
      resources: RESOURCES,
      targetKey: 'projects',
    });

    assert.deepEqual(plan.issues, {
      mode: 'eager',
      filter: undefined,
      since: undefined,
    });
    assert.deepEqual(plan.merge_requests, {
      mode: 'eager',
      filter: undefined,
      since: '2026-06-01T00:00:00Z',
    });
  });

  it('matches exact and glob targets case-insensitively', () => {
    assert.equal(matchesMaterializationTarget('Acme/API', 'acme/api'), true);
    assert.equal(matchesMaterializationTarget('acme/*', 'acme/web'), true);
    assert.equal(matchesMaterializationTarget('acme/app?', 'acme/app1'), true);
    assert.equal(matchesMaterializationTarget('acme/app?', 'acme/app10'), false);
    assert.equal(matchesMaterializationTarget('acme/*/app-*', 'acme/team/app-api'), true);
    assert.equal(matchesMaterializationTarget('acme/*/app-?', 'acme/team/app-api'), false);
  });

  it('gates webhook writes only when lazy target writes are disabled', () => {
    const policy = normalizeMaterializationPolicy(
      {
        default: 'lazy',
        webhookWritesForLazyTargets: false,
        rules: [
          {
            projects: ['acme/api'],
            resources: ['issues'],
          },
        ],
      },
      {
        defaultMode: 'lazy',
        resources: RESOURCES,
        stateValues: STATES,
        targetKey: 'projects',
      },
    );

    assert.equal(
      shouldWriteWebhookForTarget(policy, 'acme/api', {
        resources: RESOURCES,
        targetKey: 'projects',
      }),
      true,
    );
    assert.equal(
      shouldWriteWebhookForTarget(policy, 'acme/web', {
        resources: RESOURCES,
        targetKey: 'projects',
      }),
      false,
    );
  });
});
