interface AdapterResourceConfig {
  readonly name: string;
  readonly path: string;
  readonly sampleIndexPath?: string;
  readonly pathPattern: RegExp;
  readonly idPattern: RegExp;
  readonly schema: string;
  readonly createExample?: string;
  readonly operations?: readonly ('create' | 'update' | 'delete')[];
}

export const resources = [
  {
    name: 'pull-requests', path: '/bitbucket/repositories/{workspace}/{repository}/pull-requests',
    sampleIndexPath: '/bitbucket/pull-requests/_index.json',
    pathPattern: /^\/bitbucket\/repositories\/[^/]+\/[^/]+\/pull-requests\/[^/]+\.json$/u,
    idPattern: /^[a-z0-9-]+__\d+$/u,
    schema: 'discovery/bitbucket/repositories/{workspace}/{repository}/pull-requests/.schema.json',
    operations: [] as const,
  },
] as const satisfies readonly AdapterResourceConfig[];
