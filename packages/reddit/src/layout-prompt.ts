import { redditLayoutPath } from './path-mapper.js';

export const REDDIT_LAYOUT_PROMPT = `# Reddit Mount Layout

Canonical records are JSON files under \`/reddit\`.

## Tree

- \`/reddit/LAYOUT.md\`
- \`/reddit/_index.json\`
- \`/reddit/subreddits/_index.json\`
- \`/reddit/subreddits/<subreddit>.json\`
- \`/reddit/subreddits/by-id/<subreddit>.json\`
- \`/reddit/subreddits/<subreddit>/posts/_index.json\`
- \`/reddit/subreddits/<subreddit>/posts/<title>__<postId>.json\`
- \`/reddit/posts/_index.json\`
- \`/reddit/posts/by-id/<subreddit>__<postId>.json\`
- \`/reddit/posts/by-status/<status>/<subreddit>__<postId>.json\`

## Discovery

Read discovery schemas before writeback:

- \`discovery/reddit/subreddits/.schema.json\`
- \`discovery/reddit/subreddits/{subreddit}/posts/.schema.json\`

Each schema has a sibling \`.create.example.json\` file.

## Notes

Terminal states (\`archived\`, \`locked\`, \`removed\`, \`deleted\`) stay readable on canonical post records. Treat terminal states as updates, not deletions.
`;

export function redditLayoutPromptFile() {
  return {
    path: redditLayoutPath(),
    contentType: 'text/markdown; charset=utf-8' as const,
    content: REDDIT_LAYOUT_PROMPT.endsWith('\n') ? REDDIT_LAYOUT_PROMPT : `${REDDIT_LAYOUT_PROMPT}\n`,
  };
}
