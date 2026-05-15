import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeAtlassianQueryStringHash,
  normalizeJiraWebhook,
  verifyAtlassianConnectJwt,
} from '../webhook-normalizer.js';

const SHARED_SECRET = 'top-secret';
const NOW = 1_700_000_000;
const METHOD = 'POST';
const PATH = '/webhooks/jira';
const QUERY = { issue: 'ENG-42' };

function signJwt(claimOverrides: Record<string, unknown> = {}): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    iss: 'jira-client-key',
    iat: NOW,
    exp: NOW + 300,
    qsh: computeAtlassianQueryStringHash({ method: METHOD, path: PATH, query: QUERY }),
    ...claimOverrides,
  };
  const encodedHeader = base64UrlJson(header);
  const encodedPayload = base64UrlJson(payload);
  const signature = createHmac('sha256', SHARED_SECRET)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

describe('normalizeJiraWebhook', () => {
  it('accepts a known-good Atlassian Connect HS256 JWT', () => {
    const token = signJwt();
    const normalized = normalizeJiraWebhook(
      {
        webhookEvent: 'jira:issue_updated',
        issue: {
          id: '10001',
          key: 'ENG-42',
          fields: { summary: 'Fix login redirect' },
        },
      },
      {
        config: { sharedSecret: SHARED_SECRET },
        headers: {
          authorization: `JWT ${token}`,
          'x-relay-connection-id': 'conn-1',
        },
        method: METHOD,
        nowSeconds: NOW,
        path: PATH,
        query: QUERY,
      },
    );

    assert.equal(normalized.provider, 'jira');
    assert.equal(normalized.connectionId, 'conn-1');
    assert.equal(normalized.eventType, 'issue.updated');
    assert.equal(normalized.objectType, 'issue');
    assert.equal(normalized.objectId, '10001');
  });

  it('classifies terminal issue status transitions as completed events', () => {
    const normalized = normalizeJiraWebhook(
      {
        webhookEvent: 'jira:issue_updated',
        issue: {
          id: '10001',
          key: 'ENG-42',
          fields: {
            status: { name: 'Done', statusCategory: { key: 'done' } },
            summary: 'Ship the digest',
          },
        },
        changelog: {
          histories: [
            {
              items: [
                { field: 'status', fromString: 'In Progress', toString: 'Done' },
              ],
            },
          ],
        },
      },
      {
        config: { sharedSecret: SHARED_SECRET },
        headers: {
          authorization: `JWT ${signJwt()}`,
          'x-relay-connection-id': 'conn-1',
        },
        method: METHOD,
        nowSeconds: NOW,
        path: PATH,
        query: QUERY,
      },
    );

    assert.equal(normalized.eventType, 'issue.completed');
    assert.equal(normalized.objectType, 'issue');
    assert.equal(normalized.objectId, '10001');
  });

  it('classifies canceled issue status transitions as completed events', () => {
    const normalized = normalizeJiraWebhook(
      {
        webhookEvent: 'jira:issue_updated',
        issue: {
          id: '10002',
          key: 'ENG-43',
          fields: {
            status: { name: 'Canceled', statusCategory: { key: 'done' } },
            summary: 'Cancel the obsolete rollout',
          },
        },
        changelog: {
          histories: [
            {
              items: [
                { field: 'status', fromString: 'In Progress', toString: 'Cancelled' },
              ],
            },
          ],
        },
      },
      {
        config: { sharedSecret: SHARED_SECRET },
        headers: {
          authorization: `JWT ${signJwt()}`,
          'x-relay-connection-id': 'conn-1',
        },
        method: METHOD,
        nowSeconds: NOW,
        path: PATH,
        query: QUERY,
      },
    );

    assert.equal(normalized.eventType, 'issue.completed');
    assert.equal(normalized.objectType, 'issue');
    assert.equal(normalized.objectId, '10002');
  });

  it('rejects a tampered-body signature', () => {
    const token = signJwt();
    const tampered = `${token.slice(0, -1)}x`;

    const result = verifyAtlassianConnectJwt({
      authorization: `JWT ${tampered}`,
      method: METHOD,
      nowSeconds: NOW,
      path: PATH,
      query: QUERY,
      sharedSecret: SHARED_SECRET,
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'invalid-signature');
  });

  it('rejects a missing authorization header', () => {
    const result = verifyAtlassianConnectJwt({
      method: METHOD,
      nowSeconds: NOW,
      path: PATH,
      query: QUERY,
      sharedSecret: SHARED_SECRET,
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'missing-authorization');
  });

  it('rejects an expired token beyond the allowed clock skew', () => {
    // Default skew is 180s; -200 is past the window.
    const token = signJwt({ exp: NOW - 200 });

    const result = verifyAtlassianConnectJwt({
      authorization: `JWT ${token}`,
      method: METHOD,
      nowSeconds: NOW,
      path: PATH,
      query: QUERY,
      sharedSecret: SHARED_SECRET,
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'expired');
  });

  it('honors a configurable clockSkewSeconds for exp validation', () => {
    // exp slightly in the past, but within a generous configured skew.
    const token = signJwt({ exp: NOW - 240 });

    const result = verifyAtlassianConnectJwt({
      authorization: `JWT ${token}`,
      clockSkewSeconds: 600,
      method: METHOD,
      nowSeconds: NOW,
      path: PATH,
      query: QUERY,
      sharedSecret: SHARED_SECRET,
    });

    assert.equal(result.ok, true);
  });

  it('rejects a token with a missing iss claim', () => {
    const token = signJwt({ iss: undefined });

    const result = verifyAtlassianConnectJwt({
      authorization: `JWT ${token}`,
      method: METHOD,
      nowSeconds: NOW,
      path: PATH,
      query: QUERY,
      sharedSecret: SHARED_SECRET,
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'missing-iss');
  });

  it('rejects a token whose iss does not match the configured clientKey', () => {
    const token = signJwt({ iss: 'rogue-issuer' });

    const result = verifyAtlassianConnectJwt({
      authorization: `JWT ${token}`,
      clientKey: 'jira-client-key',
      method: METHOD,
      nowSeconds: NOW,
      path: PATH,
      query: QUERY,
      sharedSecret: SHARED_SECRET,
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'invalid-iss');
  });

  it('rejects a token with iat in the future beyond the clock skew', () => {
    const token = signJwt({ iat: NOW + 600 });

    const result = verifyAtlassianConnectJwt({
      authorization: `JWT ${token}`,
      method: METHOD,
      nowSeconds: NOW,
      path: PATH,
      query: QUERY,
      sharedSecret: SHARED_SECRET,
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'issued-in-future');
  });

  it('rejects a qsh mismatch', () => {
    const token = signJwt();

    const result = verifyAtlassianConnectJwt({
      authorization: `JWT ${token}`,
      method: METHOD,
      nowSeconds: NOW,
      path: '/different/path',
      query: QUERY,
      sharedSecret: SHARED_SECRET,
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'invalid-qsh');
  });
});
