import { describe, expect, it } from 'vitest';

import { WebhookVerificationError, verifyWebhookToken } from '../src/webhook/verify.js';

describe('verifyWebhookToken', () => {
  it('accepts X-Gitlab-Token from headers-like inputs', () => {
    expect(() => verifyWebhookToken(new Headers({ 'X-Gitlab-Token': 'secret' }), 'secret')).not.toThrow();
    expect(() => verifyWebhookToken({ 'x-gitlab-token': 'secret' }, 'secret')).not.toThrow();
  });

  it('rejects missing or invalid tokens', () => {
    expect(() => verifyWebhookToken({}, 'secret')).toThrowError(WebhookVerificationError);
    expect(() => verifyWebhookToken({ 'x-gitlab-token': 'wrong' }, 'secret')).toThrowError(
      'Invalid X-Gitlab-Token header',
    );
  });
});
