import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GOOGLE_MAIL_RELAYFILE_ACTIONS,
  GOOGLE_MAIL_RELAYFILE_MINIMUM_OAUTH_SCOPES,
  GOOGLE_MAIL_RELAYFILE_OPERATOR_ONLY_FAMILIES,
  fingerprintGoogleMailRelayfilePayload,
  normalizeGoogleMailRelayfileWriteback,
  resolveGoogleMailRelayfileTarget,
} from '../index.js';

test('Google Mail Relayfile contract exposes only the bounded reviewed action surface', () => {
  assert.equal(GOOGLE_MAIL_RELAYFILE_ACTIONS.length, 13);
  assert.deepEqual(
    GOOGLE_MAIL_RELAYFILE_ACTIONS.map(({ action }) => action),
    [
      'create_label', 'update_label', 'delete_label', 'create_filter',
      'delete_filter', 'create_send_as', 'update_send_as', 'delete_send_as',
      'send_message', 'modify_message', 'delete_message', 'modify_thread',
      'delete_thread',
    ],
  );
  assert.equal(GOOGLE_MAIL_RELAYFILE_OPERATOR_ONLY_FAMILIES.includes('delegates'), true);
  assert.equal(GOOGLE_MAIL_RELAYFILE_OPERATOR_ONLY_FAMILIES.includes('watch-lifecycle'), true);
  assert.deepEqual(
    GOOGLE_MAIL_RELAYFILE_ACTIONS.find(({ action }) => action === 'delete_message')?.minimumOAuthScopes,
    [GOOGLE_MAIL_RELAYFILE_MINIMUM_OAUTH_SCOPES.mailGoogle],
  );
  assert.equal(
    GOOGLE_MAIL_RELAYFILE_ACTIONS.find(({ action }) => action === 'create_send_as')?.requiresDomainWideDelegation,
    true,
  );
});

test('Google Mail Relayfile targets preserve a requested by-id alias and resolve its canonical path', () => {
  const target = resolveGoogleMailRelayfileTarget('/gmail/messages/by-id/19fb85341fbd9682.json');
  assert.deepEqual(target, {
    requestedPath: '/gmail/messages/by-id/19fb85341fbd9682.json',
    canonicalPath: '/gmail/messages/19fb85341fbd9682.json',
    resource: 'messages',
    resourceId: '19fb85341fbd9682',
    kind: 'by-id-alias',
  });
  assert.equal(
    resolveGoogleMailRelayfileTarget('/gmail/send-as/alias+agent@example.com.json').canonicalPath,
    '/gmail/send-as/alias+agent@example.com.json',
  );
  const draftLikeSendAs = resolveGoogleMailRelayfileTarget('/gmail/send-as/new-hire@example.com.json');
  assert.equal(draftLikeSendAs.kind, 'canonical');
  assert.equal(
    normalizeGoogleMailRelayfileWriteback({
      path: draftLikeSendAs.requestedPath,
      operation: 'upsert',
      content: JSON.stringify({ sendAsEmail: 'new-hire@example.com', signature: 'Welcome aboard' }),
    }).action,
    'update_send_as',
  );
  assert.throws(
    () => resolveGoogleMailRelayfileTarget('/gmail/messages/%31.json'),
    /absolute unencoded path/u,
  );
  assert.throws(
    () => resolveGoogleMailRelayfileTarget('/google-mail/messages/19fb85341fbd9682.json'),
    /canonical \/gmail path/u,
  );
});

test('Google Mail Relayfile normalization produces deterministic, state-bound ephemeral envelopes', () => {
  const input = {
    path: '/gmail/messages/by-id/19fb85341fbd9682.json',
    operation: 'upsert' as const,
    content: JSON.stringify({ id: '19fb85341fbd9682', removeLabelIds: ['UNREAD'], addLabelIds: ['STARRED'] }),
  };
  const first = normalizeGoogleMailRelayfileWriteback(input);
  const second = normalizeGoogleMailRelayfileWriteback({
    ...input,
    content: JSON.stringify({ addLabelIds: ['STARRED'], id: '19fb85341fbd9682', removeLabelIds: ['UNREAD'] }),
  });

  assert.equal(first.action, 'modify_message');
  assert.equal(first.method, 'POST');
  assert.equal(first.endpoint, '/gmail/v1/users/me/messages/19fb85341fbd9682/modify');
  assert.equal(first.target.canonicalPath, '/gmail/messages/19fb85341fbd9682.json');
  assert.equal(first.safety.requiresExactConfirmation, true);
  assert.equal(first.safety.requiresStatePrecondition, true);
  assert.equal(first.payloadFingerprint, second.payloadFingerprint);
  assert.equal(first.payloadFingerprint, fingerprintGoogleMailRelayfilePayload({
    action: first.action,
    endpoint: first.endpoint,
    body: first.body,
    target: first.target,
  }));

  const idlessUpdate = normalizeGoogleMailRelayfileWriteback({
    path: '/gmail/messages/19fb85341fbd9682.json',
    operation: 'upsert',
    content: JSON.stringify({ addLabelIds: ['IMPORTANT'] }),
  });
  assert.equal(idlessUpdate.action, 'modify_message');
  assert.equal(idlessUpdate.endpoint, '/gmail/v1/users/me/messages/19fb85341fbd9682/modify');
  assert.deepEqual(idlessUpdate.body, { addLabelIds: ['IMPORTANT'] });
});

test('Google Mail Relayfile creates have no canonical target and filters never silently update', () => {
  const label = normalizeGoogleMailRelayfileWriteback({
    path: '/gmail/labels/create-project.json',
    operation: 'upsert',
    content: JSON.stringify({ name: 'Project', textColor: '#000000', backgroundColor: '#ffffff' }),
  });
  assert.equal(label.action, 'create_label');
  assert.equal(label.target.kind, 'draft');
  assert.equal(label.target.canonicalPath, null);
  assert.equal(label.reconciliation.targetId, null);
  assert.deepEqual(label.body, {
    name: 'Project',
    color: { textColor: '#000000', backgroundColor: '#ffffff' },
  });

  assert.throws(
    () => normalizeGoogleMailRelayfileWriteback({
      path: '/gmail/filters/filter_1.json',
      operation: 'upsert',
      content: JSON.stringify({ criteria: { from: 'sender@example.test' }, action: { addLabelIds: ['STARRED'] } }),
    }),
    /cannot be updated/u,
  );
});

test('Google Mail Relayfile resolves every reviewed action to its exact Gmail request', () => {
  const cases = [
    {
      name: 'create label',
      input: {
        path: '/gmail/labels/create-project.json',
        operation: 'upsert' as const,
        content: JSON.stringify({ name: 'Project', messageListVisibility: 'show', labelListVisibility: 'labelShow' }),
      },
      action: 'create_label',
      method: 'POST',
      endpoint: '/gmail/v1/users/me/labels',
    },
    {
      name: 'update label',
      input: {
        path: '/gmail/labels/Label_123.json',
        operation: 'upsert' as const,
        content: JSON.stringify({ id: 'Label_123', name: 'Renamed project' }),
      },
      action: 'update_label',
      method: 'PATCH',
      endpoint: '/gmail/v1/users/me/labels/Label_123',
    },
    {
      name: 'delete label',
      input: { path: '/gmail/labels/Label_123.json', operation: 'delete' as const },
      action: 'delete_label',
      method: 'DELETE',
      endpoint: '/gmail/v1/users/me/labels/Label_123',
    },
    {
      name: 'create filter',
      input: {
        path: '/gmail/filters/draft-newsletter.json',
        operation: 'upsert' as const,
        content: JSON.stringify({ criteria: { from: 'news@example.test' }, action: { addLabelIds: ['Label_123'] } }),
      },
      action: 'create_filter',
      method: 'POST',
      endpoint: '/gmail/v1/users/me/settings/filters',
    },
    {
      name: 'delete filter',
      input: { path: '/gmail/filters/12345.json', operation: 'delete' as const },
      action: 'delete_filter',
      method: 'DELETE',
      endpoint: '/gmail/v1/users/me/settings/filters/12345',
    },
    {
      name: 'create send-as',
      input: {
        path: '/gmail/send-as/create-alias.json',
        operation: 'upsert' as const,
        content: JSON.stringify({ sendAsEmail: 'alias@example.test', displayName: 'Agent alias' }),
      },
      action: 'create_send_as',
      method: 'POST',
      endpoint: '/gmail/v1/users/me/settings/sendAs',
    },
    {
      name: 'update send-as',
      input: {
        path: '/gmail/send-as/alias@example.test.json',
        operation: 'upsert' as const,
        content: JSON.stringify({ sendAsEmail: 'alias@example.test', signature: 'Best, Agent' }),
      },
      action: 'update_send_as',
      method: 'PATCH',
      endpoint: '/gmail/v1/users/me/settings/sendAs/alias%40example.test',
    },
    {
      name: 'delete send-as',
      input: { path: '/gmail/send-as/alias@example.test.json', operation: 'delete' as const },
      action: 'delete_send_as',
      method: 'DELETE',
      endpoint: '/gmail/v1/users/me/settings/sendAs/alias%40example.test',
    },
    {
      name: 'send message',
      input: {
        path: '/gmail/messages/draft-outbound.json',
        operation: 'upsert' as const,
        content: JSON.stringify({ raw: 'VGVzdA', threadId: '19fb85341fbd9682' }),
      },
      action: 'send_message',
      method: 'POST',
      endpoint: '/gmail/v1/users/me/messages/send',
    },
    {
      name: 'modify message',
      input: {
        path: '/gmail/messages/19fb85341fbd9682.json',
        operation: 'upsert' as const,
        content: JSON.stringify({ id: '19fb85341fbd9682', removeLabelIds: ['UNREAD'] }),
      },
      action: 'modify_message',
      method: 'POST',
      endpoint: '/gmail/v1/users/me/messages/19fb85341fbd9682/modify',
    },
    {
      name: 'delete message',
      input: { path: '/gmail/messages/19fb85341fbd9682.json', operation: 'delete' as const },
      action: 'delete_message',
      method: 'DELETE',
      endpoint: '/gmail/v1/users/me/messages/19fb85341fbd9682',
    },
    {
      name: 'modify thread',
      input: {
        path: '/gmail/threads/19fb85341fbd9682.json',
        operation: 'upsert' as const,
        content: JSON.stringify({ id: '19fb85341fbd9682', addLabelIds: ['STARRED'] }),
      },
      action: 'modify_thread',
      method: 'POST',
      endpoint: '/gmail/v1/users/me/threads/19fb85341fbd9682/modify',
    },
    {
      name: 'delete thread',
      input: { path: '/gmail/threads/19fb85341fbd9682.json', operation: 'delete' as const },
      action: 'delete_thread',
      method: 'DELETE',
      endpoint: '/gmail/v1/users/me/threads/19fb85341fbd9682',
    },
  ] as const;
  assert.deepEqual(
    [...new Set(cases.map(({ action }) => action))].sort(),
    GOOGLE_MAIL_RELAYFILE_ACTIONS.map(({ action }) => action).slice().sort(),
  );
  const settingsActions: ReadonlySet<string> = new Set([
    'create_label', 'update_label', 'delete_label',
    'create_filter', 'delete_filter',
    'create_send_as', 'update_send_as', 'delete_send_as',
  ]);

  for (const expected of cases) {
    const result = normalizeGoogleMailRelayfileWriteback(expected.input);
    assert.equal(result.action, expected.action, expected.name);
    assert.equal(result.method, expected.method, expected.name);
    assert.equal(result.endpoint, expected.endpoint, expected.name);
    assert.match(result.payloadFingerprint, /^[a-f0-9]{64}$/u, expected.name);
    assert.equal(
      result.reconciliation.kind,
      settingsActions.has(expected.action) ? 'settings-refresh' : 'gmail-history',
      `${expected.name} reconciliation`,
    );
    assert.equal(result.reconciliation.resource, result.target.resource, `${expected.name} reconciliation resource`);
  }
});

test('Google Mail Relayfile rejects ignored fields, malformed nested values, and ambiguous mutations', () => {
  const invalid = [
    {
      input: {
        path: '/gmail/messages/19fb85341fbd9682.json',
        operation: 'upsert' as const,
        content: JSON.stringify({ addLabelIds: ['INBOX'], raw: 'VGVzdA' }),
      },
      message: /unsupported field `raw`/u,
    },
    {
      input: {
        path: '/gmail/filters/draft-newsletter.json',
        operation: 'upsert' as const,
        content: JSON.stringify({ criteria: { hasAttachment: 'yes' }, action: { addLabelIds: ['INBOX'] } }),
      },
      message: /must be a boolean/u,
    },
    {
      input: {
        path: '/gmail/filters/draft-newsletter.json',
        operation: 'upsert' as const,
        content: JSON.stringify({ criteria: { from: 'news@example.test' }, action: { addLabelIds: [] } }),
      },
      message: /non-empty array/u,
    },
    {
      input: {
        path: '/gmail/send-as/alias@example.test.json',
        operation: 'upsert' as const,
        content: JSON.stringify({ sendAsEmail: 'different@example.test', signature: 'Ambiguous' }),
      },
      message: /must match the target id/u,
    },
    {
      input: {
        path: '/gmail/messages/19fb85341fbd9682.json',
        operation: 'upsert' as const,
        content: JSON.stringify({ id: 'different-message', addLabelIds: ['INBOX'] }),
      },
      message: /must match the target id/u,
    },
    {
      input: {
        path: '/gmail/labels/Label_123.json',
        operation: 'delete' as const,
        content: JSON.stringify({ name: 'not used' }),
      },
      message: /must not include a payload/u,
    },
  ];

  for (const { input, message } of invalid) {
    assert.throws(() => normalizeGoogleMailRelayfileWriteback(input), message);
  }

  assert.throws(
    () => normalizeGoogleMailRelayfileWriteback({
      path: '/gmail/messages/19fb85341fbd9682.json',
      operation: 'upsert',
      content: JSON.stringify({ raw: 'VGVzdA' }),
    }),
    /unsupported field `raw`/u,
  );
  assert.throws(
    () => normalizeGoogleMailRelayfileWriteback({
      path: '/gmail/labels/not-a-draft.json',
      operation: 'upsert',
      content: JSON.stringify({ name: 'Label' }),
    }),
    /requires a draft target/u,
  );
});

test('Google Mail Relayfile rejects operator-only SMTP material and accepts only base64url send bodies', () => {
  assert.throws(
    () => normalizeGoogleMailRelayfileWriteback({
      path: '/gmail/send-as/create-alias.json',
      operation: 'upsert',
      content: JSON.stringify({ sendAsEmail: 'alias@example.test', smtpMsa: { password: 'never-store-this' } }),
    }),
    /operator-only/u,
  );
  assert.throws(
    () => normalizeGoogleMailRelayfileWriteback({
      path: '/gmail/messages/draft-outbound.json',
      operation: 'upsert',
      content: JSON.stringify({ raw: 'not base64!' }),
    }),
    /base64url/u,
  );

  const send = normalizeGoogleMailRelayfileWriteback({
    path: '/gmail/messages/draft-outbound.json',
    operation: 'upsert',
    content: JSON.stringify({ raw: 'RnJvbTogYWdlbnRAZXhhbXBsZS50ZXN0Cg', threadId: '19fb85341fbd9682' }),
  });
  assert.equal(send.action, 'send_message');
  assert.equal(send.target.canonicalPath, null);
  assert.equal(send.reconciliation.targetId, '19fb85341fbd9682');

  const paddedSend = normalizeGoogleMailRelayfileWriteback({
    path: '/gmail/messages/draft-padded.json',
    operation: 'upsert',
    content: JSON.stringify({ raw: 'VGVzdA==' }),
  });
  assert.equal(paddedSend.body?.raw, 'VGVzdA==');
  assert.throws(
    () => normalizeGoogleMailRelayfileWriteback({
      path: '/gmail/messages/draft-invalid-padding.json',
      operation: 'upsert',
      content: JSON.stringify({ raw: 'VGVzdA=' }),
    }),
    /base64url/u,
  );
});

test('Google Mail Relayfile delete paths require resolved canonical resources', () => {
  const deletion = normalizeGoogleMailRelayfileWriteback({
    path: '/gmail/threads/19fb85341fbd9682.json',
    operation: 'delete',
  });
  assert.equal(deletion.action, 'delete_thread');
  assert.equal(deletion.body, null);
  assert.equal(deletion.safety.safety, 'destructive');
  assert.throws(
    () => normalizeGoogleMailRelayfileWriteback({
      path: '/gmail/threads/draft-delete.json',
      operation: 'delete',
    }),
    /resolved canonical target/u,
  );
});

test('Google Mail Relayfile never maps system label mutation or deletion requests', () => {
  assert.throws(
    () => normalizeGoogleMailRelayfileWriteback({
      path: '/gmail/labels/INBOX.json',
      operation: 'upsert',
      content: JSON.stringify({ labelListVisibility: 'labelHide' }),
    }),
    /system labels cannot be updated/u,
  );
  assert.throws(
    () => normalizeGoogleMailRelayfileWriteback({
      path: '/gmail/labels/BLUE_STAR.json',
      operation: 'delete',
    }),
    /system labels cannot be deleted/u,
  );
});

test('Google Mail Relayfile rejects Gmail-invalid or ambiguous label and send-as mutations', () => {
  const invalid = [
    {
      input: {
        path: '/gmail/messages/19fb85341fbd9682.json',
        operation: 'upsert' as const,
        content: JSON.stringify({ addLabelIds: ['DRAFT'] }),
      },
      message: /Gmail-managed label/u,
    },
    {
      input: {
        path: '/gmail/threads/19fb85341fbd9682.json',
        operation: 'upsert' as const,
        content: JSON.stringify({ addLabelIds: ['STARRED'], removeLabelIds: ['STARRED'] }),
      },
      message: /cannot add and remove/u,
    },
    {
      input: {
        path: '/gmail/filters/draft-newsletter.json',
        operation: 'upsert' as const,
        content: JSON.stringify({ criteria: { sizeComparison: 'larger' }, action: { addLabelIds: ['STARRED'] } }),
      },
      message: /requires size/u,
    },
    {
      input: {
        path: '/gmail/send-as/alias@example.test.json',
        operation: 'upsert' as const,
        content: JSON.stringify({ isDefault: false }),
      },
      message: /may only be true/u,
    },
    {
      input: {
        path: '/gmail/labels/create-project.json',
        operation: 'upsert' as const,
        content: JSON.stringify({ name: 'Project', textColor: '#010203' }),
      },
      message: /requires both textColor and backgroundColor/u,
    },
    {
      input: {
        path: '/gmail/labels/create-project.json',
        operation: 'upsert' as const,
        content: JSON.stringify({ name: 'Project', textColor: '#010203', backgroundColor: '#ffffff' }),
      },
      message: /predefined values/u,
    },
    {
      input: {
        path: '/gmail/labels/create-project.json',
        operation: 'upsert' as const,
        content: JSON.stringify({ name: 'INBOX' }),
      },
      message: /reserved system label name/u,
    },
  ];

  for (const { input, message } of invalid) {
    assert.throws(() => normalizeGoogleMailRelayfileWriteback(input), message);
  }
});
