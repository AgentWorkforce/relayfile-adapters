import type { Hono } from "hono";
import type {
  ConnectionProvider,
  QueuedResponse,
  RelayFileClient,
} from "@relayfile/sdk";

export interface WebhookNormalizationContext {
  provider: string;
  headers: Headers;
  rawBody: string;
  signal?: AbortSignal;
}

export interface WebhookSignatureVerificationContext {
  provider: string;
  headers: Headers;
  rawBody: string;
  secret?: string;
  now?: number;
}

export interface WebhookVerificationSuccess {
  ok: true;
}

export interface WebhookVerificationFailure {
  ok: false;
  error: string;
  reason: string;
  status: 400 | 401 | 404 | 502;
}

export type WebhookVerificationResult =
  | WebhookVerificationSuccess
  | WebhookVerificationFailure;

export interface WebhookEvent {
  provider: string;
  connectionId?: string;
  eventType: string;
  objectType: string;
  objectId: string;
  payload: Record<string, unknown>;
  raw?: unknown;
  metadata?: Record<string, string>;
}

export interface RegisteredWebhookAdapter {
  readonly name?: string;
  readonly provider?: ConnectionProvider;
  normalizeWebhook?(
    payload: Record<string, unknown>,
    context: WebhookNormalizationContext,
  ): Promise<WebhookEvent | WebhookEvent[]> | WebhookEvent | WebhookEvent[];
  computePath?(
    objectType: string,
    objectId: string,
    payload?: Record<string, unknown>,
  ): string;
  verifySignature?(
    context: WebhookSignatureVerificationContext,
  ): Promise<WebhookVerificationResult> | WebhookVerificationResult;
}

export type AdapterMap = Record<string, RegisteredWebhookAdapter>;
export type WebhookSecretMap = Record<string, string | undefined>;

export interface WebhookServerOptions {
  client: RelayFileClient;
  workspaceId?: string;
  port?: number;
  hostname?: string;
  adapters?: AdapterMap;
  secrets?: WebhookSecretMap;
}

export interface WebhookStartOptions {
  port?: number;
  hostname?: string;
}

export interface StartedWebhookServer {
  readonly hostname: string;
  readonly port: number;
  close(): Promise<void>;
}

export interface PersistedWebhook {
  event: WebhookEvent;
  path: string;
  queued: QueuedResponse;
}

export interface AdapterRegistryLike {
  register(name: string, adapter: RegisteredWebhookAdapter): void;
  get(name: string): RegisteredWebhookAdapter | undefined;
  list(): string[];
}

export interface WebhookServer {
  readonly app: Hono;
  readonly registry: AdapterRegistryLike;
  register(name: string, adapter: RegisteredWebhookAdapter): WebhookServer;
  getAdapter(name: string): RegisteredWebhookAdapter | undefined;
  fetch(request: Request): Promise<Response> | Response;
  start(options?: WebhookStartOptions): Promise<StartedWebhookServer>;
}
