export function bitbucketLayoutPromptFile() {
  return {
    path: '/bitbucket/LAYOUT.md',
    contentType: 'text/markdown; charset=utf-8',
    content: `# Bitbucket Cloud mount\n\nRepositories live under /bitbucket/repositories/{workspace}/{repository}/meta.json and projects under /bitbucket/workspaces/{workspace}/projects/{key}.json. Pull requests, issues, commits, pipelines, deployments, and tags live in repository folders. Read /bitbucket/{resource}/_index.json to discover records and use by-id aliases for stable lookup.\n\nWritable discovery contracts:\n\n- discovery/bitbucket/repositories/{workspace}/{repository}/issues/.schema.json\n- discovery/bitbucket/repositories/{workspace}/{repository}/pull-requests/.schema.json\n\nMerged and declined pull requests and resolved or closed issues remain readable with their state. Only provider delete events remove records.\n`,
  };
}
