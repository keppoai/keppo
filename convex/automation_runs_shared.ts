export const MAX_AUTOMATION_RUN_LOG_BATCH_LINES = 100;
const MIN_LOG_EVICTION_FETCH_ROWS = 50;
const LOG_ROW_BYTES_ESTIMATE = 128;

export const utf8Bytes = (value: string): number => {
  return new TextEncoder().encode(value).length;
};

export const truncateToUtf8Bytes = (value: string, maxBytes: number): string => {
  if (utf8Bytes(value) <= maxBytes) {
    return value;
  }
  let output = "";
  for (const char of value) {
    const next = output + char;
    if (utf8Bytes(next) > maxBytes) {
      break;
    }
    output = next;
  }
  return output;
};

const nextAutomationRunLogEvictionBatchSize = (bytesToFree: number): number => {
  return Math.max(
    MIN_LOG_EVICTION_FETCH_ROWS,
    Math.ceil((bytesToFree / LOG_ROW_BYTES_ESTIMATE) * 2),
  );
};

export const evictAutomationRunLogRows = async <Row extends { seq: number; content: string }>({
  bytesToFree,
  loadRows,
  deleteRow,
}: {
  bytesToFree: number;
  loadRows: (afterSeqExclusive: number | null, take: number) => Promise<Row[]>;
  deleteRow: (row: Row) => Promise<void>;
}): Promise<{
  deletedRowCount: number;
  freedBytes: number;
  remainingBytesToFree: number;
}> => {
  let afterSeqExclusive: number | null = null;
  let deletedRowCount = 0;
  let freedBytes = 0;
  let remainingBytesToFree = bytesToFree;

  while (remainingBytesToFree > 0) {
    const rows = await loadRows(
      afterSeqExclusive,
      nextAutomationRunLogEvictionBatchSize(remainingBytesToFree),
    );
    if (rows.length === 0) {
      break;
    }

    for (const row of rows) {
      afterSeqExclusive = row.seq;
      if (remainingBytesToFree <= 0) {
        break;
      }
      await deleteRow(row);
      const rowBytes = utf8Bytes(row.content);
      freedBytes += rowBytes;
      remainingBytesToFree -= rowBytes;
      deletedRowCount += 1;
    }
  }

  return {
    deletedRowCount,
    freedBytes,
    remainingBytesToFree,
  };
};
