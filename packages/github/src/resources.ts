export interface AdapterResourceConfig {
  readonly name: string;
  readonly path: string;
  readonly pathPattern: RegExp;
  readonly idPattern: RegExp;
  readonly schema: string;
  readonly createExample: string;
}

export const resources = [
  {
    name: "issues",
    path: "/github/repos/{owner}/{repo}/issues",
    pathPattern: /^\/github\/repos\/[^\/]+\/[^\/]+\/issues(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^[1-9]\d*$/,
    schema: "discovery/github/repos/{owner}/{repo}/issues/.schema.json",
    createExample: "discovery/github/repos/{owner}/{repo}/issues/.create.example.json",
  },
  {
    name: "issue-comments",
    path: "/github/repos/{owner}/{repo}/issues/{issueNumber}/comments",
    pathPattern: /^\/github\/repos\/[^\/]+\/[^\/]+\/issues\/[^\/]+\/comments(?:\/[^\/]+(?:\.json|\/meta\.json)?)?$/,
    idPattern: /^(?:meta|\d+)$/,
    schema: "discovery/github/repos/{owner}/{repo}/issues/{issueNumber}/comments/.schema.json",
    createExample: "discovery/github/repos/{owner}/{repo}/issues/{issueNumber}/comments/.create.example.json",
  },
  {
    name: "reviews",
    path: "/github/repos/{owner}/{repo}/pulls/{pullNumber}/reviews",
    pathPattern: /^\/github\/repos\/[^\/]+\/[^\/]+\/pulls\/[^\/]+\/reviews(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^\d+$/,
    schema: "discovery/github/repos/{owner}/{repo}/pulls/{pullNumber}/reviews/.schema.json",
    createExample: "discovery/github/repos/{owner}/{repo}/pulls/{pullNumber}/reviews/.create.example.json",
  },
  {
    name: "merge",
    path: "/github/repos/{owner}/{repo}/pulls/{pullNumber}/merge.json",
    pathPattern: /^\/github\/repos\/[^\/]+\/[^\/]+\/pulls\/[1-9]\d*(?:__[^\/]+)?\/merge\.json$/,
    idPattern: /^[1-9]\d*(?:__.*)?$/,
    schema: "discovery/github/repos/{owner}/{repo}/pulls/{pullNumber}/merge.json/.schema.json",
    createExample: "discovery/github/repos/{owner}/{repo}/pulls/{pullNumber}/merge.json/.create.example.json",
  },
  {
    name: "replies",
    path: "/github/repos/{owner}/{repo}/pulls/{pullNumber}/review-comments/{commentId}/replies",
    pathPattern: /^\/github\/repos\/[^\/]+\/[^\/]+\/pulls\/[^\/]+\/review-comments\/[^\/]+\/replies(?:\/[^\/]+(?:\.json)?)?$/,
    idPattern: /^\d+$/,
    schema: "discovery/github/repos/{owner}/{repo}/pulls/{pullNumber}/review-comments/{commentId}/replies/.schema.json",
    createExample: "discovery/github/repos/{owner}/{repo}/pulls/{pullNumber}/review-comments/{commentId}/replies/.create.example.json",
  },
] as const satisfies readonly AdapterResourceConfig[];

export function findResourceByPath(path: string): AdapterResourceConfig | undefined {
  const normalizedPath = path.endsWith(".json") ? path : path.replace(/\/$/, "");
  return resources.find((resource) => resource.pathPattern.test(normalizedPath));
}
