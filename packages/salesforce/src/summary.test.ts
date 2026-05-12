import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSummary } from './summary.js';

const MAX_SUMMARY_JSON_LENGTH = 1024;

function assertSummaryWithinBudget(summary: unknown): void {
  const serialized = JSON.stringify(summary);
  assert.ok(
    serialized.length < MAX_SUMMARY_JSON_LENGTH,
    `expected summary JSON under ${MAX_SUMMARY_JSON_LENGTH} bytes, got ${serialized.length}`,
  );
}

test('buildSummary uses ChangeEventHeader changed fields when Salesforce omits a top-level changes block', () => {
  const summary = buildSummary({
    data: {
      Subject: 'Escalated enterprise case',
      Status: 'Working',
      Priority: 'High',
      RecordTypeId: '012000000000001',
    },
    ChangeEventHeader: {
      changedFields: ['Status', 'Priority'],
    },
  });

  assert.deepEqual(summary, {
    title: 'Escalated enterprise case',
    status: 'Working',
    priority: 'High',
    fieldsChanged: ['Status', 'Priority'],
    tags: ['record_type:012000000000001'],
  });
  assertSummaryWithinBudget(summary);
});

test('buildSummary prefers Salesforce custom status and priority fields and redacts title PII', () => {
  const summary = buildSummary({
    data: {
      Name: 'Case for jane@example.com call +1 (555) 123-4567',
      Status__c: 'Escalated',
      Priority__c: 'Urgent',
      RecordTypeId: '012000000000002',
      LastModifiedById: '005xx0000012345',
    },
    changes: {
      Email__c: { from: 'old@example.com' },
      Priority__c: { from: 'Normal' },
    },
  });

  assert.deepEqual(summary, {
    title: 'Case for [redacted-email] call [redacted-number]',
    status: 'Escalated',
    priority: 'Urgent',
    actor: {
      id: '005xx0000012345',
    },
    fieldsChanged: ['Email__c', 'Priority__c'],
    tags: ['record_type:012000000000002'],
  });
  assertSummaryWithinBudget(summary);
});

test('buildSummary caps oversized Salesforce summaries under the 1 KB envelope budget', () => {
  const summary = buildSummary({
    data: {
      Subject: `Escalation for jane@example.com ${'critical '.repeat(40)}call +1 (555) 123-4567 immediately`,
      Status: 'Working',
      Priority: 'High',
      RecordTypeId: '012000000000003',
    },
    changedFields: Array.from({ length: 20 }, (_, index) => `Custom_Field_${index}__c`),
  });

  assert.equal(summary.title?.length, 120);
  assert.equal(summary.title?.endsWith('...'), true);
  assert.equal(summary.fieldsChanged?.length, 12);
  assert.match(summary.title ?? '', /\[redacted-email\]|\[redacted-number\]/);
  assertSummaryWithinBudget(summary);
});

test('buildSummary prioritizes Salesforce custom fields in fieldsChanged when mixed with standard fields', () => {
  const summary = buildSummary({
    data: {
      Name: 'Strategic renewal',
      Status__c: 'Working',
      Priority__c: 'High',
    },
    changedFields: ['Status', 'Custom_Email__c', 'Priority', 'Custom_Phone__c'],
  });

  assert.deepEqual(summary, {
    title: 'Strategic renewal',
    status: 'Working',
    priority: 'High',
    fieldsChanged: ['Custom_Email__c', 'Custom_Phone__c', 'Status', 'Priority'],
  });
  assertSummaryWithinBudget(summary);
});
