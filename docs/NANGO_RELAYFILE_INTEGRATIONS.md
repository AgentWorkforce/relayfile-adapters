# Relayfile Nango Integration Runbook

This runbook records the provider config keys, scope requirements, webhook actions, and dryrun lessons from the Relayfile Nango integration work. Use it together with `docs/integration-scopes.yaml`, which is the machine-readable scope catalog.

## Provider Config Keys

| Provider | Canonical Nango provider config key | Legacy or related keys | Notes |
|---|---|---|---|
| GitHub | `github-relay` | `github-sage` in older cloud aliases | Used for repository, issue, PR, and repository webhook actions. |
| Confluence | `confluence-relay` | None currently documented | Used for Confluence space and page syncs. |
| Jira | `jira-relay` | `jira-sage` in older cloud aliases | Used for Jira project and issue syncs plus dynamic webhook actions. |
| Linear | `linear-relay` | `linear-sage` | New connections should use `linear-relay`; existing production connections can still resolve to `linear-sage`, so webhook actions should remain registered under both until stored provider ids are migrated. |

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
