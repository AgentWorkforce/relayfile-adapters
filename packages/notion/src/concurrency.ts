const DEFAULT_CONCURRENCY = 8;

export async function processConcurrently<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  concurrency: number = DEFAULT_CONCURRENCY,
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }

  const limit =
    Number.isFinite(concurrency) && concurrency > 0
      ? Math.max(1, Math.trunc(concurrency))
      : DEFAULT_CONCURRENCY;
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function run(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await processor(items[index] as T);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}
