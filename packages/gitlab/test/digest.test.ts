import assert from 'node:assert/strict';
import test from 'node:test';

import { digest, type DigestContext } from '../src/digest.js';

test('digest returns deterministic GitLab bullets sorted by event time and id', async () => {
  const ctx: DigestContext = {
    provider: 'gitlab',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents(filter) {
      assert.deepEqual(filter, { providers: ['gitlab'] });
      return [
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'closed',
          canonicalPath: 'gitlab/projects/acme/api/issues/43__remove-flake/meta.json',
        },
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'opened',
          canonicalPath: '/gitlab/projects/acme/api/merge_requests/42__add-oauth/meta.json',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'gitlab',
    bullets: [
      {
        text: 'MR !42 was opened',
        canonicalPath: 'gitlab/projects/acme/api/merge_requests/42__add-oauth/meta.json',
      },
      {
        text: 'issue #43 was closed',
        canonicalPath: 'gitlab/projects/acme/api/issues/43__remove-flake/meta.json',
      },
    ],
  });
});

test('digest classifies reopened as updated and returns null for empty windows', async () => {
  const reopened: DigestContext = {
    provider: 'gitlab',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'reopened',
          canonicalPath: 'gitlab/projects/acme/api/issues/42__add-login/meta.json',
        },
      ];
    },
  };
  assert.deepEqual(await digest(reopened), {
    provider: 'gitlab',
    bullets: [
      {
        text: 'issue #42 was updated',
        canonicalPath: 'gitlab/projects/acme/api/issues/42__add-login/meta.json',
      },
    ],
  });

  assert.equal(
    await digest({
      provider: 'gitlab',
      window: reopened.window,
      async changeEvents() {
        return [];
      },
    }),
    null,
  );
});

test('digest classifies merged merge requests distinctly from closed issues', async () => {
  const ctx: DigestContext = {
    provider: 'gitlab',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'merged',
          canonicalPath: 'gitlab/projects/acme/api/merge_requests/42__ship-it/meta.json',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'gitlab',
    bullets: [
      {
        text: 'MR !42 was merged',
        canonicalPath: 'gitlab/projects/acme/api/merge_requests/42__ship-it/meta.json',
      },
    ],
  });
});

test('digest classifies canceled GitLab pipeline lifecycle states', async () => {
  const ctx: DigestContext = {
    provider: 'gitlab',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'pipeline.canceled',
          canonicalPath: 'gitlab/projects/acme/api/pipelines/1001__main/meta.json',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'gitlab',
    bullets: [
      {
        text: 'pipeline #1001 was canceled',
        canonicalPath: 'gitlab/projects/acme/api/pipelines/1001__main/meta.json',
      },
    ],
  });
});

test('digest classifies failed and skipped GitLab pipeline lifecycle states', async () => {
  const ctx: DigestContext = {
    provider: 'gitlab',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'pipeline.failed',
          canonicalPath: 'gitlab/projects/acme/api/pipelines/1001__main/meta.json',
        },
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'pipeline.skipped',
          canonicalPath: 'gitlab/projects/acme/api/pipelines/1002__docs/meta.json',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'gitlab',
    bullets: [
      {
        text: 'pipeline #1001 failed',
        canonicalPath: 'gitlab/projects/acme/api/pipelines/1001__main/meta.json',
      },
      {
        text: 'pipeline #1002 was skipped',
        canonicalPath: 'gitlab/projects/acme/api/pipelines/1002__docs/meta.json',
      },
    ],
  });
});

test('digest classifies created GitLab pipeline, deployment, and job events', async () => {
  const ctx: DigestContext = {
    provider: 'gitlab',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-pipeline',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'pipeline.created',
          canonicalPath: 'gitlab/projects/acme/api/pipelines/1001__main/meta.json',
        },
        {
          id: 'evt-deployment',
          timestamp: '2026-05-12T08:01:00.000Z',
          action: 'deployment.created',
          canonicalPath: 'gitlab/projects/acme/api/deployments/production__14.json',
        },
        {
          id: 'evt-job',
          timestamp: '2026-05-12T08:02:00.000Z',
          action: 'job.created',
          canonicalPath: 'gitlab/projects/acme/api/pipelines/1001__main/jobs/77.json',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'gitlab',
    bullets: [
      {
        text: 'pipeline #1001 was created',
        canonicalPath: 'gitlab/projects/acme/api/pipelines/1001__main/meta.json',
      },
      {
        text: 'deployment #14 was created',
        canonicalPath: 'gitlab/projects/acme/api/deployments/production__14.json',
      },
      {
        text: 'job #77 was created',
        canonicalPath: 'gitlab/projects/acme/api/pipelines/1001__main/jobs/77.json',
      },
    ],
  });
});

test('digest classifies GitLab lifecycle states from record content', async () => {
  const ctx: DigestContext = {
    provider: 'gitlab',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-issue',
          timestamp: '2026-05-12T08:00:00.000Z',
          type: 'file.updated',
          canonicalPath: 'gitlab/projects/acme/api/issues/43__remove-flake/meta.json',
          content: { state: 'closed' },
        },
        {
          id: 'evt-job',
          timestamp: '2026-05-12T09:00:00.000Z',
          type: 'file.updated',
          canonicalPath: 'gitlab/projects/acme/api/pipelines/1001__main/jobs/77.json',
          content: { status: 'failed' },
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'gitlab',
    bullets: [
      {
        text: 'issue #43 was closed',
        canonicalPath: 'gitlab/projects/acme/api/issues/43__remove-flake/meta.json',
      },
      {
        text: 'job #77 failed',
        canonicalPath: 'gitlab/projects/acme/api/pipelines/1001__main/jobs/77.json',
      },
    ],
  });
});

test('digest classifies GitLab pipeline jobs as jobs, not parent pipelines', async () => {
  const ctx: DigestContext = {
    provider: 'gitlab',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'job.failed',
          canonicalPath: 'gitlab/projects/acme/api/pipelines/1001__main/jobs/77.json',
        },
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'job.success',
          canonicalPath: 'gitlab/projects/acme/api/pipelines/1001__main/jobs/78.json',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'gitlab',
    bullets: [
      {
        text: 'job #77 failed',
        canonicalPath: 'gitlab/projects/acme/api/pipelines/1001__main/jobs/77.json',
      },
      {
        text: 'job #78 succeeded',
        canonicalPath: 'gitlab/projects/acme/api/pipelines/1001__main/jobs/78.json',
      },
    ],
  });
});

test('digest preserves complex GitLab tag refs with slashes and double underscores', async () => {
  const ctx: DigestContext = {
    provider: 'gitlab',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'tag_push',
          canonicalPath: 'gitlab/projects/acme/api/tags/release-foo-bar__release%2Ffoo__bar.json',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'gitlab',
    bullets: [
      {
        text: 'tag release/foo__bar was updated',
        canonicalPath: 'gitlab/projects/acme/api/tags/release-foo-bar__release%2Ffoo__bar.json',
      },
    ],
  });
});

test('digest suppresses legacy GitLab tag cleanup paths', async () => {
  const ctx: DigestContext = {
    provider: 'gitlab',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-fixed-canonical',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'deleted',
          canonicalPath: 'gitlab/projects/acme/api/tags/release-foo-bar__release%2Ffoo__bar.json',
        },
        {
          id: 'evt-fixed-alias',
          timestamp: '2026-05-12T08:00:01.000Z',
          action: 'deleted',
          canonicalPath: 'gitlab/projects/acme/api/tags/by-ref/release-foo-bar__release%2Ffoo__bar.json',
        },
        {
          id: 'evt-legacy-canonical',
          timestamp: '2026-05-12T08:00:02.000Z',
          action: 'deleted',
          canonicalPath: 'gitlab/projects/acme/api/tags/release/foo__bar.json',
        },
        {
          id: 'evt-legacy-alias',
          timestamp: '2026-05-12T08:00:03.000Z',
          action: 'deleted',
          canonicalPath: 'gitlab/projects/acme/api/tags/by-ref/release/foo__bar.json',
        },
        {
          id: 'evt-full-ref-canonical',
          timestamp: '2026-05-12T08:00:04.000Z',
          action: 'deleted',
          canonicalPath: 'gitlab/projects/acme/api/tags/refs-tags-release-foo-bar__refs%2Ftags%2Frelease%2Ffoo__bar.json',
        },
        {
          id: 'evt-full-ref-alias',
          timestamp: '2026-05-12T08:00:05.000Z',
          action: 'deleted',
          canonicalPath: 'gitlab/projects/acme/api/tags/by-ref/refs-tags-release-foo-bar__refs%2Ftags%2Frelease%2Ffoo__bar.json',
        },
        {
          id: 'evt-legacy-flat-canonical',
          timestamp: '2026-05-12T08:00:06.000Z',
          action: 'deleted',
          canonicalPath: 'gitlab/projects/acme/api/tags/foo__bar.json',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'gitlab',
    bullets: [
      {
        text: 'tag release/foo__bar was deleted',
        canonicalPath: 'gitlab/projects/acme/api/tags/release-foo-bar__release%2Ffoo__bar.json',
      },
    ],
  });
});

test('digest ignores GitLab merge request alias paths without dropping canonical project paths', async () => {
  const ctx: DigestContext = {
    provider: 'gitlab',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-alias',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'opened',
          canonicalPath: 'gitlab/projects/acme/api/merge_requests/by-title/add-oauth__42.json',
        },
        {
          id: 'evt-canonical',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'opened',
          canonicalPath: 'gitlab/projects/org/issues/by-title/api/merge_requests/42__add-oauth/meta.json',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'gitlab',
    bullets: [
      {
        text: 'MR !42 was opened',
        canonicalPath: 'gitlab/projects/org/issues/by-title/api/merge_requests/42__add-oauth/meta.json',
      },
    ],
  });
});

test('digest identifies GitLab resources from the canonical resource segment, not project path names', async () => {
  const ctx: DigestContext = {
    provider: 'gitlab',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'opened',
          canonicalPath: 'gitlab/projects/org/merge_requests/service/issues/42__add-login/meta.json',
        },
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'pipeline.failed',
          canonicalPath: 'gitlab/projects/org/issues/by-title/service/pipelines/1001__main/meta.json',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'gitlab',
    bullets: [
      {
        text: 'issue #42 was opened',
        canonicalPath: 'gitlab/projects/org/merge_requests/service/issues/42__add-login/meta.json',
      },
      {
        text: 'pipeline #1001 failed',
        canonicalPath: 'gitlab/projects/org/issues/by-title/service/pipelines/1001__main/meta.json',
      },
    ],
  });
});

test('digest keeps canonical GitLab resources that have alias-shaped project namespace segments', async () => {
  const ctx: DigestContext = {
    provider: 'gitlab',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'updated',
          canonicalPath: 'gitlab/projects/org/issues/by-title/snippets/abc123.json',
        },
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'updated',
          canonicalPath: 'gitlab/projects/org/pipelines/by-ref/files/docs%2Fsetup.md.json',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'gitlab',
    bullets: [
      {
        text: 'snippet abc123 was updated',
        canonicalPath: 'gitlab/projects/org/issues/by-title/snippets/abc123.json',
      },
      {
        text: 'file docs%2Fsetup.md was updated',
        canonicalPath: 'gitlab/projects/org/pipelines/by-ref/files/docs%2Fsetup.md.json',
      },
    ],
  });
});

test('digest ignores GitLab aliases whose alias values look like resource names', async () => {
  const ctx: DigestContext = {
    provider: 'gitlab',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-assignee',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'updated',
          canonicalPath: 'gitlab/projects/acme/api/issues/by-assignee/files/7.json',
        },
        {
          id: 'evt-creator',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'updated',
          canonicalPath: 'gitlab/projects/acme/api/merge_requests/by-creator/snippets/8.json',
        },
      ];
    },
  };

  assert.equal(await digest(ctx), null);
});

test('digest keeps double-underscore GitLab file identifiers intact', async () => {
  const ctx: DigestContext = {
    provider: 'gitlab',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-file',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'updated',
          canonicalPath: 'gitlab/projects/acme/api/files/config%2Ffoo__bar.json',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'gitlab',
    bullets: [
      {
        text: 'file config%2Ffoo__bar was updated',
        canonicalPath: 'gitlab/projects/acme/api/files/config%2Ffoo__bar.json',
      },
    ],
  });
});

test('digest classifies GitLab deployment lifecycle states with deployment identifiers', async () => {
  const ctx: DigestContext = {
    provider: 'gitlab',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'deployment.failed',
          canonicalPath: 'gitlab/projects/acme/api/deployments/14.json',
        },
        {
          id: 'evt-2',
          timestamp: '2026-05-12T09:00:00.000Z',
          action: 'deployment.success',
          canonicalPath: 'gitlab/projects/acme/api/deployments/production__15.json',
        },
        {
          id: 'evt-3',
          timestamp: '2026-05-12T10:00:00.000Z',
          action: 'deployment.canceled',
          canonicalPath: 'gitlab/projects/acme/api/deployments/staging__16.json',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'gitlab',
    bullets: [
      {
        text: 'deployment #14 failed',
        canonicalPath: 'gitlab/projects/acme/api/deployments/14.json',
      },
      {
        text: 'deployment #15 succeeded',
        canonicalPath: 'gitlab/projects/acme/api/deployments/production__15.json',
      },
      {
        text: 'deployment #16 was canceled',
        canonicalPath: 'gitlab/projects/acme/api/deployments/staging__16.json',
      },
    ],
  });
});

test('digest classifies deleted GitLab records', async () => {
  const ctx: DigestContext = {
    provider: 'gitlab',
    window: { from: '2026-05-12T00:00:00.000Z', to: '2026-05-13T00:00:00.000Z' },
    async changeEvents() {
      return [
        {
          id: 'evt-1',
          timestamp: '2026-05-12T08:00:00.000Z',
          action: 'deleted',
          canonicalPath: 'gitlab/projects/acme/api/issues/99__cleanup/meta.json',
        },
      ];
    },
  };

  assert.deepEqual(await digest(ctx), {
    provider: 'gitlab',
    bullets: [
      {
        text: 'issue #99 was deleted',
        canonicalPath: 'gitlab/projects/acme/api/issues/99__cleanup/meta.json',
      },
    ],
  });
});
