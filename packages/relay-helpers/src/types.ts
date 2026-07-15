// relay-helpers owns this type; @agentworkforce/runtime maps it when consuming.

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

export type PreviewParameters = Record<string, string | number>;

export interface PreviewAction {
  id?: string;
  kind: 'provider.read' | 'provider.write';
  provider: string;
  resource: string;
  status: 'previewed';
  data: Record<string, unknown>;
  extensions?: Record<string, unknown>;
  method: 'read' | 'list' | 'write';
  path: string;
  parameters?: PreviewParameters;
  body?: unknown;
  simulatedReceipt?: PreviewSimulatedReceipt;
}

export type TransportPreviewAction = PreviewAction;

export type PreviewAccess = PreviewAction & {
  kind: 'provider.read';
  method: 'read' | 'list';
  body?: never;
  simulatedReceipt?: never;
};
