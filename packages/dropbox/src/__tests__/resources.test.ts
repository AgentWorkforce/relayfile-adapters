import assert from 'node:assert/strict';
import test from 'node:test';

import { findResourceByPath } from '../resources.js';

test('dropbox files/folders resource matching excludes auxiliary paths', () => {
  assert.equal(findResourceByPath('/dropbox/files/report__id%3A1.json')?.name, 'files');
  assert.equal(findResourceByPath('/dropbox/folders/finance__id%3A2.json')?.name, 'folders');

  assert.equal(findResourceByPath('/dropbox/files/_index.json'), undefined);
  assert.equal(findResourceByPath('/dropbox/files/by-id/id%3A1.json'), undefined);
  assert.equal(findResourceByPath('/dropbox/files/by-path/team/report.pdf.json'), undefined);
  assert.equal(findResourceByPath('/dropbox/folders/by-path/team/docs.json'), undefined);
});

test('dropbox shared resources match canonical and by-id alias paths', () => {
  assert.equal(findResourceByPath('/dropbox/shared-folders/845281924.json')?.name, 'shared-folders');
  assert.equal(
    findResourceByPath('/dropbox/shared-folders/by-id/845281924.json')?.name,
    'shared-folders',
  );
  assert.equal(
    findResourceByPath('/dropbox/shared-links/by-id/url_1234567890abcdef.json')?.name,
    'shared-links',
  );
});
