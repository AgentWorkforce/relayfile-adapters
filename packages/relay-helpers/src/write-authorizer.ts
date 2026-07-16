import type { WritebackResult } from '@relayfile/adapter-core/vfs-client';
import type { RelayTransport, RelayTransportWriteRequest } from './transport.js';

export type RelayWriteAuthorizationDecision =
  | { allowed: false; reason?: string }
  | { allowed: true; transport?: RelayTransport };

/**
 * Process-scoped policy hook invoked once at the final helper write boundary.
 * A local runtime may deny the write or redirect it to its canonical preview
 * transport without allowing an explicitly injected transport to run.
 */
export type RelayWriteAuthorizer = (
  request: Readonly<RelayTransportWriteRequest>,
) => RelayWriteAuthorizationDecision | Promise<RelayWriteAuthorizationDecision>;

export class RelayWriteAuthorizationError extends Error {
  readonly code = 'RELAY_WRITE_DENIED' as const;
  readonly provider: string;
  readonly resource: string;

  constructor(request: Pick<RelayTransportWriteRequest, 'provider' | 'resource'>, reason?: string) {
    super(
      reason
        ? `Relay write denied for ${request.provider}.${request.resource}: ${reason}`
        : `Relay write denied for ${request.provider}.${request.resource}`,
    );
    this.name = 'RelayWriteAuthorizationError';
    this.provider = request.provider;
    this.resource = request.resource;
  }
}

const PROCESS_WRITE_AUTHORIZER_KEY = Symbol.for('agentworkforce.relay-write-authorizer');

function processWriteAuthorizerRegistry(): Record<symbol, unknown> {
  return globalThis as unknown as Record<symbol, unknown>;
}

function getProcessRelayWriteAuthorizer(): RelayWriteAuthorizer | undefined {
  return processWriteAuthorizerRegistry()[PROCESS_WRITE_AUTHORIZER_KEY] as
    | RelayWriteAuthorizer
    | undefined;
}

/**
 * Bind a process-scoped final-write authorizer and return an identity-guarded
 * restoration callback. Nested bindings restore in stack order.
 */
export function bindRelayWriteAuthorizer(authorizer: RelayWriteAuthorizer): () => void {
  const registry = processWriteAuthorizerRegistry();
  const previous = getProcessRelayWriteAuthorizer();
  registry[PROCESS_WRITE_AUTHORIZER_KEY] = authorizer;
  return () => {
    if (getProcessRelayWriteAuthorizer() === authorizer) {
      registry[PROCESS_WRITE_AUTHORIZER_KEY] = previous;
    }
  };
}

/** @internal Shared final boundary for catalog and bespoke helper writes. */
export async function executeRelayWrite(
  selectedTransport: RelayTransport | undefined,
  request: RelayTransportWriteRequest,
  fallback?: () => Promise<WritebackResult>,
): Promise<WritebackResult> {
  const authorizer = getProcessRelayWriteAuthorizer();
  let transport = selectedTransport;

  if (authorizer) {
    const decision = await authorizer(request);
    if (!decision || typeof decision.allowed !== 'boolean') {
      throw new TypeError('Relay write authorizer returned an invalid decision');
    }
    if (!decision.allowed) {
      throw new RelayWriteAuthorizationError(request, decision.reason);
    }
    transport = decision.transport ?? selectedTransport;
  }

  if (transport) return transport.write(request);
  if (fallback) return fallback();
  throw new Error(`No Relay transport or native fallback is available for ${request.provider}.${request.resource}`);
}
