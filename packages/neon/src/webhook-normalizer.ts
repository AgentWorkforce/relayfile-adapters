export interface NormalizedNeonWebhook {
  eventType: string;
  path: string;
  payload: Record<string, unknown>;
}

export function normalizeNeonWebhook(): NormalizedNeonWebhook | null {
  return null;
}
