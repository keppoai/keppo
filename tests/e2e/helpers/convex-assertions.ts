import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { isTransientServerError } from "./mcp-client";

const DEFAULT_CONVEX_ASSERT_TIMEOUT_MS = 30_000;
const TRANSIENT_ASSERT_RETRY_DELAY_MS = 250;

const refs = {
  listPendingActionsByNamespace: makeFunctionReference<"query">(
    "e2e:listPendingActionsByNamespace",
  ),
  countNamespaceRecords: makeFunctionReference<"query">("e2e:countNamespaceRecords"),
  resetNamespace: makeFunctionReference<"mutation">("e2e:resetNamespace"),
};

const clientFor = (convexUrl: string): ConvexHttpClient => {
  const client = new ConvexHttpClient(convexUrl);
  const adminKey = process.env.KEPPO_CONVEX_ADMIN_KEY;
  if (adminKey) {
    (client as unknown as { setAdminAuth: (key: string) => void }).setAdminAuth(adminKey);
  }
  return client;
};

const withTimeout = async <T>(label: string, run: () => Promise<T>): Promise<T> => {
  let timeoutHandle: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      run(),
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(`${label} timed out after ${DEFAULT_CONVEX_ASSERT_TIMEOUT_MS}ms`));
        }, DEFAULT_CONVEX_ASSERT_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
};

export const assertNoPendingNamespaceActions = async (
  convexUrl: string,
  namespace: string,
): Promise<void> => {
  const client = clientFor(convexUrl);
  const deadline = Date.now() + DEFAULT_CONVEX_ASSERT_TIMEOUT_MS;
  let lastTransientError: unknown = null;

  while (Date.now() < deadline) {
    try {
      const pending = (await withTimeout(`Pending namespace action assertion (${namespace})`, () =>
        client.query(refs.listPendingActionsByNamespace, {
          namespace,
        }),
      )) as Array<Record<string, unknown>>;

      if (pending.length > 0) {
        throw new Error(
          `Namespace ${namespace} still has pending actions: ${JSON.stringify(pending, null, 2)}`,
        );
      }
      return;
    } catch (error) {
      if (!isTransientServerError(error)) {
        throw error;
      }
      lastTransientError = error;
      await new Promise((resolve) => setTimeout(resolve, TRANSIENT_ASSERT_RETRY_DELAY_MS));
    }
  }

  throw (
    lastTransientError ??
    new Error(`Pending namespace action assertion (${namespace}) exhausted its retry budget.`)
  );
};

/**
 * Re-run the namespace reset mutation to catch records created by
 * in-flight Convex actions that completed after the initial cleanup.
 */
const reRunNamespaceCleanup = async (
  client: ConvexHttpClient,
  namespace: string,
): Promise<void> => {
  let tableIndex = 0;
  let cursor: string | null = null;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const result = (await client.mutation(refs.resetNamespace, {
      namespace,
      tableIndex,
      cursor,
    })) as { done: boolean; tableIndex: number; cursor: string | null };
    if (result.done) {
      return;
    }
    tableIndex = result.tableIndex;
    cursor = result.cursor;
  }
};

export const assertNoNamespaceRecordsRemain = async (
  convexUrl: string,
  namespace: string,
): Promise<void> => {
  const client = clientFor(convexUrl);
  const deadline = Date.now() + DEFAULT_CONVEX_ASSERT_TIMEOUT_MS;
  let lastCount = -1;
  let cleanupRetries = 0;
  while (Date.now() < deadline) {
    const result = (await client.query(refs.countNamespaceRecords, {
      namespace,
    })) as { count: number };
    lastCount = result.count;
    if (lastCount === 0) {
      return;
    }
    // Re-run cleanup to catch records created by in-flight actions after
    // the initial reset (race condition in teardown).
    if (cleanupRetries < 3) {
      cleanupRetries += 1;
      await reRunNamespaceCleanup(client, namespace);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Namespace ${namespace} still has ${lastCount} persisted record(s)`);
};
