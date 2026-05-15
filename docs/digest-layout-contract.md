# Relayfile Digest And Layout Contract

Relayfile adapters expose provider records as an agent-facing filesystem. A
record that can be written, synced, or received through a webhook must also be
discoverable through the activity digest and through the provider's natural
lookup aliases.

Run the contract check with:

```bash
npm run test:digest-contracts
```

## Baseline Digest Contract

Every provider package under `packages/<provider>` must:

- Export `src/digest.ts` from `src/index.ts`.
- Scope digest reads with `ctx.changeEvents({ providers: [ctx.provider] })`.
- Return deterministic bullets sorted by event time and id.
- Test create/update behavior, provider lifecycle behavior, delete or terminal
  behavior, deterministic ordering, and empty windows.
- Preserve terminal lifecycle state in webhook ingestion unless the upstream
  object was actually deleted.

No-op digest handlers are not a shipping pattern. A provider that intentionally
does not appear in digests must document the exception and keep that exclusion
covered by a test.

Append-only providers are a narrow exception to the delete-or-terminal portion
of lifecycle coverage. Segment is currently the only enforced exception:
records are immutable once written, so its digest contract must explicitly
classify append/upsert activity and document the append-only behavior in
`src/digest.ts`.

## Category Matrix

These category rules are enforced by `scripts/digest-layout-contracts.mjs`.

| Category | Providers/resources | Required lookup | Rationale |
| --- | --- | --- | --- |
| issue-tracking | GitHub issues and pull requests, GitLab issues and merge requests, Jira issues, Linear issues | `by-state/<state>/<id>.json`, `by-assignee/<assignee>/<id>.json`, `by-creator/<creator>/<id>.json`, `by-priority/<priority>/<id>.json` | Agents often ask for open, closed, merged, completed, canceled, assigned, created-by, or priority-scoped work without already knowing an id. |
| ci-deploy | GitLab pipelines and deployments | `by-status/<status>/<id>.json` | Status is the primary lifecycle bucket for build and deploy resources. |
| knowledge | Confluence pages | `by-state/<state>/<id>.json` | Pages can be current, archived, trashed, restored, or deleted and must remain discoverable by lifecycle bucket. |

Resources outside this matrix still need digest coverage. They only need a
`by-state`, `by-status`, `by-assignee`, `by-creator`, or `by-priority` alias
when the resource exposes a durable bucket that agents naturally browse by. Add
the resource to the matrix when that is true; do not rely on prose alone.

## Review Checklist

When adding or materially changing an adapter:

1. Update the adapter digest handler and tests.
2. Update the layout manifest when the provider exposes a category lookup such
   as state, status, parent, key, name, or title.
3. Add the provider/resource to the category matrix above and to
   `scripts/digest-layout-contracts.mjs` when the category behavior should be
   enforced across future work.
4. Run `npm run test:digest-contracts` before opening or updating the PR.
