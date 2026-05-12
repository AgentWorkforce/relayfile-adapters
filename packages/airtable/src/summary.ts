import {
  extractAirtableNotificationChangedFieldIds,
  extractAirtableNotificationChanges,
  parseAirtableWebhookPayload,
} from './webhook-normalizer.js';
import type {
  AirtableEventSummary,
  AirtableWebhookNotification,
} from './types.js';

export function buildSummary(input: AirtableWebhookNotification | Record<string, unknown>): AirtableEventSummary {
  const payload = isWebhookNotification(input)
    ? (input.payload ?? {})
    : input;
  const record = parseAirtableWebhookPayload(payload);
  const normalized = isWebhookNotification(input) ? input : undefined;
  const baseId =
    normalized?.baseId ??
    readOptionalString(record.baseId) ??
    readOptionalString(record.base_id) ??
    readOptionalString(getRecord(record.base)?.id);
  const webhookId =
    normalized?.webhookId ??
    readOptionalString(record.webhookId) ??
    readOptionalString(record.webhook_id) ??
    readOptionalString(getRecord(record.webhook)?.id) ??
    readOptionalString(record.id);
  const fieldsChanged = uniqueStrings([
    ...(normalized?.changedFieldIds ?? []),
    ...extractAirtableNotificationChangedFieldIds(record),
    ...extractAirtableNotificationChanges(record, 50)
      .map((change) => change.fieldId)
      .filter((value): value is string => Boolean(value)),
  ]).slice(0, 16);
  const tableIds = uniqueStrings([
    ...extractAirtableNotificationChanges(record, 50)
      .map((change) => change.tableId)
      .filter((value): value is string => Boolean(value)),
  ]).slice(0, 6);
  const actor = readActor(record);
  const title = resolveNotificationTitle(record)
    ?? (baseId ? `Airtable base ${baseId} change notification` : 'Airtable change notification');

  return {
    title,
    ...(actor ? { actor } : {}),
    ...(fieldsChanged.length > 0 ? { fieldsChanged } : {}),
    ...(tableIds.length > 0 || webhookId
      ? {
          tags: uniqueStrings([
            'airtable',
            'notification',
            ...(webhookId ? [`webhook:${webhookId}`] : []),
            ...tableIds.map((tableId) => `table:${tableId}`),
          ]).slice(0, 8),
        }
      : {}),
  };
}

function resolveNotificationTitle(record: Record<string, unknown>): string | undefined {
  const changedTablesById = getRecord(record.changedTablesById);
  if (!changedTablesById) {
    return undefined;
  }

  for (const tableChange of Object.values(changedTablesById)) {
    const changedRecordsById = getRecord(getRecord(tableChange)?.changedRecordsById);
    if (!changedRecordsById) {
      continue;
    }

    for (const changeRecord of Object.values(changedRecordsById)) {
      const currentFields = getRecord(getRecord(changeRecord)?.current)?.cellValuesByFieldId;
      const previousFields = getRecord(getRecord(changeRecord)?.previous)?.cellValuesByFieldId;
      const title = firstNonEmptyString(...Object.values(getRecord(currentFields) ?? {}))
        ?? firstNonEmptyString(...Object.values(getRecord(previousFields) ?? {}));
      if (title) {
        return title;
      }
    }
  }

  return undefined;
}

function readActor(record: Record<string, unknown>): AirtableEventSummary['actor'] | undefined {
  const user =
    getRecord(getRecord(getRecord(record.actionMetadata)?.sourceMetadata)?.user) ??
    getRecord(record.actor);
  const id = readOptionalString(user?.id);
  if (!id) {
    return undefined;
  }

  const displayName =
    readOptionalString(user?.displayName) ??
    readOptionalString(user?.name);

  return {
    id,
    ...(displayName ? { displayName } : {}),
  };
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isWebhookNotification(value: unknown): value is AirtableWebhookNotification {
  const record = getRecord(value);
  return Boolean(record && typeof record.baseId === 'string' && typeof record.webhookId === 'string');
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const string = readOptionalString(value);
    if (string) {
      return string;
    }
  }
  return undefined;
}
