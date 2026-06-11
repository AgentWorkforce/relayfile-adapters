import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveSendGridWritebackRequest } from './writeback.js';

test('SendGrid writeback sends mail from non-canonical draft filenames', () => {
  const request = resolveSendGridWritebackRequest(
    '/sendgrid/mail/send%20receipt.json',
    JSON.stringify({
      from: { email: 'ops@example.com' },
      personalizations: [{ to: [{ email: 'ada@example.com' }] }],
      subject: 'Receipt',
    }),
  );

  assert.equal(request.action, 'send_mail');
  assert.equal(request.endpoint, '/v3/mail/send');
  assert.equal(request.body.subject, 'Receipt');
});

test('SendGrid writeback upserts contacts from draft filenames and preserves canonical updates', () => {
  const create = resolveSendGridWritebackRequest(
    '/sendgrid/contacts/draft-contact.json',
    JSON.stringify({ email: 'ada@example.com', first_name: 'Ada' }),
  );
  assert.equal(create.action, 'upsert_contact');
  assert.equal(create.endpoint, '/v3/marketing/contacts');
  assert.deepEqual(create.body, { contacts: [{ email: 'ada@example.com', first_name: 'Ada' }] });

  const update = resolveSendGridWritebackRequest(
    '/sendgrid/contacts/contact_123.json',
    JSON.stringify({ email: 'ada@example.com', first_name: 'Ada' }),
  );
  assert.equal(update.action, 'update_contact');
  assert.deepEqual(update.body, { contacts: [{ email: 'ada@example.com', first_name: 'Ada', id: 'contact_123' }] });
});
