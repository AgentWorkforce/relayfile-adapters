# File-Native Writeback Migration

## Breaking change

`new.json` is no longer a reserved create path. Do not write to paths like `/linear/issues/new.json`, `/slack/channels/<channelId>/messages/new.json`, or `/github/repos/<owner>/<repo>/pulls/<pullNumber>/reviews/new.json`.

Creates are now file-native: write a valid JSON document to any filename in the target resource directory whose basename does not match that resource's canonical `idPattern`. A filename with a space, such as `create request.json`, is non-canonical for every writable adapter resource currently published by this repo, so it is a safe migration example. Teams may still choose descriptive names like `review request.json` or `customer escalation.json`; the only requirement is that the filename must not match the resource's canonical ID pattern.

Some generated discovery inputs still contain endpoint-looking strings such as `/linear/issues/new.json`. Treat those as legacy discovery labels only. They are not a runtime contract and do not give `new.json` any create privilege.

## File-native operations

Read existing records by opening canonical resource files:

```bash
cat /linear/issues/<uuid>.json
```

Edit existing records by writing mutable fields to the canonical file. The runtime classifies the path as a patch when the basename matches the resource's `idPattern`.

```bash
printf '%s\n' '{"title":"Updated title"}' > /linear/issues/<uuid>.json
```

Create records by writing the create payload to a non-canonical filename in the resource directory. The adapter creates the provider record, writes the canonical `<real-id>.json` file, and records status for the draft path.

```bash
printf '%s\n' '{"teamId":"<team-id>","title":"New issue"}' > "/linear/issues/create request.json"
```

Delete records by removing a canonical resource file. Delete events on non-canonical draft files are ignored rather than treated as provider deletes.

```bash
rm /linear/issues/<uuid>.json
```

## Discovering payload shape

Each writable resource publishes discovery metadata in the adapter package:

- `src/resources.ts` declares the resource path, schema path, create example path, and canonical `idPattern`.
- `<adapter>/discovery/<resource>/.schema.json` is the full synced record schema. Fields with `"readOnly": true` are server-managed and rejected on writes.
- `<adapter>/discovery/<resource>/.create.example.json` is the minimal create payload. Use it as the starting point for non-canonical draft files.

For example, before creating a Linear issue, read `packages/linear/discovery/linear/issues/.schema.json` and `packages/linear/discovery/linear/issues/.create.example.json`, then write the create document to `/linear/issues/create request.json`.

## Writeback status

Validation and adapter failures are surfaced through `relayfile writeback status`. The status stream records the path, operation, outcome, optional error and field, and timestamp. Outcomes are:

- `ok` for accepted writebacks.
- `validation_failed` for schema problems such as missing required fields, unknown fields when `additionalProperties: false`, type mismatches, or invalid enum values.
- `readonly_rejected` when a payload includes a field marked `readOnly` in the schema.
- `adapter_error` when the adapter or provider rejects an otherwise routed writeback.

Use the status surface before retrying a write. For example, if a create fails because `teamId` is missing, update the non-canonical draft file with the required field and write it again.

## Adapter migration table

| Adapter | Canonical ID pattern | Example create draft path |
|---|---|---|
| Asana | `^(?:[A-Za-z0-9_.~-]+--)?\d+$` | `/asana/tasks/<draft>.json` |
| ClickUp | `^(?:[A-Za-z0-9_.~-]+--)?[A-Za-z0-9_]+$` | `/clickup/lists/<listId>/tasks/<draft>.json` |
| GitHub | `^\d+$` | `/github/repos/<owner>/<repo>/pulls/<pullNumber>/reviews/<draft>.json` |
| GitLab | `^[A-Za-z0-9_.:-]+$` | `/gitlab/projects/<namespace>/<project>/merge_requests/<iid>/discussions/<draft>.json` |
| HubSpot | `^(?:[A-Za-z0-9_.~-]+--)?\d+$` | `/hubspot/contacts/<draft>.json` |
| Intercom | `^[A-Za-z0-9_-]+$` | `/intercom/conversations/<draft>.json` |
| Jira | comments: `^(?:[A-Za-z0-9_.~-]+--)?\d+$`; issues/projects: bare `KEY-123` or `\d+`, slug-prefixed forms also canonical | `/jira/issues/<draft>.json` |
| Linear | `^(?:[A-Za-z0-9_.~-]+(?:--\|__))?[0-9a-f]{32}$` (or canonical UUID) | `/linear/issues/<draft>.json` |
| Notion | `^(?:[A-Za-z0-9_.~-]+(?:--\|__))?[0-9a-f]{32}$` (or canonical UUID) | `/notion/databases/<databaseId>/pages/<draft>.json` |
| Pipedrive | `^(?:[A-Za-z0-9_.~-]+--)?\d+$` | `/pipedrive/deals/<draft>.json` |
| Salesforce | `^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$` | `/salesforce/accounts/<draft>.json` |
| Slack | `^[A-Za-z0-9_.:-]+(?:--[A-Za-z0-9_.:-]+)*$` | `/slack/channels/<channelId>/messages/<draft>.json` |
| Teams | `^[A-Za-z0-9_.=!-]+$` | `/teams/<teamId>/channels/<channelId>/messages/<draft>.json` |
| Zendesk | `^\d+$` | `/zendesk/tickets/<draft>.json` |
