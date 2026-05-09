import { LIFECYCLE_RESOURCE_PATH } from './path-mapper.js';
import type { JsonObject, ProviderWritebackRequest, WritebackOperation } from './types.js';

export type SubscriptionAction = 'create' | 'renew' | 'delete';

export interface SubscriptionRecord extends JsonObject {
  id?: string;
  expiresAt?: string;
  expirationDateTime?: string;
}

export function buildSubscriptionRequest(record: SubscriptionRecord, action: SubscriptionAction = 'create'): ProviderWritebackRequest {
  const id = typeof record.id === 'string' ? record.id : null;
  const operation: WritebackOperation = action === 'delete' ? 'delete' : id ? 'update' : 'create';
  return {
    action: "sharepoint" + '.subscriptions.' + action,
    operation,
    method: operation === 'delete' ? 'DELETE' : operation === 'create' ? 'POST' : 'PATCH',
    endpoint: LIFECYCLE_RESOURCE_PATH,
    resource: 'subscription-lifecycle',
    resourceId: id,
    body: operation === 'delete' ? null : record,
  };
}

export function shouldRenewSubscription(record: SubscriptionRecord, now: Date = new Date(), renewWindowMs = 24 * 60 * 60 * 1000): boolean {
  const expires = typeof record.expiresAt === 'string' ? record.expiresAt : typeof record.expirationDateTime === 'string' ? record.expirationDateTime : null;
  if (!expires) return false;
  const expiresAt = Date.parse(expires);
  return Number.isFinite(expiresAt) && expiresAt - now.getTime() <= renewWindowMs;
}
