# Writeback Resource Patterns

Conventions adapter authors must follow when choosing the mount path shape for
a provider record. These patterns exist because relayfile workspaces are
materialized onto POSIX filesystems by the mount daemon — path shapes that are
legal in a virtual key/value namespace can be impossible to mirror on disk.

## Directory records: never emit a flat leaf where children can nest

### The collision

A record emitted as a flat leaf file

```
X/<id>.json
```

collides the moment any child resource of that record nests under the same
stem:

```
X/<id>/reactions/...
X/<id>/replies/...
```

`<id>.json` and `<id>/` are distinct keys in the virtual filesystem, but on a
POSIX mount one name cannot be both a file and a directory. The mirror fails
every sync cycle with `mkdir .../X/<id>.json: not a directory`, never completes
bootstrap, and the teardown writeback flush hangs. This is not hypothetical: it
wedged Slack mounts when thread replies were flat files
(`threads/<ts>/replies/<replyTs>.json`) while reply reactions nested under
`replies/<replyTs>/reactions/...` (see commits `dea03fc` and `f5ca1ce`,
PR #162).

### The pattern

Emit every record that has — or could plausibly grow — child resources as a
**directory record**: the stem is a directory keyed by the stable provider id,
and the canonical payload lives in a well-known file inside it:

```
X/<id>/meta.json            ← canonical record
X/<id>/reactions/...        ← children are siblings of meta.json
X/<id>/replies/...
```

Collision is then impossible by construction: the record and its children share
one directory.

"Could plausibly grow" should be read generously. If the provider's API exposes
any per-record child collection (reactions, nested replies, attachments,
statuses, history), assume a future adapter version will materialize it. The
cost of a directory record up front is one extra path segment; the cost of
migrating later is legacy-path compatibility shims forever.

Current directory-record adopters:

| Adapter | Record | Canonical path |
| --- | --- | --- |
| slack | channel message | `/slack/channels/<c>/messages/<ts>/meta.json` |
| slack | thread reply | `/slack/channels/<c>/threads/<ts>/replies/<ts>/meta.json` |
| slack | DM thread reply | `/slack/users/<u>/messages/<ts>/replies/<ts>/meta.json` |
| github | issue / pull request | `/github/repos/<o>/<r>/issues/<n>__<slug>/meta.json` |
| github | issue comment | `/github/repos/<o>/<r>/issues/<n>__<slug>/comments/<id>/meta.json` |
| linear | comment | `/linear/comments/<name>__<id>/meta.json` |

Leaf records with genuinely no child surface (index rows, alias lookups like
`by-id/<id>.json`, append-only event captures) may stay flat files.

## Migrating a flat leaf to a directory record

When an existing adapter shipped the flat shape, the migration must keep
pre-migration mirrors readable and routable:

1. **Writer**: change the canonical path helper to `<id>/meta.json`. Document
   why in the helper's doc comment.
2. **Legacy helper**: keep the old flat path available as
   `<thing>LegacyPath(...)`, marked `@deprecated`, for back-compat reads (and
   tombstone deletes of legacy mirrors).
3. **Read candidates**: expose `<thing>ReadCandidatePaths(...)` returning
   `[currentPath, legacyPath]` so readers resolve records mirrored by either
   adapter generation.
4. **Parsers/routers**: every regex or matcher that recognizes the record path
   must accept both `<id>/meta.json` and the legacy `<id>.json` (see the Slack
   `thread.ts` reply-listing regex and the GitHub
   `ISSUE_COMMENT_WRITEBACK_PATH`).
5. **Writeback resource config**: if the record is a writeback target, the
   resource `pathPattern` must match the `/meta.json` form and the `idPattern`
   must accept the literal `meta` stem (the handler re-derives the real id from
   the full path). Slack's `messages` resource and GitHub's `issue-comments`
   resource are the references. These live in
   `scripts/writeback-discovery-data.mjs` / `writeback-discovery-normalizer.mjs`
   and are regenerated into each adapter's `src/resources.ts` and discovery
   `.adapter.md` by `scripts/generate-writeback-discovery.mjs`.
6. **Docs**: update the adapter's `layout-prompt.ts` (the mounted `LAYOUT.md`)
   and discovery read-path docs so agents construct the new shape.
7. **Tests**: add a regression test pinning (a) the directory-record path, (b)
   the nesting invariant for a child path, and (c) the read-candidate fallback
   order. See `packages/slack/src/__tests__/path-mapper-v2.test.ts`
   (`threadReplyPath is a directory record ...`),
   `packages/github/src/__tests__/path-mapper.test.ts`
   (`githubIssueCommentPath`), and
   `packages/linear/src/__tests__/path-mapper.test.ts` (`linearCommentPath`).

Do not represent the migration as a delete of the legacy file unless the
upstream object was actually deleted — pre-migration mirrors keep their flat
files until the record is next written or tombstoned.
