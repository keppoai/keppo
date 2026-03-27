const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const toErrorIssues = (error: unknown): unknown[] => {
  if (error && typeof error === "object" && "issues" in error) {
    const issues = (error as { issues?: unknown }).issues;
    return Array.isArray(issues) ? issues : [];
  }
  return [];
};

const logFailedInvocation = (
  kind: "query" | "mutation" | "action",
  operation: string,
  error: unknown,
): void => {
  console.error(`convex.${kind}.failed`, {
    operation,
    message: toErrorMessage(error),
  });
};

export const safeRunQuery = async <T>(operation: string, execute: () => Promise<T>): Promise<T> => {
  try {
    return await execute();
  } catch (error) {
    logFailedInvocation("query", operation, error);
    throw error;
  }
};

export const safeRunMutation = async <T>(
  operation: string,
  execute: () => Promise<T>,
): Promise<T> => {
  try {
    return await execute();
  } catch (error) {
    logFailedInvocation("mutation", operation, error);
    throw error;
  }
};

export const safeRunAction = async <T>(
  operation: string,
  execute: () => Promise<T>,
): Promise<T> => {
  try {
    return await execute();
  } catch (error) {
    logFailedInvocation("action", operation, error);
    throw error;
  }
};

export const safeParsePayload = <T>(operation: string, parse: () => T): T => {
  try {
    return parse();
  } catch (error) {
    const issues = toErrorIssues(error);
    console.error("convex.payload.validation_failed", {
      operation,
      message: toErrorMessage(error),
      issues,
    });
    throw error;
  }
};

export const validationMessage = (operation: string, detail: string): string =>
  `[${operation}] ${detail}`;
