/**
 * Build the stamper of per-message idempotency tokens for scheduled (clock)
 * deliveries, so a re-run of the same tick cannot post the same message twice.
 * Token format: `tick:<deliveryId>:<ordinal>`.
 */
export function createWritebackIdempotency(
  getDeliveryId: () => string | undefined = () => process.env.WORKFORCE_TICK_DELIVERY_ID
): () => string | undefined {
  let ordinal = 0;
  return () => {
    const deliveryId = getDeliveryId();
    if (!deliveryId) return undefined;
    ordinal += 1;
    return `tick:${deliveryId}:${ordinal}`;
  };
}

/** Attach the per-message idempotency token to a writeback body when one applies. */
export function withWritebackIdempotency(
  body: Record<string, unknown>,
  nextIdempotencyKey: () => string | undefined
): Record<string, unknown> {
  const idempotencyKey = nextIdempotencyKey();
  return idempotencyKey ? { ...body, idempotencyKey } : body;
}
