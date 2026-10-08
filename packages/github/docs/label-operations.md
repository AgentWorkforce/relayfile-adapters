# Confirmed label operations

`@relayfile/adapter-github/labels` exports `confirmGitHubLabelOperation` for
consumers with a resolved GitHub label request and their own authenticated
transport. It supports `ensure_repository_label`, `add_issue_label`, and
`remove_issue_label` actions. It accepts any label name; application-specific
allowlists, colors, draft paths, credentials, and persistence stay with the caller.
This helper does not register new file-native writeback paths or resources.

```ts
import { confirmGitHubLabelOperation } from '@relayfile/adapter-github/labels';

const result = await confirmGitHubLabelOperation({
  request: {
    action: 'add_issue_label',
    method: 'POST',
    endpoint: '/repos/acme/widgets/issues/42/labels',
    body: { labels: ['triaged'] },
  },
  proxy: authenticatedGitHubProxy,
});

if (!result.confirmed) throw new Error('Label change was not confirmed');
```

The proxy receives `{ action, method, endpoint, headers?, body? }` and returns
`{ ok, status, data }`. Extra response fields, such as headers or diagnostic
context, are retained in the result. The proxy should supply the GitHub API
headers and credentials it requires. Requests remain relative to GitHub;
this helper does not own an HTTP client or select a workspace connection.

An ensure request posts `{ name, color, description }` to `/repos/:owner/:repo/labels`.
On an `already_exists` 422, the helper reads the label, repairs drifted definitions
with PATCH, and confirms the returned definition. Colors are six hex digits;
a description may be empty. An add request posts exactly one name in `labels`
to `/repos/:owner/:repo/issues/:number/labels`. A removal request deletes
`/repos/:owner/:repo/issues/:number/labels/:encodedName` and confirms that label
is absent without replacing any other labels. A removal 404 is successful only
when a readable issue confirms the label is absent.

Check `result.confirmed` before acknowledging or persisting the operation.
`result.reason` explains an unconfirmed HTTP success; a non-success HTTP response
is returned intact for the caller's error classification. Transport errors
propagate. Writes are not automatically retried: a network failure can occur
after GitHub has applied the mutation.
