# Path Slugification Spec

## Problem

When syncing data from external services (Notion, Linear, GitHub, Slack), file paths are currently derived from internal UUIDs:

```
/notion/databases/<databaseId>/pages/<pageId>.json
/linear/issues/<issueId>.json
/github/pulls/<prNumber>.json
/slack/channels/<channelId>/messages/<ts>.json
```

This makes the VFS hard to navigate — users see `/notion/databases/abc-123/pages/def-456.json` instead of `/notion/databases/engineering/pages/api-design-doc.json`.

## Solution

Introduce **title-based slugification** as an optional secondary segment in paths. When a human-readable title is available, use it instead of (or alongside) the raw ID.

### Rules

1. **Prefer title over ID when available.** If a page, issue, PR, channel, etc. has a title/name, use a slugified version of it.
2. **Preserve the ID for uniqueness.** When two objects share the same slug, append a short hash of the original ID to disambiguate: `my-page-title--a1b2c3d4.json`.
3. **Never use raw IDs as the primary segment** for user-facing objects (pages, issues, PRs, channels). IDs are still used for internal objects (blocks, comments, reactions) where no title exists.
4. **Slug format:** lowercase, hyphenated, stripped of special chars. Extracted from the `slugify()` utility in `packages/core/src/docs/mapping-generator.ts` (lines 140-146), or a compatible equivalent.
5. **Keep the `meta.json` / `content.md` structure** — this only changes the directory/file name, not the internal structure of what's stored.

## Slugify Algorithm

```typescript
function slugify(value: string): string {
  return value
    .replace(/[{}]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

// Collision: append 8-char hash of the ID
function slugWithIdSuffix(title: string, id: string): string {
  const slug = slugify(title);
  if (!slug) return id; // fallback to raw ID if title is empty
  const shortHash = id.replace(/-/g, '').slice(0, 8);
  return `${slug}--${shortHash}`;
}
```

## Changes by Adapter

### Notion (`packages/notion/src/path-mapper.ts`)

| Function | Change |
|---|---|
| `notionDatabaseMetadataPath(databaseId, title?)` | When `title` provided: `/notion/databases/<slug>.json` instead of `<databaseId>.json` |
| `notionDatabasePagePath(databaseId, pageId, pageTitle?)` | When `pageTitle` provided: `/notion/databases/<db-slug>/pages/<page-slug>.json` |
| `notionDatabasePageContentPath` | Same as above |
| `notionDatabasePageCommentsPath` | Same as above |
| `notionDatabaseBlockPath(blockId)` | No change — blocks have no title |
| `notionStandalonePagePath(pageId, pageTitle?)` | When `pageTitle` provided: `/notion/pages/<page-slug>.json` |
| `notionStandalonePageContentPath` | Same as above |
| `notionStandalonePageCommentsPath` | Same as above |
| `notionStandaloneBlockPath(blockId)` | No change |

**Callers to update:**
- `packages/notion/src/databases/ingestion.ts` line 56 — pass `normalizeDatabase.title`
- `packages/notion/src/pages/ingestion.ts` line 38 — pass `normalized.title`

### Linear (`packages/linear/src/path-mapper.ts`)

| Function | Change |
|---|---|
| `linearIssuePath(issueId, title?)` | When `title` provided: `/linear/issues/<slug>.json` |
| `linearCommentPath(issueId, commentId)` | No change — comments have no title |
| `linearMetadataPath` | No change — workspace-level |

**Callers to update:** wherever issues are ingested, pass the issue `title` into the path mapper.

### GitHub (`packages/github/src/path-mapper.ts`)

| Function | Change |
|---|---|
| `githubIssuePath(repo, issueNumber, title?)` | When `title` provided: `/github/<repo>/issues/<slug>.json` |
| `githubPullRequestPath(repo, prNumber, title?)` | When `title` provided: `/github/<repo>/pulls/<slug>.json` |
| `githubReviewPath(commitId)` | No change — reviews have no title |
| `githubCheckRunPath(checkId)` | No change |

**Note:** PRs/issues have numbers (not UUIDs) as IDs — the slug should supplement, not replace, the number. E.g. `/github/relayfile-adapters/pulls/42--add-oidc-support.json`.

### Slack (`packages/slack/src/path-mapper.ts`)

| Function | Change |
|---|---|
| `channelMetadataPath(channelId, channelName?)` | When `channelName` provided: `/slack/channels/<slug>/meta.json` |
| `channelMessagesDirectory(channelId, channelName?)` | When `channelName` provided: `/slack/channels/<slug>/messages/` |
| `messagePath(channelId, messageTs, threadSubject?)` | When `threadSubject` provided: slugified as filename prefix |
| `threadPath(channelId, threadTs)` | No change — threads lack titles |
| `userMetadataPath(userId, userName?)` | When `userName` provided: `/slack/users/<slug>/meta.json` |
| `fileMetadataPath(fileId, fileName?)` | When `fileName` provided: `/slack/files/<slug>/meta.json` |

**Note:** Slack message timestamps are not human-readable — they should NOT be slugified. Only objects with explicit names/titles get slugified paths.

## Directory Structure After

```
/notion/
  databases/
    engineering/          ← slugified database title
      metadata.json
      pages/
        api-design-doc--abc12345.json  ← slugified page title + short ID suffix
        auth-spec--def67890.json
          content.md
          comments.json
          blocks/
            abc.json
            def.json

/linear/
  issues/
    add-oidc-support--1234567.json   ← slugified title + short ID suffix
    fix-token-refresh--7654321.json

/github/
  relayfile-adapters/
    pulls/
      42--add-oidc-support.json     ← number + slugified title

/slack/
  channels/
    engineering/              ← slugified channel name
      meta.json
      messages/
        msg--abc123.json
      threads/
        thread--def456/
          meta.json
          replies/
            reply--ghi789.json
          reactions/
            thumbsup--user123.json
```

## Non-Goals

- **Not changing the internal JSON structure** of stored objects
- **Not making paths globally unique** — only unique within a parent directory
- **Not touching block/comment/reaction paths** where no title exists
- **Not handling renames** — if a title changes, existing files stay; new syncs use the new slug

## Verification

1. Run existing tests — all adapter tests should pass (paths are backward-compatible since title is optional)
2. Add new tests for slug collision handling
3. Run a full sync of each adapter and verify paths are human-readable in the VFS

## Out of Scope

- **The "this model does not support image input" error** — this comes from an external AI provider (OpenAI Codex), not from sync code. It fires when the model reads content containing markdown image links. Fix: filter image blocks from content before sending to models that don't support images, or configure the model to allow image URLs.