import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SALESFORCE_MTLS_DEPLOYMENT_NOTE,
  SALESFORCE_WEBHOOK_SECRET_HEADER,
  SALESFORCE_WEBHOOK_TIMESTAMP_HEADER,
  assertValidSalesforceWebhookTimestamp,
  computeSalesforceWebhookSecret,
  normalizeSalesforceWebhook,
  validateSalesforceWebhookSecret,
  validateSalesforceWebhookTimestamp,
} from '../index.js';

const accountPayload = {
  action: 'updated',
  objectType: 'Account',
  organizationId: '00Dxx0000000001',
  data: {
    Id: '001A',
    Name: 'Acme',
    Industry: 'Manufacturing',
  },
};

test('normalizeSalesforceWebhook accepts the literal shared secret in X-SFDC-Webhook-Secret', () => {
  // Salesforce Outbound Messages send the configured secret as the literal
  // header value — there is no body HMAC. mTLS handles transport integrity.
  const rawPayload = JSON.stringify(accountPayload);
  const secret = 'salesforce-webhook-secret';

  const normalized = normalizeSalesforceWebhook(
    rawPayload,
    {
      [SALESFORCE_WEBHOOK_SECRET_HEADER]: secret,
      [SALESFORCE_WEBHOOK_TIMESTAMP_HEADER]: '1800000000000',
      'X-Relay-Connection-Id': 'conn_salesforce_123',
    },
    {
      webhookSecret: secret,
      webhookTimestampToleranceMs: 60_000,
    },
    {
      now: 1800000001000,
    },
  );

  assert.equal(normalized.provider, 'salesforce');
  assert.equal(normalized.connectionId, 'conn_salesforce_123');
  assert.equal(normalized.eventType, 'Account.updated');
  assert.equal(normalized.objectType, 'Account');
  assert.equal(normalized.objectId, '001A');
  assert.equal(normalized.payload.Name, 'Acme');
  assert.equal(normalized.payload._webhook && typeof normalized.payload._webhook === 'object', true);
  assert.match(SALESFORCE_MTLS_DEPLOYMENT_NOTE, /mTLS/);
});

test('normalizeSalesforceWebhook preserves closed and converted lifecycle actions', () => {
  const closedCase = normalizeSalesforceWebhook({
    action: 'updated',
    objectType: 'Case',
    data: {
      Id: '500A',
      Status: 'Closed',
      Subject: 'Billing question',
    },
  });
  assert.equal(closedCase.eventType, 'Case.closed');
  const closedWebhook = closedCase.payload._webhook as Record<string, unknown>;
  assert.equal(closedWebhook.action, 'closed');

  const convertedLead = normalizeSalesforceWebhook({
    action: 'updated',
    objectType: 'Lead',
    data: {
      Id: '00QA',
      IsConverted: true,
      Name: 'Grace Hopper',
    },
  });
  assert.equal(convertedLead.eventType, 'Lead.converted');
  const convertedWebhook = convertedLead.payload._webhook as Record<string, unknown>;
  assert.equal(convertedWebhook.action, 'converted');
});

test('validateSalesforceWebhookSecret rejects a header with the wrong secret', () => {
  const rawPayload = JSON.stringify(accountPayload);
  const secret = 'salesforce-webhook-secret';

  const invalid = validateSalesforceWebhookSecret(
    rawPayload,
    { [SALESFORCE_WEBHOOK_SECRET_HEADER]: 'wrong-secret-value' },
    secret,
  );

  assert.equal(invalid.ok, false);
  assert.equal(invalid.reason, 'invalid-secret');
  assert.throws(
    () =>
      normalizeSalesforceWebhook(
        rawPayload,
        { [SALESFORCE_WEBHOOK_SECRET_HEADER]: 'wrong-secret-value' },
        { webhookSecret: secret },
      ),
    /invalid-secret/,
  );
});

test('validateSalesforceWebhookSecret accepts when header matches secret regardless of body content', () => {
  // Body is irrelevant to Salesforce shared-secret verification — verifier
  // must accept the header even if the body has been modified, because it
  // never participates in the signature.
  const tamperedPayload = JSON.stringify({
    ...accountPayload,
    data: { ...accountPayload.data, Name: 'Mallory Corp' },
  });
  const secret = 'salesforce-webhook-secret';

  const result = validateSalesforceWebhookSecret(
    tamperedPayload,
    { [SALESFORCE_WEBHOOK_SECRET_HEADER]: secret },
    secret,
  );

  assert.equal(result.ok, true);
  // computeSalesforceWebhookSecret is now a deprecated identity helper —
  // it returns the configured secret since no HMAC is computed.
  assert.equal(computeSalesforceWebhookSecret(tamperedPayload, secret), secret);
});

test('validateSalesforceWebhookSecret rejects a missing X-SFDC-Webhook-Secret header', () => {
  const rawPayload = JSON.stringify(accountPayload);

  const missing = validateSalesforceWebhookSecret(rawPayload, {}, 'salesforce-webhook-secret');

  assert.deepEqual(missing, { ok: false, reason: 'missing-secret-header' });
  assert.throws(
    () => normalizeSalesforceWebhook(rawPayload, {}, { webhookSecret: 'salesforce-webhook-secret' }),
    /missing-secret-header/,
  );
});

test('validateSalesforceWebhookTimestamp rejects expired webhook timestamps', () => {
  const expired = validateSalesforceWebhookTimestamp(
    { [SALESFORCE_WEBHOOK_TIMESTAMP_HEADER]: '1800000000000' },
    60_000,
    1800000120001,
  );

  assert.equal(expired.ok, false);
  assert.equal(expired.reason, 'stale-timestamp');
  assert.throws(
    () =>
      assertValidSalesforceWebhookTimestamp(
        { [SALESFORCE_WEBHOOK_TIMESTAMP_HEADER]: '1800000000000' },
        60_000,
        1800000120001,
      ),
    /stale-timestamp/,
  );
});

test('normalizeSalesforceWebhook parses Salesforce Outbound Message SOAP notifications', () => {
  const soap = `
    <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:sf="urn:sobject.enterprise.soap.sforce.com" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
      <soapenv:Body>
        <notifications>
          <OrganizationId>00Dxx0000000001</OrganizationId>
          <Notification>
            <sObject xsi:type="sf:Contact">
              <sf:Id>003A</sf:Id>
              <sf:Name>Ada Lovelace</sf:Name>
              <sf:Email>ada@example.com</sf:Email>
            </sObject>
          </Notification>
        </notifications>
      </soapenv:Body>
    </soapenv:Envelope>
  `;

  const normalized = normalizeSalesforceWebhook(soap);

  assert.equal(normalized.eventType, 'Contact.updated');
  assert.equal(normalized.objectType, 'Contact');
  assert.equal(normalized.objectId, '003A');
  assert.equal(normalized.payload.Name, 'Ada Lovelace');
  assert.equal(normalized.payload.Email, 'ada@example.com');
});
