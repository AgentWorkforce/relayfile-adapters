// relay-helpers owns TransportPreviewAction; @agentworkforce/runtime owns and
// maps its provider-neutral PreviewAction projection when consuming.

/**
 * @deprecated Import EffectPolicyV1 from `@agentworkforce/runtime` instead.
 * Retained only for compatibility with `@relayfile/relay-helpers@0.4.5`.
 */
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

/**
 * Rich provider-operation record owned by relay-helpers. Consumers may map it
 * structurally to the provider-neutral PreviewAction from @agentworkforce/runtime.
 */
export interface TransportPreviewAction {
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

/**
 * @deprecated Use TransportPreviewAction. This relay-helpers compatibility
 * alias is not the provider-neutral PreviewAction owned by @agentworkforce/runtime.
 */
export type PreviewAction = TransportPreviewAction;

export type PreviewAccess = TransportPreviewAction & {
  kind: 'provider.read';
  method: 'read' | 'list';
  body?: never;
  simulatedReceipt?: never;
};
