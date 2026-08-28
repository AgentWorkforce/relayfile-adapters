export interface EventSummary {
  title?: string;
  status?: string;
  tags?: string[];
}

const MAX_TAGS = 8;
const MAX_TITLE_LENGTH = 120;
const MAX_TEXT_FIELD_LENGTH = 80;
const MAX_TAG_VALUE_LENGTH = 96;
const MAX_SUMMARY_JSON_LENGTH = 1024;

export function buildSummary(payload: Record<string, unknown>): EventSummary {
  const body = readRecord(payload.payload) ?? payload;
  const eventType = readString(body.type) ?? readString(body.event_type) ?? readString(payload.eventType);
  const subject = readRecord(body.object) ?? body;
  const title = truncateText(firstNonEmptyString(
    readString(subject.invoice_number),
    readString(subject.purchase_order_number),
    readString(subject.item_receipt_number),
    readString(subject.name),
    readString(subject.merchant_name),
    readString(subject.merchant),
    readString(subject.vendor_name),
    readString(subject.transaction_id),
    readString(subject.reimbursement_id),
  ), MAX_TITLE_LENGTH);
  const status = truncateText(firstNonEmptyString(
    readString(subject.status),
    readString(subject.state),
    readString(subject.sync_status),
    readString(subject.approval_status),
    readString(subject.receipt_status),
    readString(subject.renewal_status),
  ), MAX_TEXT_FIELD_LENGTH);
  const tags = limitStrings([
    'ramp',
    buildTag('event', eventType),
    buildTag('business', readString(body.business_id)),
  ], MAX_TAGS);

  return finalizeSummary({
    ...(title ? { title } : {}),
    ...(status ? { status } : {}),
    ...(tags.length > 0 ? { tags } : {}),
  });
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

function buildTag(prefix: string, value: string | undefined): string | undefined {
  const normalized = normalizeTagValue(value);
  return normalized ? `${prefix}:${normalized}` : undefined;
}

function normalizeTagValue(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;
  if (normalized.length <= MAX_TAG_VALUE_LENGTH) return normalized;
  return `${normalized.slice(0, Math.max(0, MAX_TAG_VALUE_LENGTH - 3)).trimEnd()}...`;
}

function limitStrings(values: Array<string | undefined>, max: number): string[] {
  const output: string[] = [];
  for (const value of values) {
    if (!value || output.includes(value)) continue;
    output.push(value);
    if (output.length >= max) break;
  }
  return output;
}

function finalizeSummary(summary: EventSummary): EventSummary {
  const next: EventSummary = {
    ...summary,
    ...(summary.tags ? { tags: [...summary.tags] } : {}),
  };

  while (JSON.stringify(next).length >= MAX_SUMMARY_JSON_LENGTH) {
    if (trimTags(next)) continue;
    if (trimText(next, 'title', 24)) continue;
    if (trimText(next, 'status', 16)) continue;
    break;
  }

  return next;
}

function trimTags(summary: EventSummary): boolean {
  const current = summary.tags;
  if (!current || current.length === 0) {
    return false;
  }
  if (current.length === 1) {
    delete summary.tags;
    return true;
  }
  summary.tags = current.slice(0, -1);
  return true;
}

function trimText(summary: EventSummary, key: 'title' | 'status', minLength: number): boolean {
  const current = summary[key];
  if (typeof current !== 'string') {
    return false;
  }
  if (current.length <= minLength) {
    delete summary[key];
    return true;
  }
  const nextLength = Math.max(minLength, current.length - 16);
  const nextValue = truncateText(current, nextLength);
  if (nextValue) {
    summary[key] = nextValue;
  } else {
    delete summary[key];
  }
  return true;
}

function redactFreeText(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[redacted-number]')
    .replace(/\b\d{9,}\b/g, '[redacted-number]');
}

function truncateText(value: string | undefined, maxLength: number): string | undefined {
  if (!value) return undefined;
  const normalized = redactFreeText(value).replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}
