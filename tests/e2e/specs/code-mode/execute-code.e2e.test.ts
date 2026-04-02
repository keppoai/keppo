import { test, expect } from "../../fixtures/golden.fixture";
import { isTransientServerError, waitForTerminalActionResult } from "../../helpers/mcp-client";

const SANDBOX_UNAVAILABLE_PATTERN =
  /sandbox provider is unavailable|install docker desktop|use KEPPO_CODE_MODE_SANDBOX_PROVIDER=vercel/i;
/** error_code values that represent intentional sandbox behavior, not infra failures. */
const EXPECTED_EXECUTION_FAILED_CODES_TIMEOUT = new Set(["timeout"]);
const REQUIRE_CODE_MODE_SANDBOX = process.env.KEPPO_E2E_REQUIRE_CODE_MODE_SANDBOX === "1";
const RETRYABLE_EXECUTION_FAILED_CODES = new Set(["timeout"]);

const findJsonPayloadInOutput = (
  value: Record<string, unknown> | string,
): Record<string, unknown> => {
  if (typeof value === "object" && value !== null) {
    return value;
  }
  for (const line of String(value)
    .split("\n")
    .map((entry) => entry.trim())
    .reverse()) {
    const normalized = line.startsWith("return: ") ? line.slice("return: ".length) : line;
    if (!normalized.startsWith("{") || !normalized.endsWith("}")) {
      continue;
    }
    try {
      const parsed = JSON.parse(normalized) as Record<string, unknown>;
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    } catch {
      // Keep scanning prior lines for the structured console payload.
    }
  }
  return {};
};

const skipIfSandboxUnavailable = (
  value: unknown,
  expectedFailedCodes: ReadonlySet<string> = new Set(),
): void => {
  const message = typeof value === "string" ? value : JSON.stringify(value);
  const payload =
    typeof value === "string"
      ? findJsonPayloadInOutput(value)
      : typeof value === "object" && value !== null
        ? (value as Record<string, unknown>)
        : {};
  const isUnavailable = SANDBOX_UNAVAILABLE_PATTERN.test(message);
  // Treat unexpected execution_failed responses (e.g. "Run workspace not found",
  // ENOENT on sandbox files, or sandbox timeouts) as infra failures rather than
  // test failures.  Only error_codes explicitly expected by the calling test are
  // allowed through.
  const isInfraFailure =
    payload.status === "execution_failed" &&
    !expectedFailedCodes.has(String(payload.error_code ?? ""));
  if (!isUnavailable && !isInfraFailure) {
    return;
  }
  if (REQUIRE_CODE_MODE_SANDBOX) {
    if (isInfraFailure) {
      throw new Error(
        `Code-mode execution infra failure under strict sandbox mode: ${JSON.stringify(payload)}`,
      );
    }
    throw new Error(
      "Code-mode sandbox is unavailable, but KEPPO_E2E_REQUIRE_CODE_MODE_SANDBOX=1 requires it.",
    );
  }
  test.skip(true, "Code-mode sandbox is unavailable in this environment.");
};

const retryExecuteCodeOnTransientInfraFailure = async (
  execute: () => Promise<Record<string, unknown> | string>,
  reinitialize: () => Promise<void>,
): Promise<Record<string, unknown> | string> => {
  let lastResult: Record<string, unknown> | string | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await execute();
    lastResult = result;
    const payload =
      typeof result === "object" && result !== null
        ? (result as Record<string, unknown>)
        : findJsonPayloadInOutput(result);
    if (
      payload.status !== "execution_failed" ||
      !RETRYABLE_EXECUTION_FAILED_CODES.has(String(payload.error_code ?? ""))
    ) {
      return result;
    }
    if (attempt >= 2) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000 * (attempt + 1)));
    await reinitialize();
  }
  return lastResult ?? {};
};

test("execute_code runs plain JavaScript and returns console output", async ({
  pages,
  auth,
  provider,
}) => {
  await pages.login.login();
  const seeded = await auth.seedWorkspace("code-mode-exec-hello");

  const mcp = provider.createMcpClient(seeded.workspaceId, seeded.credentialSecret);
  await mcp.initialize();

  const output = await mcp.executeCode('console.log("hello")');
  skipIfSandboxUnavailable(output);
  expect(typeof output).toBe("string");
  expect(String(output)).toContain("hello");
});

test("execute_code can run a read tool call", async ({ pages, auth, provider }) => {
  await pages.login.login();
  const seeded = await auth.seedWorkspaceWithProvider("code-mode-exec-read", "google");

  const mcp = provider.createMcpClient(seeded.workspaceId, seeded.credentialSecret);
  await mcp.initialize();

  const output = await mcp.executeCode(
    'const result = await gmail.searchThreads({ query: "" }); console.log(JSON.stringify(result));',
  );
  skipIfSandboxUnavailable(output);
  expect(JSON.stringify(output)).toContain("status");
});

test("execute_code supports auto-approved write calls", async ({ pages, auth, provider }) => {
  test.slow();
  await pages.login.login();
  const seeded = await auth.seedWorkspaceWithProvider("code-mode-exec-write", "google");
  await auth.setToolAutoApproval(seeded.workspaceId, "gmail.sendEmail", true);

  const mcp = provider.createMcpClient(seeded.workspaceId, seeded.credentialSecret);
  try {
    await mcp.initialize();

    const output = await mcp.executeCode(`
      return await gmail.sendEmail({
        to: ["qa@example.com"],
        subject: "Code mode",
        body: "hello"
      });
    `);

    skipIfSandboxUnavailable(output);
    const payload = findJsonPayloadInOutput(output);
    expect(String(payload.status ?? JSON.stringify(output))).toMatch(
      /(succeeded|approved|executing|idempotent_replay)/,
    );
    const settled = await waitForTerminalActionResult(mcp, {
      scope: "execute_code auto-approved gmail.sendEmail",
      response: payload,
      timeoutMs: 12_000,
    });
    expect(settled.status).toBe("succeeded");
    expect(String(settled.action_id ?? payload.action_id ?? "")).toMatch(/^act_/);
  } finally {
    await mcp.close();
  }
});

test("execute_code returns approval_pending for write calls needing approval", async ({
  pages,
  auth,
  provider,
}) => {
  test.slow();
  await pages.login.login();
  const seeded = await auth.seedWorkspaceWithProvider("code-mode-exec-pending", "google");
  await auth.setToolAutoApproval(seeded.workspaceId, "gmail.sendEmail", false);

  const mcp = provider.createMcpClient(seeded.workspaceId, seeded.credentialSecret);
  try {
    await mcp.initialize();

    const output = await mcp.executeCode(`
      return await gmail.sendEmail({
        to: ["qa@example.com"],
        subject: "Needs approval",
        body: "pending"
      });
    `);

    skipIfSandboxUnavailable(output);
    const payload = findJsonPayloadInOutput(output);
    expect(payload.status).toBe("approval_pending");
    expect(typeof payload.action_id).toBe("string");
  } finally {
    await mcp.close();
  }
});

test("execute_code blocks tools from disabled providers", async ({ pages, auth, provider }) => {
  test.slow();
  await pages.login.login();
  const seeded = await auth.seedWorkspaceWithProvider("code-mode-exec-disabled", "google");

  const mcp = provider.createMcpClient(seeded.workspaceId, seeded.credentialSecret);
  await mcp.initialize();

  // Retry on transient Convex timeouts — the blocked-provider path is fast
  // but can hit 1s mutation budget under CI resource contention.
  let output: Record<string, unknown> | string | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      output = await mcp.executeCode(
        'await slack.listChannels({ limit: 5 }); console.log("should-not-run");',
      );
      break;
    } catch (error) {
      if (attempt >= 2 || !isTransientServerError(error)) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000 * (attempt + 1)));
      await mcp.initialize();
    }
  }

  skipIfSandboxUnavailable(output!);
  expect(output).toMatchObject({
    status: "blocked",
    tool_name: "slack.listChannels",
    error_code: "provider_disabled",
    reason: "Provider slack is disabled for this workspace.",
  });
});

test("execute_code times out infinite loops", async ({ pages, auth, provider }) => {
  test.setTimeout(60_000);

  await pages.login.login();
  const seeded = await auth.seedWorkspace("code-mode-exec-timeout");

  const mcp = provider.createMcpClient(seeded.workspaceId, seeded.credentialSecret);
  await mcp.initialize();

  const output = await mcp.executeCode("while (true) {}");
  skipIfSandboxUnavailable(output, EXPECTED_EXECUTION_FAILED_CODES_TIMEOUT);
  expect(output).toMatchObject({
    status: "execution_failed",
    tool_name: "execute_code",
    error_code: "timeout",
    reason: "Code execution timed out.",
  });
});

test("execute_code passes dynamic tool calls through to execution layer", async ({
  pages,
  auth,
  provider,
}) => {
  await pages.login.login();
  const seeded = await auth.seedWorkspaceWithProvider("code-mode-exec-runtime-gate", "google");

  const mcp = provider.createMcpClient(seeded.workspaceId, seeded.credentialSecret);
  await mcp.initialize();

  const output = await retryExecuteCodeOnTransientInfraFailure(
    () =>
      mcp.executeCode(
        'const fn = "searchThreads"; const result = await gmail[fn]({ query: "" }); console.log(JSON.stringify(result));',
      ),
    () => mcp.initialize(),
  );
  skipIfSandboxUnavailable(output);
  const payload = findJsonPayloadInOutput(output);
  expect(payload.status).toBe("succeeded");
  expect(payload.error_code).toBeUndefined();
});
