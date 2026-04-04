export async function runBatchedSettled<T>(
  items: string[],
  concurrency: number,
  run: (item: string) => Promise<T>,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = [];

  for (let index = 0; index < items.length; index += concurrency) {
    const batch = items.slice(index, index + concurrency);
    results.push(...(await Promise.allSettled(batch.map((item) => run(item)))));
  }

  return results;
}
