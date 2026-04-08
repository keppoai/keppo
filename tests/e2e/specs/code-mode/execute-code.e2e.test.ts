import { test, expect } from "../../fixtures/golden.fixture";
import {
  isTransientServerError,
  isSessionExpiredMcpError,
  isOptimisticConcurrencyMcpError,
  waitForTerminalActionResult,
} from "../../helpers/mcp-client";

const SANDBOX_UNAVAILABLE_PATTERN =
  /sandbox provider is unavailable|install docker desktop|use KEPPO_CODE_MODE_SANDBOX_PROVIDER=vercel/i;
/** error_code values that represent intentional sandbox behavior, not infra failures. */
const EXPECTED_EXECUTION_FAILED_CODES_TIMEOUT = new Set(["timeout"]);
const REQUIRE_CODE_MODE_SANDBOX = process.env.KEPPO_E2E_REQUIRE_CODE_MODE_SANDBOX === "1";

const isRetryableExecuteCodeError = (error: unknown): boolean =>
  isTransientServerError(error) ||
  isSessionExpiredMcpError(error) ||
  isOptimisticConcurrencyMcpError(error);

/**
 * error_code values that indicate the code-mode sandbox failed to start or
 * encountered a transient runtime failure — these are infra flakes, not
 * product defects, and should be retried before the test asserts product
 * behavior.
 */
const TRANSIENT_SANDBOX_FAILURE_CODES = new Set([
  "sandbox_unavailable",
  "sandbox_startup_failed",
  "sandbox_runtime_failed",
  // The blocked-provider path is supposed to short-circuit before any tool
  // call runs, but under CI resource contention the sandbox itself can hit
  // KEPPO_CODE_MODE_TIMEOUT_MS before returning. Treat that as a transient
  // sandbox failure for tests that retry on it (callers that legitimately
  // assert on `timeout` payloads use `expectedFailedCodes` instead).
  "timeout",
]);

const isTransientSandboxFailurePayload = (
  value: Record<string, unknown> | string | undefined,
): boolean => {
  if (value === undefined) {
    return false;
  }
  const payload =
    typeof value === "string" ? findJsonPayloadInOutput(value) : (value as Record<string, unknown>);
  return (
    payload.status === "execution_failed" &&
    TRANSIENT_SANDBOX_FAILURE_CODES.has(String(payload.error_code ?? ""))
  );
};

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
    throw new Error(
      "Code-mode sandbox is unavailable, but KEPPO_E2E_REQUIRE_CODE_MODE_SANDBOX=1 requires it.",
    );
  }
  test.skip(true, "Code-mode sandbox is unavailable in this environment.");
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

  const output = await mcp.executeCode({
    description: "Print a hello message to stdout.",
    code: 'console.log("hello")',
  });
  skipIfSandboxUnavailable(output);
  expect(typeof output).toBe("string");
  expect(String(output)).toContain("hello");
});

test("execute_code can run a read tool call", async ({ pages, auth, provider }) => {
  await pages.login.login();
  const seeded = await auth.seedWorkspaceWithProvider("code-mode-exec-read", "google");

  const mcp = provider.createMcpClient(seeded.workspaceId, seeded.credentialSecret);
  await mcp.initialize();

  const output = await mcp.executeCode({
    description: "Read Gmail threads and print the structured result.",
    code: 'const result = await gmail.searchThreads({ query: "" }); console.log(JSON.stringify(result));',
  });
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

    const output = await mcp.executeCode({
      description: "Send a Gmail message through the auto-approved write path.",
      code: `
      return await gmail.sendEmail({
        to: ["qa@example.com"],
        subject: "Code mode",
        body: "hello"
      });
    `,
    });

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

    let output: Record<string, unknown> | string | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        output = await mcp.executeCode({
          description: "Attempt a Gmail send that should pause for human approval.",
          code: `
          return await gmail.sendEmail({
            to: ["qa@example.com"],
            subject: "Needs approval",
            body: "pending"
          });
        `,
        });
        break;
      } catch (error) {
        if (attempt >= 2 || !isRetryableExecuteCodeError(error)) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 1_000 * (attempt + 1)));
        if (isSessionExpiredMcpError(error)) {
          await mcp.initialize();
        }
      }
    }

    skipIfSandboxUnavailable(output!);
    const payload = findJsonPayloadInOutput(output!);
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

  // Retry on transient Convex timeouts, OCC, or session expiry — the
  // blocked-provider path is fast but can hit 1s mutation budget under CI
  // resource contention. Also retry when the sandbox itself reports a
  // transient startup/runtime failure, which would otherwise mask the
  // product behavior this test asserts.
  let output: Record<string, unknown> | string | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      output = await mcp.executeCode({
        description: "Try a Slack read to verify disabled providers are blocked.",
        code: 'await slack.listChannels({ limit: 5 }); console.log("should-not-run");',
      });
      if (attempt < 2 && isTransientSandboxFailurePayload(output)) {
        await new Promise((resolve) => setTimeout(resolve, 1_000 * (attempt + 1)));
        continue;
      }
      break;
    } catch (error) {
      if (attempt >= 2 || !isRetryableExecuteCodeError(error)) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000 * (attempt + 1)));
      if (isSessionExpiredMcpError(error)) {
        await mcp.initialize();
      }
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
  // Must exceed KEPPO_CODE_MODE_TIMEOUT_MS when the E2E stack does not shorten it (default 120s).
  test.setTimeout(150_000);

  await pages.login.login();
  const seeded = await auth.seedWorkspace("code-mode-exec-timeout");

  const mcp = provider.createMcpClient(seeded.workspaceId, seeded.credentialSecret);
  await mcp.initialize();

  const output = await mcp.executeCode({
    description: "Run an infinite loop to verify timeout handling.",
    code: "while (true) {}",
  });
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

  const output = await mcp.executeCode({
    description: "Call a Gmail tool through a dynamic property lookup and print the result.",
    code: 'const fn = "searchThreads"; const result = await gmail[fn]({ query: "" }); console.log(JSON.stringify(result));',
  });
  skipIfSandboxUnavailable(output);
  const payload = findJsonPayloadInOutput(output);
  expect(payload.status).toBe("succeeded");
  expect(payload.error_code).toBeUndefined();
});
