import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  RegisteredWebhookAdapter,
  WebhookSignatureVerificationContext,
  WebhookVerificationResult,
} from "./types.js";

function toBytes(value: string): Buffer {
  return Buffer.from(value, "utf8");
}

function secureCompare(left: string, right: string): boolean {
  const leftBytes = toBytes(left);
  const rightBytes = toBytes(right);

  if (leftBytes.length !== rightBytes.length) {
    return false;
  }

  return timingSafeEqual(leftBytes, rightBytes);
}

function hmacSha256(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

export function headersToRecord(headers: Headers): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [name, value] of headers.entries()) {
    normalized[name.toLowerCase()] = value;
  }
  return normalized;
}

function verifyGitHubSignature(secret: string, headers: Headers, rawBody: string): WebhookVerificationResult {
  const providedSignature = headers.get("x-hub-signature-256");
  if (!providedSignature) {
    return {
      ok: false,
      error: "Missing x-hub-signature-256 header.",
      reason: "missing_signature",
      status: 401,
    };
  }

  const expectedSignature = `sha256=${hmacSha256(secret, rawBody)}`;
  if (!secureCompare(expectedSignature, providedSignature)) {
    return {
      ok: false,
      error: "Invalid GitHub webhook signature.",
      reason: "signature_mismatch",
      status: 401,
    };
  }

  return { ok: true };
}

function verifySlackSignature(
  secret: string,
  headers: Headers,
  rawBody: string,
  now = Date.now(),
): WebhookVerificationResult {
  const timestampHeader = headers.get("x-slack-request-timestamp");
  if (!timestampHeader) {
    return {
      ok: false,
      error: "Missing x-slack-request-timestamp header.",
      reason: "missing_timestamp",
      status: 401,
    };
  }

  const providedSignature = headers.get("x-slack-signature");
  if (!providedSignature) {
    return {
      ok: false,
      error: "Missing x-slack-signature header.",
      reason: "missing_signature",
      status: 401,
    };
  }

  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp)) {
    return {
      ok: false,
      error: "Invalid Slack webhook timestamp.",
      reason: "invalid_timestamp",
      status: 401,
    };
  }

  const ageSeconds = Math.abs(Math.floor(now / 1000) - timestamp);
  if (ageSeconds > 300) {
    return {
      ok: false,
      error: "Slack webhook timestamp is too old.",
      reason: "stale_timestamp",
      status: 401,
    };
  }

  const signatureBase = `v0:${timestamp}:${rawBody}`;
  const expectedSignature = `v0=${hmacSha256(secret, signatureBase)}`;
  if (!secureCompare(expectedSignature, providedSignature)) {
    return {
      ok: false,
      error: "Invalid Slack webhook signature.",
      reason: "signature_mismatch",
      status: 401,
    };
  }

  return { ok: true };
}

export async function verifyWebhookSignature(
  context: WebhookSignatureVerificationContext,
  adapter: RegisteredWebhookAdapter,
): Promise<WebhookVerificationResult> {
  if (adapter.verifySignature) {
    return adapter.verifySignature(context);
  }

  if (!context.secret) {
    return { ok: true };
  }

  switch (context.provider) {
    case "github":
      return verifyGitHubSignature(context.secret, context.headers, context.rawBody);
    case "slack":
      return verifySlackSignature(
        context.secret,
        context.headers,
        context.rawBody,
        context.now,
      );
    default:
      return {
        ok: false,
        error: `no verifier for provider ${context.provider}`,
        reason: "unsupported_provider",
        status: 401,
      };
  }
}
