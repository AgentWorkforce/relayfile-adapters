import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { WebhookVerificationError, verifyWebhookToken } from '../src/webhook/verify.js';

describe('verifyWebhookToken', () => {
  it('accepts X-Gitlab-Token from headers-like inputs', () => {
    assert.doesNotThrow(() => verifyWebhookToken(new Headers({ 'X-Gitlab-Token': 'secret' }), 'secret'));
    assert.doesNotThrow(() => verifyWebhookToken({ 'x-gitlab-token': 'secret' }, 'secret'));
  });

  it('rejects missing or invalid tokens', () => {
    assert.throws(() => verifyWebhookToken({}, 'secret'), WebhookVerificationError);
    assert.throws(
      () => verifyWebhookToken({ 'x-gitlab-token': 'wrong' }, 'secret'),
      { message: 'Invalid X-Gitlab-Token header' },
    );
  });
});
