import { readFile } from "node:fs/promises";
import path from "node:path";
import { releaseE2ERunOwnership, stopE2EStack } from "./infra/stack-manager";

type BrowserContextUsageRecord = {
  runId: string;
  workerIndex: number;
  testId: string;
  specPath: string;
  scenarioId: string;
  retryIndex: number;
  repeatEachIndex: number;
  contextId: string;
  contextGuid: string | null;
  startedAtMs: number;
  endedAtMs: number;
};

const browserContextUsageFileForRun = (runId: string): string => {
  return path.resolve(process.cwd(), "tests/e2e/.runtime", `browser-context-usage.${runId}.ndjson`);
};

const parseUsageRecords = (content: string): BrowserContextUsageRecord[] => {
  const records: BrowserContextUsageRecord[] = [];
  for (const [lineNumber, line] of content.split(/\r?\n/).entries()) {
    if (!line.trim()) {
      continue;
    }
    try {
      records.push(JSON.parse(line) as BrowserContextUsageRecord);
    } catch (error) {
      throw new Error(
        `Failed to parse browser-context usage record at line ${lineNumber + 1}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  return records;
};

const assertNoOverlappingContextUsage = (records: BrowserContextUsageRecord[]): void => {
  const byContext = new Map<string, BrowserContextUsageRecord[]>();
  for (const record of records) {
    const existing = byContext.get(record.contextId);
    if (existing) {
      existing.push(record);
      continue;
    }
    byContext.set(record.contextId, [record]);
  }

  const violations: string[] = [];
  for (const [contextId, items] of byContext) {
    if (items.length < 2) {
      continue;
    }
    const sorted = items
      .slice()
      .sort(
        (left, right) => left.startedAtMs - right.startedAtMs || left.endedAtMs - right.endedAtMs,
      );

    let active = sorted[0];
    for (let index = 1; index < sorted.length; index += 1) {
      const current = sorted[index];
      if (current.startedAtMs < active.endedAtMs) {
        violations.push(
          [
            `context=${contextId}`,
            `active=${active.specPath}#${active.scenarioId}[${active.testId}]`,
            `current=${current.specPath}#${current.scenarioId}[${current.testId}]`,
            `window=${active.startedAtMs}-${active.endedAtMs} overlaps ${current.startedAtMs}-${current.endedAtMs}`,
          ].join(" "),
        );
      }
      if (current.endedAtMs > active.endedAtMs) {
        active = current;
      }
    }
  }

  if (violations.length > 0) {
    throw new Error(
      `Detected overlapping browser-context usage across tests:\n${violations.slice(0, 10).join("\n")}`,
    );
  }
};

const assertBrowserContextIsolation = async (): Promise<void> => {
  const runId = process.env.KEPPO_E2E_RUN_ID?.trim();
  if (!runId) {
    return;
  }
  const filePath = browserContextUsageFileForRun(runId);
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return;
    }
    throw error;
  }

  const records = parseUsageRecords(content).filter(
    (record) => Number.isFinite(record.startedAtMs) && Number.isFinite(record.endedAtMs),
  );
  if (records.length === 0) {
    return;
  }
  assertNoOverlappingContextUsage(records);
};

const globalTeardown = async (): Promise<void> => {
  const runId = process.env.KEPPO_E2E_RUN_ID?.trim() ?? "";
  try {
    await assertBrowserContextIsolation();
    await stopE2EStack();

    if (process.env.KEPPO_E2E_STRICT_HANDLES === "1") {
      const activeHandles =
        ((process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles?.() as
          | unknown[]
          | undefined) ?? [];
      const leaked = activeHandles.filter((handle) => {
        const label = handle?.constructor?.name ?? "";
        return label !== "WriteStream" && label !== "ReadStream" && label !== "Socket";
      });
      if (leaked.length > 0) {
        throw new Error(
          `Detected leaked async handles at teardown: ${leaked.map((handle) => handle?.constructor?.name ?? "unknown").join(", ")}`,
        );
      }
    }
  } finally {
    if (runId) {
      await releaseE2ERunOwnership(runId);
    }
  }
};

export default globalTeardown;
