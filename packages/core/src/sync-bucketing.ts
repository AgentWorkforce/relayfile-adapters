export type RecordBucketMap = Record<string, Record<string, unknown>[] | undefined>;

export interface SyncRecordBucketing {
  bucketRecords(
    records: readonly Record<string, unknown>[],
    model: string,
  ): RecordBucketMap;
}

export type ModelNormalizer<T extends string = string> = (model: string) => T | null;

export interface ModelBucketConfig<T extends string = string> {
  normalizeModel: ModelNormalizer<T>;
  buckets: Partial<Record<T, string>>;
  mapRecords?: (
    records: readonly Record<string, unknown>[],
    context: { modelType: T; bucketName: string },
  ) => Record<string, unknown>[];
}

export function modelBucket<T extends string>(
  config: ModelBucketConfig<T>,
): SyncRecordBucketing {
  return {
    bucketRecords(records, model) {
      const modelType = config.normalizeModel(model);
      if (!modelType) return {};
      const bucketName = config.buckets[modelType];
      if (!bucketName) return {};
      const mapped =
        config.mapRecords?.(records, { modelType, bucketName }) ??
        mapToBucket(records, basicTombstone);
      return mapped.length > 0 ? { [bucketName]: mapped } : {};
    },
  };
}

export function literalModelNormalizer<T extends string>(
  entries: Record<string, T>,
): ModelNormalizer<T> {
  const normalizedEntries = new Map<string, T>();
  for (const [key, value] of Object.entries(entries)) {
    normalizedEntries.set(normalizeModelKey(key), value);
  }
  return (model) => normalizedEntries.get(normalizeModelKey(model)) ?? null;
}

export function safeNormalize<T extends string>(
  fn: (model: string) => T | null | undefined,
): ModelNormalizer<T> {
  return (model) => {
    try {
      return fn(model) ?? null;
    } catch {
      return null;
    }
  };
}

export function isRecordObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function readBucketString(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function readBucketId(
  record: Record<string, unknown>,
  key = "id",
): string | null {
  const value = record[key];
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number") return String(value);
  return null;
}

export function basicTombstone(id: string): Record<string, unknown> {
  return { id, _deleted: true };
}

export function cleanBucketRecord(
  record: Record<string, unknown>,
): Record<string, unknown> {
  const payload = { ...record };
  delete payload._nango_metadata;
  return payload;
}

export function isDeletedSyncRecord(record: Record<string, unknown>): boolean {
  const metadata = record._nango_metadata;
  if (!isRecordObject(metadata)) {
    return false;
  }

  const lastAction =
    typeof metadata.last_action === "string"
      ? metadata.last_action.toLowerCase()
      : "";
  return lastAction === "deleted" || typeof metadata.deleted_at === "string";
}

export function mapToBucket(
  records: readonly Record<string, unknown>[],
  buildTombstone: (id: string, raw: Record<string, unknown>) => Record<string, unknown>,
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const raw of records) {
    if (isDeletedSyncRecord(raw)) {
      const id = readBucketId(raw, "id");
      if (!id) continue;
      out.push(buildTombstone(id, raw));
      continue;
    }
    out.push(cleanBucketRecord(raw));
  }
  return out;
}

export function normalizeModelKey(model: string): string {
  return model.trim().toLowerCase();
}
