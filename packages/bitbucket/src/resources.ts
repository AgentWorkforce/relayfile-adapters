interface AdapterResourceConfig {
  readonly name: string;
  readonly path: string;
  readonly sampleIndexPath?: string;
  readonly pathPattern: RegExp;
  readonly idPattern: RegExp;
  readonly schema: string;
  readonly createExample: string;
  readonly operations?: readonly ('create' | 'update' | 'delete')[];
}

export const resources = [
  {
    name: 'pull-requests', path: '/bitbucket/repositories/{workspace}/{repository}/pull-requests',
    sampleIndexPath: '/bitbucket/pull-requests',
    pathPattern: /^\/bitbucket\/repositories\/[^/]+\/[^/]+\/pull-requests\/[^/]+\.json$/u,
    idPattern: /^\d+$/u,
    schema: 'discovery/bitbucket/repositories/{workspace}/{repository}/pull-requests/.schema.json',
    createExample: 'discovery/bitbucket/repositories/{workspace}/{repository}/pull-requests/.create.example.json',
    operations: [] as const,
  },
] as const satisfies readonly AdapterResourceConfig[];
