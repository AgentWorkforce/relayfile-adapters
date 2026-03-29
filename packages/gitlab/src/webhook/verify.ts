import { timingSafeEqual } from 'node:crypto';

export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookVerificationError';
  }
}

function readHeader(
  headers: Headers | Record<string, string | string[] | undefined>,
  target: string,
): string | undefined {
  if (headers instanceof Headers) {
    return headers.get(target) ?? headers.get(target.toLowerCase()) ?? undefined;
  }

  const normalizedTarget = target.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== normalizedTarget) {
      continue;
    }

    if (typeof value === 'string') {
      return value;
    }
    if (Array.isArray(value)) {
      return value[0];
    }
  }

  return undefined;
}

export function verifyWebhookToken(
  headers: Headers | Record<string, string | string[] | undefined>,
  expectedToken: string,
): void {
  const providedToken = readHeader(headers, 'x-gitlab-token');
  if (!providedToken) {
    throw new WebhookVerificationError('Missing X-Gitlab-Token header');
  }

  const left = Buffer.from(providedToken, 'utf8');
  const right = Buffer.from(expectedToken, 'utf8');
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw new WebhookVerificationError('Invalid X-Gitlab-Token header');
  }
}
