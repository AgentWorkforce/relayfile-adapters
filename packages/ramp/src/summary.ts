export interface EventSummary {
  title?: string;
  status?: string;
  tags?: string[];
}

export function buildSummary(payload: Record<string, unknown>): EventSummary {
  const body = readRecord(payload.payload) ?? payload;
  const eventType = readString(body.type) ?? readString(body.event_type) ?? readString(payload.eventType);
  const subject = readRecord(body.object) ?? body;
  const title = firstNonEmptyString(
    readString(subject.invoice_number),
    readString(subject.purchase_order_number),
    readString(subject.item_receipt_number),
    readString(subject.name),
    readString(subject.merchant_name),
    readString(subject.merchant),
    readString(subject.vendor_name),
    readString(subject.transaction_id),
    readString(subject.reimbursement_id),
  );
  const status = firstNonEmptyString(
    readString(subject.status),
    readString(subject.state),
    readString(subject.sync_status),
    readString(subject.approval_status),
    readString(subject.receipt_status),
    readString(subject.renewal_status),
  );
  const tags = compactStrings([
    'ramp',
    eventType ? `event:${eventType}` : undefined,
    readString(body.business_id) ? `business:${readString(body.business_id)}` : undefined,
  ]);

  return {
    ...(title ? { title } : {}),
    ...(status ? { status } : {}),
    ...(tags.length > 0 ? { tags } : {}),
  };
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const string = readString(value);
    if (string) {
      return string;
    }
  }
  return undefined;
}

function compactStrings(values: Array<string | undefined>): string[] {
  return values.filter((value): value is string => typeof value === 'string' && value.length > 0);
}
