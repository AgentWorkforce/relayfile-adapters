# LAYOUT.md

When this applies: adding or editing the `LAYOUT.md` an adapter emits at `/<provider>/LAYOUT.md`.

## No generic fallback

Every shipping adapter MUST emit its own `LAYOUT.md`. The previous ~288-byte generic fallback is not acceptable — it gives consumers nothing actionable. Target ~1000-1500 bytes of provider-specific content. A unit test on every `layoutPromptFile()` must assert content length and at least the substrings `ls`, `_index.json`, and the `by-*` subtrees the adapter emits.

## Required sections

Use this template (TypeScript template literal) as the starting point:

```ts
export const FOO_LAYOUT_PROMPT = `# Foo Mount Layout

Always run \`ls\` before constructing a path. The adapter writes <describe the joiner used: __ or, in jira's pre-migration state, --> so consumers should inspect the live directory instead of guessing a filename.

## Tree

\`/foo/LAYOUT.md\` is this guide.
\`/foo/<resource>/\` ... (list each canonical resource directory with one sentence).
\`/foo/<resource>/<sub-artifact>/\` ... (note any nested artifacts that are NOT canonical records).

## Indexes

\`/foo/<resource>/_index.json\` rows use:

\`\`\`json
{ "id": "<id>", "title": "<human-readable>", "updated": "<iso8601>", "<natural-filter>": "<value>" }
\`\`\`

Indexes are sorted by \`updated\` descending.

## Aliases

- Canonical: \`/foo/<resource>/<slug>__<id>.json\`.
- By id: \`/foo/<resource>/by-id/<id>.json\`.
- By <natural key>: \`/foo/<resource>/by-<key>/<slug>__<id>.json\`.

Alias files are either minimal pointers (\`{ id, canonicalPath, title? }\`) or materialized canonical mirrors; document the choice and keep it consistent within a resource. Collisions get a deterministic 8-char hash suffix.

## JSONL And Querying

Note whether this adapter emits JSONL today. Then include 3-5 copy-pasteable \`ls\` / \`jq\` / \`grep\` examples that exercise the indexes and aliases.
\`;
```

## Emitter pattern

Export a `<provider>LayoutPromptFile()` function alongside the constant so callers can register it in the materialization pipeline:

```ts
export function fooLayoutPromptFile() {
  return {
    path: '/foo/LAYOUT.md',
    contentType: 'text/markdown; charset=utf-8' as const,
    content: FOO_LAYOUT_PROMPT.endsWith('\n') ? FOO_LAYOUT_PROMPT : `${FOO_LAYOUT_PROMPT}\n`,
  };
}
```

Reference implementations: `packages/github/src/layout-prompt.ts`, `packages/linear/src/layout-prompt.ts`, `packages/confluence/src/layout-prompt.ts`.
