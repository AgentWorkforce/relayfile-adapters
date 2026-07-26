import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GMAIL_IDENTITY,
  GMAIL_LEGACY_PATH_ROOTS,
  GMAIL_LEGACY_PROVIDER_IDS,
  GMAIL_PATH_ROOT,
  GMAIL_PATH_ROOTS,
  GMAIL_PROVIDER_CONFIG_ALIASES,
  GMAIL_PROVIDER_ID,
  isGmailPath,
  isGmailProvider,
} from './identity.js';

test('Gmail publishes one canonical provider and path identity', () => {
  assert.equal(GMAIL_PROVIDER_ID, 'gmail');
  assert.equal(GMAIL_PATH_ROOT, '/gmail');
  assert.deepEqual(GMAIL_LEGACY_PROVIDER_IDS, ['google-mail']);
  assert.deepEqual(GMAIL_LEGACY_PATH_ROOTS, ['/google-mail']);
  assert.deepEqual(GMAIL_PATH_ROOTS, ['/gmail', '/google-mail']);
  assert.deepEqual(GMAIL_PROVIDER_CONFIG_ALIASES, [
    'gmail',
    'google-mail',
    'google-mail-relay',
  ]);
});

test('Gmail migration policy is canonical-write, legacy-read, and non-destructive', () => {
  assert.deepEqual(GMAIL_IDENTITY.migration, {
    canonicalWrites: 'canonical-only',
    legacyReads: 'supported',
    legacyDigests: 'supported',
    legacyDeletion: 'forbidden',
    resync: 'required',
    retireLegacyAfter: 'zero-references-and-explicit-cutover',
  });
});

test('Gmail identity helpers accept canonical and declared legacy aliases only', () => {
  for (const provider of ['gmail', 'google-mail', 'google-mail-relay', ' GMAIL ']) {
    assert.equal(isGmailProvider(provider), true, provider);
  }
  assert.equal(isGmailProvider('google-calendar'), false);

  for (const path of [
    '/gmail',
    'gmail/me/threads/thread-1.json',
    '/google-mail/messages/message-1.json',
  ]) {
    assert.equal(isGmailPath(path), true, path);
  }
  assert.equal(isGmailPath('/gmailish/messages/message-1.json'), false);
});
