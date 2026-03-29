# `@relayfile/adapter-gitlab`

GitLab adapter for Relayfile. It mirrors the GitHub adapter pattern, but maps GitLab merge requests, discussions, approvals, issues, commits, pipelines, jobs, deployments, and tag pushes into GitLab-specific VFS paths.

## Quick start

```ts
import { GitLabAdapter } from '@relayfile/adapter-gitlab';

const adapter = new GitLabAdapter(provider, {
  connectionId: 'gitlab-connection',
  projectPath: 'acme/api',
  webhookSecret: process.env.GITLAB_WEBHOOK_SECRET,
});

const result = await adapter.routeWebhook(payload, undefined, headers);
```

## Supported webhook events

- `merge_request.open`
- `merge_request.reopen`
- `merge_request.update`
- `merge_request.close`
- `merge_request.merge`
- `merge_request.approved`
- `merge_request.unapproved`
- `note.MergeRequest`
- `note.Issue`
- `note.Commit`
- `note.Snippet`
- `push`
- `pipeline.created`
- `pipeline.pending`
- `pipeline.running`
- `pipeline.success`
- `pipeline.failed`
- `pipeline.canceled`
- `pipeline.manual`
- `pipeline.skipped`
- `pipeline.waiting_for_resource`
- `issue.open`
- `issue.reopen`
- `issue.update`
- `issue.close`
- `deployment.created`
- `deployment.running`
- `deployment.success`
- `deployment.failed`
- `deployment.canceled`
- `build.created`
- `build.pending`
- `build.running`
- `build.success`
- `build.failed`
- `build.canceled`
- `build.manual`
- `build.skipped`
- `job.created`
- `job.pending`
- `job.running`
- `job.success`
- `job.failed`
- `job.canceled`
- `job.manual`
- `job.skipped`
- `tag_push`

## VFS path structure

```text
/gitlab/projects/{namespace}/{project}/merge_requests/{iid}/metadata.json
/gitlab/projects/{namespace}/{project}/merge_requests/{iid}/diff.patch
/gitlab/projects/{namespace}/{project}/merge_requests/{iid}/discussions/{id}.json
/gitlab/projects/{namespace}/{project}/merge_requests/{iid}/approvals.json
/gitlab/projects/{namespace}/{project}/issues/{iid}/metadata.json
/gitlab/projects/{namespace}/{project}/issues/{iid}/comments/{id}.json
/gitlab/projects/{namespace}/{project}/commits/{sha}/metadata.json
/gitlab/projects/{namespace}/{project}/commits/{sha}/comments/{id}.json
/gitlab/projects/{namespace}/{project}/snippets/{id}/comments/{id}.json
/gitlab/projects/{namespace}/{project}/pipelines/{id}/metadata.json
/gitlab/projects/{namespace}/{project}/pipelines/{id}/jobs/{id}.json
/gitlab/projects/{namespace}/{project}/deployments/{id}/metadata.json
/gitlab/projects/{namespace}/{project}/tags/{ref}/metadata.json
```

## Writeback paths

- `PUT /gitlab/projects/{namespace}/{project}/merge_requests/{iid}/metadata.json`
- `POST /gitlab/projects/{namespace}/{project}/merge_requests/{iid}/discussions/new.json`
- `PUT /gitlab/projects/{namespace}/{project}/issues/{iid}/metadata.json`
- `POST /gitlab/projects/{namespace}/{project}/issues/{iid}/comments/new.json`

## Comparison with the GitHub adapter

- GitLab uses `path_with_namespace` instead of `owner/repo`.
- Merge requests and issues use `iid`, not global IDs.
- Reviews map to two GitLab concepts: discussions and approvals.
- GitLab CI maps to pipelines and jobs instead of check suites and check runs.
- Webhook verification uses `X-Gitlab-Token`, not an HMAC signature.
