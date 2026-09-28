import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { reconcileLinearAgentActivity } from './agent-activity-reconciliation.js';

describe('Linear AgentActivity reconciliation', () => {
  it('owns cursor pagination and finds exact frozen content', async () => {
    const cursors: unknown[] = [];
    const result = await reconcileLinearAgentActivity({
      sessionId: 'session-1',
      activity: { type: 'response', body: 'Ready for review.' },
      execute: async (request) => {
        const variables = request.body.variables as {
          sessionId: string;
          after: string | null;
        };
        cursors.push(variables.after);
        assert.equal(request.action, 'list_agent_activities');
        assert.match(String(request.body.query), /RelayfileAgentSessionActivities/);
        if (variables.after === null) {
          return {
            ok: true,
            status: 200,
            data: {
              data: {
                agentSession: {
                  activities: {
                    nodes: [],
                    pageInfo: { hasNextPage: true, endCursor: 'page-2' },
                  },
                },
              },
            },
          };
        }
        return {
          ok: true,
          status: 200,
          data: {
            data: {
              agentSession: {
                activities: {
                  nodes: [{
                    id: 'activity-1',
                    content: {
                      __typename: 'AgentActivityResponseContent',
                      body: 'Ready for review.',
                    },
                  }],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            },
          },
        };
      },
    });

    assert.deepEqual(cursors, [null, 'page-2']);
    assert.deepEqual(result, {
      found: true,
      externalId: 'activity-1',
      status: 200,
    });
  });

  it('fails closed on provider errors and repeated cursors', async () => {
    await assert.rejects(
      reconcileLinearAgentActivity({
        sessionId: 'session-1',
        activity: { type: 'error', body: 'Failed.' },
        execute: async () => ({
          ok: true,
          status: 200,
          data: { errors: [{ message: 'permission denied' }] },
        }),
      }),
      /permission denied/,
    );

    await assert.rejects(
      reconcileLinearAgentActivity({
        sessionId: 'session-1',
        activity: { type: 'error', body: 'Failed.' },
        execute: async () => ({
          ok: true,
          status: 200,
          data: {
            data: {
              agentSession: {
                activities: {
                  nodes: [],
                  pageInfo: { hasNextPage: true, endCursor: 'same' },
                },
              },
            },
          },
        }),
      }),
      /invalid cursor/,
    );
  });

  it('fails closed when successful history responses are incomplete', async () => {
    const malformedPayloads = [
      { data: { agentSession: null } },
      { data: { agentSession: {} } },
      { data: { agentSession: { activities: { pageInfo: {
        hasNextPage: false,
      } } } } },
      { data: { agentSession: { activities: {
        nodes: [],
        pageInfo: {},
      } } } },
    ];

    for (const data of malformedPayloads) {
      await assert.rejects(
        reconcileLinearAgentActivity({
          sessionId: 'session-1',
          activity: { type: 'response', body: 'Ready for review.' },
          execute: async () => ({ ok: true, status: 200, data }),
        }),
        /malformed history/,
      );
    }
  });

  it('rejects malformed GraphQL error envelopes before trusting history', async () => {
    for (const errors of [null, 'upstream failed', { message: 'failed' }]) {
      await assert.rejects(
        reconcileLinearAgentActivity({
          sessionId: 'session-1',
          activity: { type: 'response', body: 'Ready for review.' },
          execute: async () => ({
            ok: true,
            status: 200,
            data: {
              errors,
              data: {
                agentSession: {
                  activities: {
                    nodes: [],
                    pageInfo: { hasNextPage: false, endCursor: null },
                  },
                },
              },
            },
          }),
        }),
        /GraphQL errors is not an array/,
      );
    }
  });

  it('requires a stable provider id before confirming a content match', async () => {
    await assert.rejects(
      reconcileLinearAgentActivity({
        sessionId: 'session-1',
        activity: { type: 'response', body: 'Ready for review.' },
        execute: async () => ({
          ok: true,
          status: 200,
          data: {
            data: {
              agentSession: {
                activities: {
                  nodes: [{
                    content: {
                      __typename: 'AgentActivityResponseContent',
                      body: 'Ready for review.',
                    },
                  }],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            },
          },
        }),
      }),
      /missing an id or content/,
    );
  });

  it('rejects incomplete activity content before reporting absence', async () => {
    const malformedContent = [
      {},
      { __typename: 'AgentActivityResponseContent' },
      {
        __typename: 'AgentActivityActionContent',
        action: 'deploy',
        parameter: null,
      },
    ];

    for (const content of malformedContent) {
      await assert.rejects(
        reconcileLinearAgentActivity({
          sessionId: 'session-1',
          activity: { type: 'response', body: 'Ready for review.' },
          execute: async () => ({
            ok: true,
            status: 200,
            data: {
              data: {
                agentSession: {
                  activities: {
                    nodes: [{ id: 'activity-1', content }],
                    pageInfo: { hasNextPage: false, endCursor: null },
                  },
                },
              },
            },
          }),
        }),
        /malformed history/,
      );
    }
  });
});
