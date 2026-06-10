import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { headersToRecord, verifyWebhookSignature } from '../src/verify.js';
import type { RegisteredWebhookAdapter, WebhookVerificationResult } from '../src/types.js';

const noopAdapter: RegisteredWebhookAdapter = {};

function githubSignature(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

function slackSignature(secret: string, timestamp: number, body: string): string {
  return `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex')}`;
}

describe('headersToRecord', () => {
  it('lowercases header names', () => {
    const record = headersToRecord(new Headers({ 'X-GitHub-Event': 'push', Accept: 'application/json' }));
    assert.strictEqual(record['x-github-event'], 'push');
    assert.strictEqual(record.accept, 'application/json');
  });
});

describe('verifyWebhookSignature', () => {
  it('passes through when no secret is configured', async () => {
    const result = await verifyWebhookSignature(
      { provider: 'github', headers: new Headers(), rawBody: '{}' },
      noopAdapter,
    );
    assert.deepStrictEqual(result, { ok: true });
  });

  it('delegates to an adapter-provided verifier', async () => {
    const custom: WebhookVerificationResult = { ok: false, error: 'nope', reason: 'custom', status: 400 };
    const result = await verifyWebhookSignature(
      { provider: 'github', headers: new Headers(), rawBody: '{}', secret: 's' },
      { verifySignature: () => custom },
    );
    assert.deepStrictEqual(result, custom);
  });

  it('rejects providers without a built-in verifier when a secret is set', async () => {
    const result = await verifyWebhookSignature(
      { provider: 'linear', headers: new Headers(), rawBody: '{}', secret: 's' },
      noopAdapter,
    );
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.ok ? undefined : result.reason, 'unsupported_provider');
  });

  describe('github', () => {
    const secret = 'gh-secret';
    const body = '{"action":"opened"}';

    it('accepts a valid x-hub-signature-256', async () => {
      const headers = new Headers({ 'x-hub-signature-256': githubSignature(secret, body) });
      const result = await verifyWebhookSignature(
        { provider: 'github', headers, rawBody: body, secret },
        noopAdapter,
      );
      assert.deepStrictEqual(result, { ok: true });
    });

    it('rejects a missing signature header', async () => {
      const result = await verifyWebhookSignature(
        { provider: 'github', headers: new Headers(), rawBody: body, secret },
        noopAdapter,
      );
      assert.deepStrictEqual(result, {
        ok: false,
        error: 'Missing x-hub-signature-256 header.',
        reason: 'missing_signature',
        status: 401,
      });
    });

    it('rejects a tampered body', async () => {
      const headers = new Headers({ 'x-hub-signature-256': githubSignature(secret, body) });
      const result = await verifyWebhookSignature(
        { provider: 'github', headers, rawBody: '{"action":"closed"}', secret },
        noopAdapter,
      );
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.ok ? undefined : result.reason, 'signature_mismatch');
    });
  });

  describe('slack', () => {
    const secret = 'slack-secret';
    const body = '{"type":"event_callback"}';
    const now = 1_700_000_000_000;
    const timestamp = Math.floor(now / 1000);

    it('accepts a valid v0 signature within the replay window', async () => {
      const headers = new Headers({
        'x-slack-request-timestamp': String(timestamp),
        'x-slack-signature': slackSignature(secret, timestamp, body),
      });
      const result = await verifyWebhookSignature(
        { provider: 'slack', headers, rawBody: body, secret, now },
        noopAdapter,
      );
      assert.deepStrictEqual(result, { ok: true });
    });

    it('rejects stale timestamps beyond five minutes', async () => {
      const stale = timestamp - 301;
      const headers = new Headers({
        'x-slack-request-timestamp': String(stale),
        'x-slack-signature': slackSignature(secret, stale, body),
      });
      const result = await verifyWebhookSignature(
        { provider: 'slack', headers, rawBody: body, secret, now },
        noopAdapter,
      );
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.ok ? undefined : result.reason, 'stale_timestamp');
    });

    it('rejects missing timestamp, missing signature, and malformed timestamps', async () => {
      const missingTimestamp = await verifyWebhookSignature(
        {
          provider: 'slack',
          headers: new Headers({ 'x-slack-signature': 'v0=abc' }),
          rawBody: body,
          secret,
          now,
        },
        noopAdapter,
      );
      assert.strictEqual(missingTimestamp.ok ? undefined : missingTimestamp.reason, 'missing_timestamp');

      const missingSignature = await verifyWebhookSignature(
        {
          provider: 'slack',
          headers: new Headers({ 'x-slack-request-timestamp': String(timestamp) }),
          rawBody: body,
          secret,
          now,
        },
        noopAdapter,
      );
      assert.strictEqual(missingSignature.ok ? undefined : missingSignature.reason, 'missing_signature');

      const invalidTimestamp = await verifyWebhookSignature(
        {
          provider: 'slack',
          headers: new Headers({
            'x-slack-request-timestamp': 'not-a-number',
            'x-slack-signature': 'v0=abc',
          }),
          rawBody: body,
          secret,
          now,
        },
        noopAdapter,
      );
      assert.strictEqual(invalidTimestamp.ok ? undefined : invalidTimestamp.reason, 'invalid_timestamp');
    });

    it('rejects signature mismatches', async () => {
      const headers = new Headers({
        'x-slack-request-timestamp': String(timestamp),
        'x-slack-signature': slackSignature('wrong-secret', timestamp, body),
      });
      const result = await verifyWebhookSignature(
        { provider: 'slack', headers, rawBody: body, secret, now },
        noopAdapter,
      );
      assert.strictEqual(result.ok ? undefined : result.reason, 'signature_mismatch');
    });
  });
});
