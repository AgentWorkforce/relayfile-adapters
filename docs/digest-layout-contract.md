# Relayfile Digest And Layout Contract

Relayfile adapters expose provider records as an agent-facing filesystem. A
record that can be written, synced, or received through a webhook must be
discoverable through the provider's natural lookup aliases. Activity digest
rendering is generic upstream over Relayfile workspace events; adapters do not
own provider-specific digest bullet rendering and are not required to ship
per-provider `digest()` handlers.

Run the contract check with:

```bash
npm run test:digest-contracts
```

## Baseline Digest Contract

Every provider package under `packages/<provider>` must:

- Preserve enough stable metadata in records, indexes, and aliases for the
  upstream generic digest renderer to group provider activity by path, title,
  update time, state/status, and owner fields where the provider exposes them.
- Preserve terminal lifecycle state in webhook ingestion unless the upstream
  object was actually deleted.
- Keep provider layout manifests aligned with the category matrix below so the
  generic renderer and human readers can discover provider-specific lifecycle
  and ownership buckets without adapter-owned bullet code.

Adapters may keep existing digest helpers temporarily for compatibility, but the
contract check must not require them, their package-barrel exports, provider
`DigestSection` output, or provider-specific bullet tests.

## Category Matrix

These category rules are enforced by `scripts/digest-layout-contracts.mjs`.

| Category | Providers/resources | Required lookup | Rationale |
| --- | --- | --- | --- |
| issue-tracking | GitHub issues and pull requests, GitLab issues and merge requests, Jira issues, Linear issues | `by-state/<state>/<id>.json`, `by-assignee/<assignee>/<id>.json`, `by-creator/<creator>/<id>.json`, `by-priority/<priority>/<id>.json` | Agents often ask for open, closed, merged, completed, canceled, assigned, created-by, or priority-scoped work without already knowing an id. |
| task-management | Asana tasks, ClickUp tasks | `by-state/<state>/<id>.json`, `by-assignee/<assignee>/<id>.json`, `by-creator/<creator>/<id>.json`, `by-priority/<priority>/<id>.json` | Task systems expose the same operational questions as issue trackers: what is open or completed, who owns it, who created it, and what priority bucket it sits in. |
| ci-deploy | GitLab pipelines and deployments | `by-status/<status>/<id>.json` | Status is the primary lifecycle bucket for build and deploy resources. |
| knowledge | Confluence pages | `by-state/<state>/<id>.json` | Pages can be current, archived, trashed, restored, or deleted and must remain discoverable by lifecycle bucket. |

Resources outside this matrix only need a `by-state`, `by-status`,
`by-assignee`, `by-creator`, or `by-priority` alias when the resource exposes a
durable bucket that agents naturally browse by. Add the resource to the matrix
when that is true; do not rely on prose alone.

## Review Checklist

When adding or materially changing an adapter:

1. Update webhook/record metadata so terminal lifecycle state remains data
   rather than being mis-modeled as deletion.
2. Update the layout manifest when the provider exposes a category lookup such
   as state, status, parent, key, name, or title.
3. Add the provider/resource to the category matrix above and to
   `scripts/digest-layout-contracts.mjs` when the category behavior should be
   enforced across future work.
4. Run `npm run test:digest-contracts` before opening or updating the PR.
