import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveWritebackRequest } from './writeback.js';

test('Mixpanel writeback tracks events from non-canonical draft filenames', () => {
  const request = resolveWritebackRequest(
    '/mixpanel/events/track-signup.json',
    JSON.stringify({ event: 'Signup', distinct_id: 'user-1', properties: { plan: 'pro' } }),
  );

  assert.equal(request.action, 'track_event');
  assert.equal(request.endpoint, '/track');
  assert.deepEqual(request.body, {
    event: 'Signup',
    properties: { plan: 'pro', distinct_id: 'user-1' },
  });
});

test('Mixpanel writeback creates profiles from draft filenames and preserves canonical profile writes', () => {
  const create = resolveWritebackRequest(
    '/mixpanel/profiles/draft-profile.json',
    JSON.stringify({ distinct_id: 'user-1', properties: { plan: 'pro' } }),
  );
  assert.equal(create.action, 'set_profile');
  assert.deepEqual(create.body, { $distinct_id: 'user-1', $set: { plan: 'pro' } });

  const update = resolveWritebackRequest(
    '/mixpanel/profiles/user-2.json',
    JSON.stringify({ properties: { plan: 'team' } }),
  );
  assert.equal(update.action, 'set_profile');
  assert.deepEqual(update.body, { $distinct_id: 'user-2', $set: { plan: 'team' } });
});
