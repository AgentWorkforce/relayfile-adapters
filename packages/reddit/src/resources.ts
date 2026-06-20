export interface AdapterResourceConfig {
  readonly name: string;
  readonly path: string;
  readonly pathPattern: RegExp;
  readonly idPattern: RegExp;
  readonly schema: string;
  readonly createExample: string;
  readonly sampleIndexPath?: string;
}

export const resources = [
  {
    name: 'subreddits',
    path: '/reddit/subreddits',
    pathPattern: /^\/reddit\/subreddits\/(?!_index\.json$)[^/]+\.json$/,
    idPattern: /^[A-Za-z0-9_][A-Za-z0-9_-]{1,63}$/,
    schema: 'discovery/reddit/subreddits/.schema.json',
    createExample: 'discovery/reddit/subreddits/.create.example.json',
  },
  {
    name: 'posts',
    path: '/reddit/subreddits/{subreddit}/posts',
    sampleIndexPath: '/reddit/posts',
    pathPattern: /^\/reddit\/subreddits\/[^/]+\/posts\/(?!_index\.json$)[^/]+\.json$/,
    idPattern: /^[A-Za-z0-9_\/-]+$/,
    schema: 'discovery/reddit/subreddits/{subreddit}/posts/.schema.json',
    createExample: 'discovery/reddit/subreddits/{subreddit}/posts/.create.example.json',
  },
] as const satisfies readonly AdapterResourceConfig[];

export function findResourceByPath(path: string): AdapterResourceConfig | undefined {
  return resources.find((resource) => resource.pathPattern.test(path));
}
