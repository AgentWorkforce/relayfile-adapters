import type {
  IntegrationClientOptions,
  WritebackResult,
} from '@relayfile/adapter-core/vfs-client';
import type {
  PreviewAccess,
  PreviewParameters,
  PreviewSimulatedReceipt,
  TransportPreviewAction,
} from './types.js';

export type {
  EffectPolicyV1,
  PreviewAccess,
  PreviewAction,
  PreviewParameters,
  PreviewSimulatedReceipt,
  TransportPreviewAction,
} from './types.js';

export type RelayTransportParameters = PreviewParameters;

export interface RelayTransportRequest {
  provider: string;
  resource: string;
  parameters: RelayTransportParameters;
  path: string;
}

export interface RelayTransportWriteRequest extends RelayTransportRequest {
  body: unknown;
}

/**
 * The provider-helper IO boundary. Implementations may use a Relayfile mount,
 * a remote Relayfile API, or a side-effect-free recorder. This type has no
 * Workforce dependency and is safe for runtimes to import directly.
 */
export interface RelayTransport {
  read<T = unknown>(request: RelayTransportRequest): Promise<T>;
  list<T = unknown>(request: RelayTransportRequest): Promise<T[]>;
  write(request: RelayTransportWriteRequest): Promise<WritebackResult>;
}

/** Options accepted by every relay-helper client factory. */
export interface RelayClientOptions extends IntegrationClientOptions {
  /**
   * Explicit helper transport. It takes precedence over mount and HTTP options
   * and over every ambient Relayfile/provider credential during selection. A
   * process write authorizer may still deny or redirect the final write.
   */
  transport?: RelayTransport;
}

export interface PreviewTransportOptions {
  /** Data keyed by canonical Relayfile path for preview reads and lists. */
  fixtures?: Readonly<Record<string, unknown>> | ReadonlyMap<string, unknown>;
  /** Override deterministic fake identifiers when a consumer needs a fixture convention. */
  idFactory?: (request: RelayTransportWriteRequest, sequence: number) => string;
  /** Override deterministic timestamps. Sequence numbers start at one. */
  timestampFactory?: (sequence: number) => string;
}

export {
  RelayWriteAuthorizationError,
  bindRelayWriteAuthorizer,
  type RelayWriteAuthorizationDecision,
  type RelayWriteAuthorizer,
} from './write-authorizer.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stablePart(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '');
  return normalized || 'action';
}

function defaultId(request: RelayTransportWriteRequest, sequence: number): string {
  return `preview-${stablePart(request.provider)}-${stablePart(request.resource)}-${String(sequence).padStart(4, '0')}`;
}

function defaultTimestamp(sequence: number): string {
  return new Date(Date.UTC(2000, 0, 1) + sequence - 1).toISOString();
}

function collectionRecordPath(path: string, id: string): string {
  return path.endsWith('.json') ? path : `${path.replace(/\/+$/u, '')}/${encodeURIComponent(id)}.json`;
}

/**
 * Side-effect-free provider transport used by local preview and test runs.
 * It never inspects environment variables and never delegates to fetch or the
 * filesystem. Writes are recorded and receive deterministic simulated IDs so
 * later writes can safely refer to earlier ones.
 */
export class PreviewTransport implements RelayTransport {
  readonly actions: TransportPreviewAction[] = [];
  readonly accesses: PreviewAccess[] = [];

  private sequence = 0;
  private readonly data = new Map<string, unknown>();
  private readonly writtenPaths = new Set<string>();
  private readonly receiptsByReference = new Map<string, PreviewSimulatedReceipt>();
  private readonly idFactory: NonNullable<PreviewTransportOptions['idFactory']>;
  private readonly timestampFactory: NonNullable<PreviewTransportOptions['timestampFactory']>;

  constructor(options: PreviewTransportOptions = {}) {
    const fixtures = options.fixtures;
    if (fixtures instanceof Map) {
      for (const [fixturePath, value] of fixtures) this.data.set(fixturePath, value);
    } else if (fixtures) {
      for (const [fixturePath, value] of Object.entries(fixtures)) this.data.set(fixturePath, value);
    }
    this.idFactory = options.idFactory ?? defaultId;
    this.timestampFactory = options.timestampFactory ?? defaultTimestamp;
  }

  seed(path: string, value: unknown): this {
    this.data.set(path, value);
    return this;
  }

  async read<T = unknown>(request: RelayTransportRequest): Promise<T> {
    const parameters = { ...request.parameters };
    const action: PreviewAccess = {
      ...request,
      kind: 'provider.read',
      status: 'previewed',
      data: { operation: 'read', parameters, path: request.path },
      parameters,
      method: 'read',
    };
    this.accesses.push(action);
    this.actions.push(action);
    return this.data.get(request.path) as T;
  }

  async list<T = unknown>(request: RelayTransportRequest): Promise<T[]> {
    const parameters = { ...request.parameters };
    const action: PreviewAccess = {
      ...request,
      kind: 'provider.read',
      status: 'previewed',
      data: { operation: 'list', parameters, path: request.path },
      parameters,
      method: 'list',
    };
    this.accesses.push(action);
    this.actions.push(action);
    const fixture = this.data.get(request.path);
    if (Array.isArray(fixture)) return [...fixture] as T[];

    const prefix = `${request.path.replace(/\/+$/u, '')}/`;
    const records: T[] = [];
    for (const [recordPath, value] of this.data) {
      if (!recordPath.startsWith(prefix)) continue;
      const remainder = recordPath.slice(prefix.length);
      if (remainder && !remainder.includes('/') && remainder.endsWith('.json')) records.push(value as T);
    }
    return records;
  }

  async write(request: RelayTransportWriteRequest): Promise<WritebackResult> {
    this.sequence += 1;
    const simulatedReceipt = {
      id: this.idFactory(request, this.sequence),
      timestamp: this.timestampFactory(this.sequence),
    };
    const path = collectionRecordPath(request.path, simulatedReceipt.id);
    const body = this.resolveParentReference(request.body);
    const parameters = { ...request.parameters };
    const action: TransportPreviewAction = {
      ...request,
      id: simulatedReceipt.id,
      kind: 'provider.write',
      status: 'previewed',
      data: { operation: 'write', parameters, path, body, simulatedReceipt },
      method: 'write',
      parameters,
      path,
      body,
      simulatedReceipt,
    };
    this.actions.push(action);
    this.data.set(path, body);
    this.writtenPaths.add(path);
    this.receiptsByReference.set(path, simulatedReceipt);
    this.receiptsByReference.set(simulatedReceipt.id, simulatedReceipt);

    return {
      path,
      absolutePath: path,
      receipt: {
        id: simulatedReceipt.id,
        created: simulatedReceipt.id,
        externalId: simulatedReceipt.id,
        ts: simulatedReceipt.id,
        timestamp: simulatedReceipt.timestamp,
        path,
        ok: true,
      },
    };
  }

  clear(): void {
    for (const path of this.writtenPaths) this.data.delete(path);
    this.writtenPaths.clear();
    this.actions.length = 0;
    this.accesses.length = 0;
    this.sequence = 0;
    this.receiptsByReference.clear();
  }

  private resolveParentReference(body: unknown): unknown {
    if (!isRecord(body) || typeof body.parentRef !== 'string') return body;
    const parent = this.receiptsByReference.get(body.parentRef);
    return parent ? { ...body, thread_ts: parent.id } : { ...body };
  }
}

const PROCESS_TRANSPORT_KEY = Symbol.for('agentworkforce.preview-transport');

function processTransportRegistry(): Record<symbol, unknown> {
  return globalThis as unknown as Record<symbol, unknown>;
}

/** Return the process-scoped transport used by legacy no-argument clients. */
export function getProcessRelayTransport(): RelayTransport | undefined {
  return processTransportRegistry()[PROCESS_TRANSPORT_KEY] as RelayTransport | undefined;
}

/** Set or clear the process-scoped transport used by legacy no-argument clients. */
export function setProcessRelayTransport(transport: RelayTransport | undefined): void {
  processTransportRegistry()[PROCESS_TRANSPORT_KEY] = transport;
}

/** Compatibility name used by the preview runtime integration. */
export function setPreviewTransport(transport: RelayTransport): void {
  setProcessRelayTransport(transport);
}

/** Clear the process-scoped preview transport. */
export function clearPreviewTransport(): void {
  setProcessRelayTransport(undefined);
}

/**
 * Bind a process transport and return a restoration callback. Nested bindings
 * restore correctly; the callback will not overwrite a newer binding.
 */
export function bindRelayTransport(transport: RelayTransport): () => void {
  const previous = getProcessRelayTransport();
  setProcessRelayTransport(transport);
  return () => {
    if (getProcessRelayTransport() === transport) setProcessRelayTransport(previous);
  };
}

/** Convenience name for the common process-scoped preview binding. */
export const bindPreviewTransport = bindRelayTransport;

/** Explicit constructor injection always wins over the process binding. */
export function resolveRelayTransport(options: RelayClientOptions): RelayTransport | undefined {
  return options.transport ?? getProcessRelayTransport();
}

/**
 * Capture explicit constructor injection while resolving the process binding
 * lazily for every operation. The lazy half is essential for handlers that
 * construct a no-argument client at module load before a Run binds preview.
 */
export function createRelayTransportResolver(
  options: RelayClientOptions,
): () => RelayTransport | undefined {
  const explicitTransport = options.transport;
  return () => explicitTransport ?? getProcessRelayTransport();
}
