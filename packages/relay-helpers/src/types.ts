// @sync @agentworkforce/events WS-C
// Keep these lightweight wire types aligned until the shared events package is published.

export interface EffectPolicyV1 {
  reads: 'deny' | 'fixtures' | 'live';
  writes: 'deny' | 'preview' | 'sandbox' | 'live';
  model: 'stub' | 'fixture' | 'live';
  shell: 'deny' | 'simulate' | 'sandbox' | 'live';
  compose: 'deny' | 'preview' | 'sandbox' | 'live';
  allowedHttp: Array<{ method: string; urlGlob: string }>;
  allowedProviders?: string[];
}

export interface PreviewSimulatedReceipt {
  id: string;
  timestamp: string;
}

export interface PreviewAction {
  provider: string;
  resource: string;
  method: 'read' | 'list' | 'write';
  path: string;
  parameters?: Record<string, unknown>;
  body?: unknown;
  simulatedReceipt?: PreviewSimulatedReceipt;
}

export type PreviewAccess = PreviewAction & {
  method: 'read' | 'list';
  body?: never;
  simulatedReceipt?: never;
};
