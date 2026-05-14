export interface DigestContext {
  readonly provider: string;
  readonly window: {
    readonly from: string;
    readonly to: string;
  };
  changeEvents(filter?: {
    providers?: string[];
    paths?: string[];
  }): Promise<readonly unknown[]>;
}

export interface DigestBullet {
  readonly text: string;
  readonly canonicalPath: string;
}

export interface DigestSection {
  readonly provider: string;
  readonly bullets: readonly DigestBullet[];
}

export type DigestHandler = (ctx: DigestContext) => Promise<DigestSection | null>;

export const digest: DigestHandler = async () => null;
