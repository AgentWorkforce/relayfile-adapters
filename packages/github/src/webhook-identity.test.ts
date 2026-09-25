import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { githubCheckRunPullRequestNumber } from '@relayfile/adapter-github/webhook-identity';

const repository = { owner: 'AgentWorkforce', repo: 'cloud' };

describe('githubCheckRunPullRequestNumber', () => {
  it('accepts a positive safe number when the entry has no URL', () => {
    assert.equal(githubCheckRunPullRequestNumber({ number: 42 }, repository), 42);
  });

  it('parses GitHub API and HTML pull-request URLs case-insensitively', () => {
    assert.equal(
      githubCheckRunPullRequestNumber(
        { url: 'https://api.github.com/repos/agentworkforce/CLOUD/pulls/91' },
        repository,
      ),
      91,
    );
    assert.equal(
      githubCheckRunPullRequestNumber(
        { html_url: 'https://github.com/AgentWorkforce/cloud/pull/92' },
        repository,
      ),
      92,
    );
  });

  it('treats a present URL as authoritative over the numeric field', () => {
    assert.equal(
      githubCheckRunPullRequestNumber(
        {
          number: 7,
          url: 'https://api.github.com/repos/AgentWorkforce/cloud/pulls/93',
        },
        repository,
      ),
      93,
    );
  });

  it('fails closed for foreign repositories and unrecognized hosts', () => {
    assert.equal(
      githubCheckRunPullRequestNumber(
        {
          number: 93,
          html_url: 'https://github.com/AgentWorkforce/other/pull/93',
        },
        repository,
      ),
      null,
    );
    assert.equal(
      githubCheckRunPullRequestNumber(
        { url: 'https://example.com/AgentWorkforce/cloud/pull/93' },
        repository,
      ),
      null,
    );
  });

  it('rejects malformed, non-HTTPS, non-canonical, and unsafe identities', () => {
    for (const entry of [
      null,
      [],
      { number: 0 },
      { number: -1 },
      { number: Number.MAX_SAFE_INTEGER + 1 },
      { url: 'not-a-url' },
      { url: 'http://api.github.com/repos/AgentWorkforce/cloud/pulls/1' },
      { url: 'https://api.github.com:444/repos/AgentWorkforce/cloud/pulls/1' },
      { url: 'https://user@api.github.com/repos/AgentWorkforce/cloud/pulls/1' },
      { url: 'https://api.github.com/repos/AgentWorkforce/cloud/issues/1' },
      { url: 'https://api.github.com/repos/AgentWorkforce/cloud/pulls/1/files' },
      { url: 'https://github.com/AgentWorkforce/cloud/pull/0' },
      { url: 'https://github.com/AgentWorkforce/cloud/pull/9007199254740992' },
    ]) {
      assert.equal(githubCheckRunPullRequestNumber(entry, repository), null);
    }
  });
});
