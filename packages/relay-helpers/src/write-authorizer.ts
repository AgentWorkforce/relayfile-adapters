import { AsyncLocalStorage } from 'node:async_hooks';
import {
  writeJsonFile,
  type IntegrationClientOptions,
  type WritebackResult,
} from '@relayfile/adapter-core/vfs-client';
import type { RelayTransport, RelayTransportWriteRequest } from './transport.js';

export type RelayWriteAuthorizationDecision =
  | { allowed: false; reason?: string }
  | { allowed: true; transport?: RelayTransport };

/**
 * Execution-scoped policy hook invoked once at the final helper write boundary.
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
const WRITE_AUTHORIZER_COORDINATOR_VERSION = 2;

interface RelayWriteAuthorizationFrame {
  readonly authorizer: RelayWriteAuthorizer;
  readonly previous: RelayWriteAuthorizationFrame | undefined;
  active: boolean;
}

interface RelayWriteAuthorizationCoordinator {
  (request: Readonly<RelayTransportWriteRequest>): Promise<RelayWriteAuthorizationDecision>;
  readonly version: typeof WRITE_AUTHORIZER_COORDINATOR_VERSION;
  bind(authorizer: RelayWriteAuthorizer): () => void;
  run<T>(authorizer: RelayWriteAuthorizer, operation: () => T): T;
  activeAuthorizers(): RelayWriteAuthorizer[];
}

/** @internal Descriptor for the only native-VFS write sink in this package. */
export interface RelayWriteVfsFallback {
  readonly options: IntegrationClientOptions;
  readonly integration: string;
  readonly operation: string;
  readonly path: string;
  readonly data: unknown;
}

function processWriteAuthorizerRegistry(): Record<symbol, unknown> {
  return globalThis as unknown as Record<symbol, unknown>;
}

function isRelayWriteAuthorizationCoordinator(
  value: unknown,
): value is RelayWriteAuthorizationCoordinator {
  if (typeof value !== 'function') return false;
  const candidate = value as Partial<RelayWriteAuthorizationCoordinator>;
  return candidate.version === WRITE_AUTHORIZER_COORDINATOR_VERSION
    && typeof candidate.bind === 'function'
    && typeof candidate.run === 'function'
    && typeof candidate.activeAuthorizers === 'function';
}

function createRelayWriteAuthorizationCoordinator(): RelayWriteAuthorizationCoordinator {
  const storage = new AsyncLocalStorage<RelayWriteAuthorizationFrame | undefined>();

  const activeFrame = (
    frame: RelayWriteAuthorizationFrame | undefined,
  ): RelayWriteAuthorizationFrame | undefined => {
    let current = frame;
    while (current && !current.active) current = current.previous;
    return current;
  };

  const makeFrame = (authorizer: RelayWriteAuthorizer): RelayWriteAuthorizationFrame => ({
    authorizer,
    previous: activeFrame(storage.getStore()),
    active: true,
  });

  const activeAuthorizers = (): RelayWriteAuthorizer[] => {
    const authorizers: RelayWriteAuthorizer[] = [];
    let frame = activeFrame(storage.getStore());
    while (frame) {
      if (frame.active) authorizers.push(frame.authorizer);
      frame = frame.previous;
    }
    authorizers.reverse();
    return authorizers;
  };

  const authorize = async (
    request: Readonly<RelayTransportWriteRequest>,
  ): Promise<RelayWriteAuthorizationDecision> => {
    let transport: RelayTransport | undefined;
    for (const authorizer of activeAuthorizers()) {
      const decision = await authorizer(request);
      if (!decision || typeof decision.allowed !== 'boolean') {
        throw new TypeError('Relay write authorizer returned an invalid decision');
      }
      if (!decision.allowed) return decision;
      transport ??= decision.transport;
    }
    return transport ? { allowed: true, transport } : { allowed: true };
  };

  const coordinator = Object.assign(authorize, {
    version: WRITE_AUTHORIZER_COORDINATOR_VERSION,
    bind(authorizer: RelayWriteAuthorizer) {
      const frame = makeFrame(authorizer);
      storage.enterWith(frame);
      let restored = false;
      return () => {
        if (restored) return;
        restored = true;
        frame.active = false;
        if (storage.getStore() === frame) {
          storage.enterWith(activeFrame(frame.previous));
        }
      };
    },
    run<T>(authorizer: RelayWriteAuthorizer, operation: () => T) {
      return storage.run(makeFrame(authorizer), operation);
    },
    activeAuthorizers,
  }) as RelayWriteAuthorizationCoordinator;
  return Object.freeze(coordinator);
}

function processRelayWriteAuthorizationCoordinator(): RelayWriteAuthorizationCoordinator {
  const registry = processWriteAuthorizerRegistry();
  const existing = registry[PROCESS_WRITE_AUTHORIZER_KEY];
  if (isRelayWriteAuthorizationCoordinator(existing)) return existing;

  const coordinator = createRelayWriteAuthorizationCoordinator();
  Object.defineProperty(registry, PROCESS_WRITE_AUTHORIZER_KEY, {
    value: coordinator,
    configurable: false,
    enumerable: false,
    writable: false,
  });
  return coordinator;
}

const PROCESS_WRITE_AUTHORIZATION_COORDINATOR = processRelayWriteAuthorizationCoordinator();

/**
 * Bind a final-write authorizer to the current asynchronous execution context.
 * Later bindings compose monotonically: any denial wins and the earliest
 * transport override remains authoritative. The idempotent restoration
 * callback is safe to call out of order and never resurrects inactive policy.
 */
export function bindRelayWriteAuthorizer(authorizer: RelayWriteAuthorizer): () => void {
  return PROCESS_WRITE_AUTHORIZATION_COORDINATOR.bind(authorizer);
}

/**
 * Run an operation in an isolated authorization scope. Use this form when a
 * process may host overlapping Runs; concurrent scopes do not observe or
 * mutate one another, while bindings created inside a scope still compose.
 */
export function runWithRelayWriteAuthorizer<T>(
  authorizer: RelayWriteAuthorizer,
  operation: () => T,
): T {
  return PROCESS_WRITE_AUTHORIZATION_COORDINATOR.run(authorizer, operation);
}

/** @internal Shared final boundary for catalog and bespoke helper writes. */
export async function executeRelayWrite(
  selectedTransport: RelayTransport | undefined,
  request: RelayTransportWriteRequest,
  fallback?: RelayWriteVfsFallback,
): Promise<WritebackResult> {
  const decision = await PROCESS_WRITE_AUTHORIZATION_COORDINATOR(request);
  if (!decision.allowed) {
    throw new RelayWriteAuthorizationError(request, decision.reason);
  }

  const transport = decision.transport ?? selectedTransport;
  if (transport) return transport.write(request);
  if (fallback) {
    return writeJsonFile(
      fallback.options,
      fallback.integration,
      fallback.operation,
      fallback.path,
      fallback.data,
    );
  }
  throw new Error(`No Relay transport or native fallback is available for ${request.provider}.${request.resource}`);
}
