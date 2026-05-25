export interface AdapterResourceConfig {
  readonly name: string;
  readonly path: string;
  readonly pathPattern: RegExp;
  readonly idPattern: RegExp;
  readonly schema: string;
  readonly createExample: string;
  readonly sampleIndexPath?: string;
}

// Fathom is read-only for Relayfile: canonical sync/webhook materialization and
// digests are supported, but no file-native writeback contract is exposed.
export const resources = [] as const satisfies readonly AdapterResourceConfig[];

export function findResourceByPath(_path: string): AdapterResourceConfig | undefined {
  return undefined;
}
