# Relayfile Nango Integration Runbook

This runbook records the provider config keys, scope requirements, webhook actions, and dryrun lessons from the Relayfile Nango integration work. Use it together with `docs/integration-scopes.yaml`, which is the machine-readable scope catalog.

## Provider Config Keys

| Provider | Canonical Nango provider config key | Legacy or related keys | Notes |
|---|---|---|---|
| GitHub | `github-relay` | `github-sage` in older cloud aliases | Used for repository, issue, PR, and repository webhook actions. |
| Confluence | `confluence-relay` | None currently documented | Used for Confluence space and page syncs. |
| Jira | `jira-relay` | `jira-sage` in older cloud aliases | Used for Jira project and issue syncs plus dynamic webhook actions. |
| Linear | `linear-relay` | `linear-sage` | New connections should use `linear-relay`; existing production connections can still resolve to `linear-sage`, so webhook actions should remain registered under both until stored provider ids are migrated. |
| Slack | `slack-relay` | `slack-sage` | New connections should use `slack-relay`; existing production connections can still resolve to `slack-sage`, so incoming webhook actions should remain registered under both until stored provider ids are migrated. |

When validating against production, pass `-e production`. Set `NANGO_SECRET_KEY_PRODUCTION` in the shell environment before running the CLI.

```bash
npx nango dryrun <sync-or-action> <connection-id> \
  --integration-id <provider-config-key> \
  -e production \
  --no-interactive \
  --no-dependency-update \
  --validate
```

For legacy Linear connections, first try without `--integration-id`; Nango may infer `linear-sage`. If the local project only registers `linear-relay`, add or keep a `linear-sage` action alias for compatibility.

For legacy Slack connections, first try without `--integration-id`; Nango may infer `slack-sage`. If the local project only registers `slack-relay`, add or keep a `slack-sage` action alias for compatibility.

## Relayfile Writeback Contract

Relayfile file writes should not call Nango actions directly. A write to `/jira`, `/linear`, `/slack`, `/github`, or another adapter namespace should first resolve inside this repository through the adapter's writeback resolver, then the Cloud bridge should send the resolved request through the backend provider proxy.

This keeps provider semantics in the adapter packages:

| Provider | Adapter-owned resolver | Proxy request shape | Cloud bridge responsibility |
|---|---|---|---|
| GitHub | `@relayfile/adapter-github/writeback` | GitHub REST paths such as `/repos/{owner}/{repo}/pulls/{pullNumber}/reviews` | Add GitHub REST headers and call Nango proxy with `github-relay`. |
| Jira | `@relayfile/adapter-jira/writeback` | Jira REST paths such as `/rest/api/3/issue` and `/rest/agile/1.0/sprint/{sprintId}` | Prefix Atlassian OAuth paths as `/ex/jira/{cloudId}` from Nango connection metadata, then call Nango proxy with `jira-relay`. |
| Linear | `@relayfile/adapter-linear/writeback` | Linear GraphQL `POST /graphql` mutations for issue and comment create/update/delete | Call Nango proxy with `linear-relay` and inspect GraphQL `errors` plus mutation `success`. |
| Slack | `@relayfile/adapter-slack/writeback` | Slack Web API paths such as `/api/chat.postMessage` and `/api/reactions.add` | Normalize the `/api/` prefix for Nango's Slack proxy convention, then call Nango proxy with `slack-relay`. |
| Notion | `@relayfile/adapter-notion/writeback` | Notion REST paths such as `/v1/pages` | Add the Notion API version header and call Nango proxy with `notion-relay`. |

Nango actions are still useful for explicit control-plane work: listing, registering, updating, or deleting provider webhooks; reading Slack incoming-webhook installation metadata; or running isolated dryruns against provider APIs. They should not become the source of truth for file-native writeback behavior. If a webhook registration flow should become file-native later, add it as a writable resource here first: update `src/resources.ts`, schemas, create examples, `.adapter.md`, resolver tests, `scripts/writeback-discovery-data.mjs`, regenerate discovery, and only then wire Cloud to proxy the adapter-produced request.

## GitHub Repository Webhooks

Relayfile's `github-relay` actions should use GitHub REST API version `2026-03-10` and send these headers:

```json
{
  "Accept": "application/vnd.github+json",
  "X-GitHub-Api-Version": "2026-03-10"
}
```

The repository webhook actions map directly to GitHub's REST endpoints:

| Action | GitHub endpoint | Permission |
|---|---|---|
| List repository webhooks | `GET /repos/{owner}/{repo}/hooks` | Repository Webhooks read |
| Get repository webhook | `GET /repos/{owner}/{repo}/hooks/{hook_id}` | Repository Webhooks read |
| Create repository webhook | `POST /repos/{owner}/{repo}/hooks` | Repository Webhooks write |
| Update repository webhook | `PATCH /repos/{owner}/{repo}/hooks/{hook_id}` | Repository Webhooks write |
| Delete repository webhook | `DELETE /repos/{owner}/{repo}/hooks/{hook_id}` | Repository Webhooks write |
| Ping repository webhook | `POST /repos/{owner}/{repo}/hooks/{hook_id}/pings` | Repository Webhooks read |
| Test push repository webhook | `POST /repos/{owner}/{repo}/hooks/{hook_id}/tests` | Repository Webhooks read |

For GitHub App installations, grant repository **Webhooks: read/write** in addition to the adapter's existing Metadata, Contents, Issues, Pull requests, and Checks permissions. For classic OAuth tokens, `repo` covers the private repository surface broadly, while `admin:repo_hook` is the narrower repository-hook administration scope when hook management is the only extra surface needed.

Source: https://docs.github.com/en/rest/repos/webhooks?apiVersion=2026-03-10

## Jira Dynamic Webhooks

Relayfile's Jira webhook actions should use `jira-relay` and Jira Cloud OAuth dynamic webhooks through the Atlassian OAuth gateway:

```text
/ex/jira/{cloudId}/rest/api/3/webhook
```

Do not use the legacy admin endpoint `/rest/webhooks/1.0/webhook` for OAuth connections; production dryrun rejected that surface with a scope mismatch. With the updated production Jira connection, listing dynamic webhooks through `/rest/api/3/webhook` succeeded and returned an empty list.

Minimum classic scopes for the current Relayfile Jira surface include:

- `read:jira-work`
- `write:jira-work`
- `read:jira-user`
- `manage:jira-project`
- `manage:jira-configuration`
- `manage:jira-webhook`
- `offline_access`

For granular OAuth configurations, map the dynamic webhook actions to Atlassian's webhook read/write/delete scopes and the supporting JQL, field, and project read scopes.

Source: https://developer.atlassian.com/cloud/jira/platform/webhooks/#registering-a-webhook-using-the-jira-rest-api--other-integrations-

## Linear Webhooks

Relayfile's canonical Linear provider config key is `linear-relay`, but existing production connections may resolve to `linear-sage`. Keep the same webhook actions registered under both keys until old provider ids are migrated.

Minimum scopes for the current Linear adapter and webhook action surface:

- `read`
- `write`
- `admin`

`admin` is required for webhook management. A production dryrun using an existing legacy Linear connection reached Linear GraphQL after adding the `linear-sage` alias, then failed with `Invalid role: admin required`. That means the connection exists and the action path is correct, but the connected Linear account or app role must be admin-capable before list/create/delete webhook actions can succeed.

Source: https://linear.app/developers/webhooks

## Slack Incoming Webhooks

Relayfile's canonical Slack provider config key is `slack-relay`, but existing production connections may resolve to `slack-sage`. Keep incoming webhook actions registered under both keys until old provider ids are migrated.

Slack incoming webhooks are provisioned during OAuth installation with the `incoming-webhook` scope. There is no later REST endpoint that registers an incoming webhook URL for an already-installed OAuth connection. During installation, Slack asks the installer to choose the destination channel and returns an `incoming_webhook` object containing the webhook URL and channel metadata.

Minimum scopes for the current Slack adapter and incoming webhook action surface include:

- `channels:history`
- `channels:read`
- `groups:history`
- `groups:read`
- `im:history`
- `im:read`
- `mpim:history`
- `mpim:read`
- `team:read`
- `users:read`
- `users:read.email`
- `chat:write`
- `incoming-webhook`

The webhook URL is a secret. Nango actions should never return it to callers or write it to logs. A safe `get-incoming-webhook` action should only report metadata such as whether a webhook exists, the selected channel id, and the Slack configuration URL. A `send-incoming-webhook` action can post by reading the stored URL from the Nango connection metadata and sending the message payload directly to Slack.

Production dryrun reached the legacy `slack-sage` connection and returned `hasIncomingWebhook: false`, which means the connection exists but was not installed with an incoming webhook URL available to Nango. Reconnect the Slack OAuth app with `incoming-webhook` included and choose a channel before send actions can post.

Source: https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/

## Confluence Server/Data Center Webhooks

Relayfile's `confluence-relay` webhook actions for registration use the Confluence Server/Data Center REST API, not Confluence Cloud dynamic webhooks:

| Action | Confluence endpoint | Runtime requirement |
|---|---|---|
| List webhooks | `GET /rest/api/webhooks` | Confluence administrator on Server/Data Center |
| Get webhook | `GET /rest/api/webhooks/{webhookId}` | Confluence administrator on Server/Data Center |
| Register webhook | `POST /rest/api/webhooks` | Confluence administrator on Server/Data Center |
| Update webhook | `PUT /rest/api/webhooks/{webhookId}` | Confluence administrator on Server/Data Center |
| Delete webhook | `DELETE /rest/api/webhooks/{webhookId}` | Confluence administrator on Server/Data Center |
| Test webhook endpoint | `POST /rest/api/webhooks/test?url={url}` | Confluence administrator on Server/Data Center |

Atlassian's REST reference says this resource is administrator-only and that Forge and OAuth2 apps cannot access it. That means there is no Confluence Cloud OAuth scope to add to make these actions work for a normal `confluence-relay` Cloud OAuth connection. A production dryrun with an existing Confluence Cloud OAuth connection compiled and reached the provider call, then failed with `404 No endpoint GET /rest/api/webhooks`, which is the expected shape for Cloud OAuth. Live webhook registration needs an administrator-capable Server/Data Center connection whose `baseUrl` points at the Confluence instance.

Source: https://developer.atlassian.com/server/confluence/rest/v921/api-group-webhooks/

## Confluence Page Syncs

Relayfile's Confluence provider config key is `confluence-relay`. The page sync needs detailed page body access, so `read:confluence-content.summary` is not enough by itself. In the classic Confluence scope model, include `read:confluence-content.all`; for a newer granular page-focused implementation, check `read:page:confluence`.

Current verified Confluence scopes:

- `write:confluence-content`
- `read:confluence-space.summary`
- `write:confluence-space`
- `read:confluence-content.all`
- `read:confluence-content.summary`
- `search:confluence`
- `read:confluence-user`
- `read:confluence-groups`
- `write:confluence-groups`

Production validation used the updated Confluence connection supplied during the Nango implementation work.

Source: https://developer.atlassian.com/cloud/confluence/scopes-for-oauth-2-3LO-and-forge-apps/

## Template Reference

When adding or changing Nango functions, compare the local implementation against the Nango integration templates where available:

- https://github.com/NangoHQ/integration-templates/
- https://raw.githubusercontent.com/NangoHQ/nango/master/packages/providers/providers.yaml

Keep dryrun fixtures and tests free of access tokens, account ids, email addresses, and webhook secrets. Existing OAuth connections must reconnect after scope changes because providers generally do not retroactively grant newly requested scopes to old tokens.
