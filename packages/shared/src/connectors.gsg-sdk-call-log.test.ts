import { describe, expect, it } from "vitest";
import { createGoogleConnector } from "./providers/modules/google/connector.js";
import { createStripeConnector } from "./providers/modules/stripe/connector.js";
import { createGithubConnector } from "./providers/modules/github/connector.js";
import { createFakeGmailClientStore, createFakeGmailSdk } from "./provider-sdk/google/fake.js";
import { createFakeStripeClientStore, createFakeStripeSdk } from "./provider-sdk/stripe/fake.js";
import { createFakeGithubClientStore, createFakeGithubSdk } from "./provider-sdk/github/fake.js";
import type { ProviderSdkCallRecord } from "./provider-sdk/port.js";

type Scenario = {
  toolName: string;
  capability: "read" | "write";
  positiveInput: Record<string, unknown>;
  negativeInput: Record<string, unknown>;
  expectedCalls: Array<{
    method: string;
    assertArgs?: (args: Record<string, unknown>) => boolean;
    requireIdempotencyKey?: boolean;
  }>;
  idempotentMethod?: string;
};

const namespace = "contract-gsg";

const asRecord = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
};

const asStringArray = (value: unknown): string[] => {
  return Array.isArray(value) ? value.map((entry) => String(entry)) : [];
};

const hasArgs = (args: Record<string, unknown>, expected: Record<string, unknown>): boolean => {
  for (const [key, value] of Object.entries(expected)) {
    if (args[key] !== value) {
      return false;
    }
  }
  return true;
};

const findCall = (
  calls: ProviderSdkCallRecord[],
  method: string,
  assertArgs?: (args: Record<string, unknown>) => boolean,
): ProviderSdkCallRecord | null => {
  for (const call of calls) {
    if (call.method !== method) {
      continue;
    }
    if (!assertArgs || assertArgs(asRecord(call.args))) {
      return call;
    }
  }
  return null;
};

const assertExpectedCalls = (
  scope: string,
  calls: ProviderSdkCallRecord[],
  scenario: Scenario,
): void => {
  expect(calls.length, `${scope} did not record SDK calls`).toBeGreaterThan(0);

  for (const expectation of scenario.expectedCalls) {
    const matched = findCall(calls, expectation.method, expectation.assertArgs);
    expect(matched, `${scope} missing expected SDK call ${expectation.method}`).toBeTruthy();
    if (expectation.requireIdempotencyKey) {
      expect(
        typeof matched?.idempotencyKey === "string" && String(matched.idempotencyKey).length > 0,
        `${scope} expected idempotency key for ${expectation.method}`,
      ).toBe(true);
    }
  }
};

describe("connector sdk call-log contract: gmail/stripe/github", () => {
  it("gmail actions validate method + args + idempotency", async () => {
    const clientStore = createFakeGmailClientStore();
    const sdk = createFakeGmailSdk({ clientStore });
    const connector = createGoogleConnector({ sdk });
    const context = {
      workspaceId: "workspace_gsg",
      orgId: "org_gsg",
      scopes: ["gmail.readonly", "gmail.send", "gmail.modify", "gmail.compose", "gmail.labels"],
      access_token: "fake_gmail_access_token",
      metadata: { e2e_namespace: namespace },
    };

    const scenarios: Scenario[] = [
      {
        toolName: "gmail.searchThreads",
        capability: "read",
        positiveInput: { query: "is:unread", limit: 1 },
        negativeInput: { query: "is:unread", limit: 0 },
        expectedCalls: [
          {
            method: "gmail.users.messages.list",
            assertArgs: (args) => hasArgs(args, { query: "is:unread", maxResults: 1 }),
          },
          {
            method: "gmail.users.messages.get",
            assertArgs: (args) =>
              typeof args.messageId === "string" && String(args.messageId).length > 0,
          },
        ],
      },
      {
        toolName: "gmail.listUnread",
        capability: "read",
        positiveInput: { limit: 1 },
        negativeInput: { limit: 0 },
        expectedCalls: [
          {
            method: "gmail.users.messages.list",
            assertArgs: (args) => hasArgs(args, { query: "is:unread", maxResults: 1 }),
          },
          {
            method: "gmail.users.messages.get",
            assertArgs: (args) =>
              typeof args.messageId === "string" && String(args.messageId).length > 0,
          },
        ],
      },
      {
        toolName: "gmail.fetchMessageBody",
        capability: "read",
        positiveInput: { messageId: "msg_seed_1" },
        negativeInput: { messageId: "" },
        expectedCalls: [
          {
            method: "gmail.users.messages.get",
            assertArgs: (args) => hasArgs(args, { messageId: "msg_seed_1", format: "full" }),
          },
        ],
      },
      {
        toolName: "gmail.fetchAttachmentsMetadata",
        capability: "read",
        positiveInput: { messageId: "msg_seed_1" },
        negativeInput: { messageId: "" },
        expectedCalls: [
          {
            method: "gmail.users.messages.get",
            assertArgs: (args) => hasArgs(args, { messageId: "msg_seed_1", format: "full" }),
          },
        ],
      },
      {
        toolName: "gmail.sendEmail",
        capability: "write",
        positiveInput: {
          to: ["provider@example.com"],
          cc: [],
          bcc: [],
          subject: "Contract send",
          body: "gmail contract",
        },
        negativeInput: {
          to: [],
          subject: "Contract send",
          body: "gmail contract",
        },
        expectedCalls: [
          {
            method: "gmail.users.messages.send",
            requireIdempotencyKey: true,
          },
        ],
        idempotentMethod: "gmail.users.messages.send",
      },
      {
        toolName: "gmail.replyToThread",
        capability: "write",
        positiveInput: {
          threadId: "thr_seed_1",
          to: ["provider@example.com"],
          body: "gmail reply",
        },
        negativeInput: {
          threadId: "",
          to: ["provider@example.com"],
          body: "gmail reply",
        },
        expectedCalls: [
          {
            method: "gmail.users.messages.send",
            requireIdempotencyKey: true,
          },
        ],
        idempotentMethod: "gmail.users.messages.send",
      },
      {
        toolName: "gmail.applyLabel",
        capability: "write",
        positiveInput: { threadId: "thr_seed_1", label: "STARRED" },
        negativeInput: { threadId: "", label: "STARRED" },
        expectedCalls: [
          {
            method: "gmail.users.threads.modify",
            requireIdempotencyKey: true,
            assertArgs: (args) => {
              return (
                hasArgs(args, { threadId: "thr_seed_1" }) &&
                asStringArray(args.addLabelIds).includes("STARRED")
              );
            },
          },
        ],
        idempotentMethod: "gmail.users.threads.modify",
      },
      {
        toolName: "gmail.archive",
        capability: "write",
        positiveInput: { threadId: "thr_seed_1" },
        negativeInput: { threadId: "" },
        expectedCalls: [
          {
            method: "gmail.users.threads.modify",
            requireIdempotencyKey: true,
            assertArgs: (args) => {
              return (
                hasArgs(args, { threadId: "thr_seed_1" }) &&
                asStringArray(args.removeLabelIds).includes("INBOX")
              );
            },
          },
        ],
        idempotentMethod: "gmail.users.threads.modify",
      },
      {
        toolName: "gmail.getProfile",
        capability: "read",
        positiveInput: {},
        negativeInput: { _reserved: "invalid" },
        expectedCalls: [
          {
            method: "gmail.users.getProfile",
          },
        ],
      },
      {
        toolName: "gmail.getThread",
        capability: "read",
        positiveInput: { threadId: "thr_seed_1" },
        negativeInput: { threadId: "" },
        expectedCalls: [
          {
            method: "gmail.users.threads.get",
            assertArgs: (args) => hasArgs(args, { threadId: "thr_seed_1", format: "full" }),
          },
        ],
      },
      {
        toolName: "gmail.listLabels",
        capability: "read",
        positiveInput: {},
        negativeInput: { _reserved: "invalid" },
        expectedCalls: [
          {
            method: "gmail.users.labels.list",
          },
        ],
      },
      {
        toolName: "gmail.createLabel",
        capability: "write",
        positiveInput: {
          name: "Needs-Response",
          labelListVisibility: "labelShow",
          messageListVisibility: "show",
        },
        negativeInput: {
          name: "",
        },
        expectedCalls: [
          {
            method: "gmail.users.labels.create",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { name: "Needs-Response" }),
          },
        ],
        idempotentMethod: "gmail.users.labels.create",
      },
      {
        toolName: "gmail.createDraft",
        capability: "write",
        positiveInput: {
          to: ["support@example.com"],
          cc: [],
          bcc: [],
          subject: "Draft message",
          body: "Draft body",
          threadId: "thr_seed_1",
        },
        negativeInput: {
          to: [],
          subject: "Draft message",
          body: "Draft body",
        },
        expectedCalls: [
          {
            method: "gmail.users.drafts.create",
            requireIdempotencyKey: true,
          },
        ],
        idempotentMethod: "gmail.users.drafts.create",
      },
      {
        toolName: "gmail.listDrafts",
        capability: "read",
        positiveInput: { limit: 2 },
        negativeInput: { limit: 0 },
        expectedCalls: [
          {
            method: "gmail.users.drafts.list",
            assertArgs: (args) => hasArgs(args, { maxResults: 2 }),
          },
        ],
      },
      {
        toolName: "gmail.getDraft",
        capability: "read",
        positiveInput: { draftId: "dr_seed_1" },
        negativeInput: { draftId: "" },
        expectedCalls: [
          {
            method: "gmail.users.drafts.get",
            assertArgs: (args) => hasArgs(args, { draftId: "dr_seed_1", format: "full" }),
          },
        ],
      },
      {
        toolName: "gmail.updateDraft",
        capability: "write",
        positiveInput: {
          draftId: "dr_seed_1",
          to: ["support@example.com"],
          cc: [],
          bcc: [],
          subject: "Updated draft",
          body: "Updated draft body",
          threadId: "thr_seed_1",
        },
        negativeInput: {
          draftId: "",
          to: ["support@example.com"],
          subject: "Updated draft",
          body: "Updated draft body",
        },
        expectedCalls: [
          {
            method: "gmail.users.drafts.update",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { draftId: "dr_seed_1" }),
          },
        ],
        idempotentMethod: "gmail.users.drafts.update",
      },
      {
        toolName: "gmail.sendDraft",
        capability: "write",
        positiveInput: {
          draftId: "dr_seed_1",
        },
        negativeInput: {
          draftId: "",
        },
        expectedCalls: [
          {
            method: "gmail.users.drafts.send",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { draftId: "dr_seed_1" }),
          },
        ],
        idempotentMethod: "gmail.users.drafts.send",
      },
      {
        toolName: "gmail.batchModifyMessages",
        capability: "write",
        positiveInput: {
          messageIds: ["msg_seed_1", "msg_seed_2"],
          addLabelIds: ["Label_1"],
          removeLabelIds: ["UNREAD"],
        },
        negativeInput: {
          messageIds: [],
          addLabelIds: [],
          removeLabelIds: [],
        },
        expectedCalls: [
          {
            method: "gmail.users.messages.batchModify",
            requireIdempotencyKey: true,
            assertArgs: (args) => {
              return (
                asStringArray(args.messageIds).length === 2 &&
                asStringArray(args.addLabelIds).includes("Label_1") &&
                asStringArray(args.removeLabelIds).includes("UNREAD")
              );
            },
          },
        ],
        idempotentMethod: "gmail.users.messages.batchModify",
      },
      {
        toolName: "gmail.listHistory",
        capability: "read",
        positiveInput: { startHistoryId: "1000", limit: 10 },
        negativeInput: { startHistoryId: "", limit: 10 },
        expectedCalls: [
          {
            method: "gmail.users.history.list",
            assertArgs: (args) => hasArgs(args, { startHistoryId: "1000", maxResults: 10 }),
          },
        ],
      },
      {
        toolName: "gmail.watch",
        capability: "write",
        positiveInput: {
          topicName: "projects/example/topics/support-mail",
          labelIds: ["INBOX"],
          labelFilterBehavior: "include",
        },
        negativeInput: {
          topicName: "",
          labelIds: [],
          labelFilterBehavior: "include",
        },
        expectedCalls: [
          {
            method: "gmail.users.watch",
            requireIdempotencyKey: true,
            assertArgs: (args) =>
              hasArgs(args, {
                topicName: "projects/example/topics/support-mail",
                labelFilterBehavior: "include",
              }),
          },
        ],
        idempotentMethod: "gmail.users.watch",
      },
      {
        toolName: "gmail.stopWatch",
        capability: "write",
        positiveInput: {},
        negativeInput: { _reserved: "invalid" },
        expectedCalls: [
          {
            method: "gmail.users.stop",
            requireIdempotencyKey: true,
          },
        ],
        idempotentMethod: "gmail.users.stop",
      },
    ];

    for (const scenario of scenarios) {
      const scope = `gmail/${scenario.toolName}`;
      const before = sdk.callLog.list(namespace).length;

      if (scenario.capability === "read") {
        await connector.executeRead(scenario.toolName, scenario.positiveInput, context);
      } else {
        const prepared = await connector.prepareWrite(
          scenario.toolName,
          scenario.positiveInput,
          context,
        );
        const first = await connector.executeWrite(
          scenario.toolName,
          prepared.normalized_payload,
          context,
        );
        const second = await connector.executeWrite(
          scenario.toolName,
          prepared.normalized_payload,
          context,
        );
        expect(second).toEqual(first);
      }

      const afterPositive = sdk.callLog.list(namespace);
      const positiveCalls = afterPositive.slice(before);
      assertExpectedCalls(scope, positiveCalls, scenario);

      if (scenario.idempotentMethod) {
        const idempotentCalls = positiveCalls.filter(
          (call) => call.method === scenario.idempotentMethod,
        );
        const keySet = new Set(
          idempotentCalls
            .map((call) => (typeof call.idempotencyKey === "string" ? call.idempotencyKey : ""))
            .filter((entry) => entry.length > 0),
        );
        expect(keySet.size, `${scope} idempotency key missing or unstable`).toBe(1);
      }

      const beforeNegative = sdk.callLog.list(namespace).length;
      if (scenario.capability === "read") {
        await expect(
          connector.executeRead(scenario.toolName, scenario.negativeInput, context),
        ).rejects.toThrow(/Invalid input/i);
      } else {
        await expect(
          connector.prepareWrite(scenario.toolName, scenario.negativeInput, context),
        ).rejects.toThrow(/Invalid input/i);
      }
      const afterNegative = sdk.callLog.list(namespace).length;
      expect(afterNegative, `${scope} negative path emitted SDK calls`).toBe(beforeNegative);
    }
  });

  it("stripe actions validate method + args + idempotency", async () => {
    const clientStore = createFakeStripeClientStore();
    const sdk = createFakeStripeSdk({ clientStore });
    const connector = createStripeConnector({ sdk });
    const context = {
      workspaceId: "workspace_gsg",
      orgId: "org_gsg",
      scopes: ["stripe.read", "stripe.write"],
      access_token: "fake_stripe_access_token",
      metadata: { e2e_namespace: namespace },
    };

    const scenarios: Scenario[] = [
      {
        toolName: "stripe.lookupCustomer",
        capability: "read",
        positiveInput: { customerId: "cus_100" },
        negativeInput: { customerId: "" },
        expectedCalls: [
          {
            method: "stripe.customers.retrieve",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100" }),
          },
        ],
      },
      {
        toolName: "stripe.listSubscriptions",
        capability: "read",
        positiveInput: { customerId: "cus_100" },
        negativeInput: { customerId: "" },
        expectedCalls: [
          {
            method: "stripe.customers.retrieve",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100" }),
          },
        ],
      },
      {
        toolName: "stripe.listCharges",
        capability: "read",
        positiveInput: { customerId: "cus_100" },
        negativeInput: { customerId: "" },
        expectedCalls: [
          {
            method: "stripe.charges.list",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100" }),
          },
        ],
      },
      {
        toolName: "stripe.invoiceHistory",
        capability: "read",
        positiveInput: { customerId: "cus_100" },
        negativeInput: { customerId: "" },
        expectedCalls: [
          {
            method: "stripe.invoices.list",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100" }),
          },
        ],
      },
      {
        toolName: "stripe.issueRefund",
        capability: "write",
        positiveInput: {
          customerId: "cus_100",
          chargeId: "ch_cus_100",
          amount: 49,
          currency: "usd",
        },
        negativeInput: {
          customerId: "cus_100",
          chargeId: "",
          amount: 49,
          currency: "usd",
        },
        expectedCalls: [
          {
            method: "stripe.customers.retrieve",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100" }),
          },
          {
            method: "stripe.charges.list",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100" }),
          },
          {
            method: "stripe.refunds.create",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100", chargeId: "ch_cus_100" }),
          },
        ],
        idempotentMethod: "stripe.refunds.create",
      },
      {
        toolName: "stripe.cancelSubscription",
        capability: "write",
        positiveInput: {
          customerId: "cus_100",
          subscriptionId: "sub_100",
          atPeriodEnd: false,
        },
        negativeInput: {
          customerId: "cus_100",
          subscriptionId: "",
          atPeriodEnd: false,
        },
        expectedCalls: [
          {
            method: "stripe.customers.retrieve",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100" }),
          },
          {
            method: "stripe.subscriptions.cancel",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { subscriptionId: "sub_100" }),
          },
        ],
        idempotentMethod: "stripe.subscriptions.cancel",
      },
      {
        toolName: "stripe.adjustBalance",
        capability: "write",
        positiveInput: {
          customerId: "cus_100",
          amount: 5,
          currency: "usd",
          reason: "contract adjustment",
        },
        negativeInput: {
          customerId: "cus_100",
          amount: 5,
          currency: "usd",
          reason: "",
        },
        expectedCalls: [
          {
            method: "stripe.customers.retrieve",
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100" }),
          },
          {
            method: "stripe.customers.createBalanceTransaction",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { customerId: "cus_100", amount: 5 }),
          },
        ],
        idempotentMethod: "stripe.customers.createBalanceTransaction",
      },
    ];

    for (const scenario of scenarios) {
      const scope = `stripe/${scenario.toolName}`;
      const before = sdk.callLog.list(namespace).length;

      if (scenario.capability === "read") {
        await connector.executeRead(scenario.toolName, scenario.positiveInput, context);
      } else {
        const prepared = await connector.prepareWrite(
          scenario.toolName,
          scenario.positiveInput,
          context,
        );
        const first = await connector.executeWrite(
          scenario.toolName,
          prepared.normalized_payload,
          context,
        );
        const second = await connector.executeWrite(
          scenario.toolName,
          prepared.normalized_payload,
          context,
        );
        expect(second).toEqual(first);
      }

      const afterPositive = sdk.callLog.list(namespace);
      const positiveCalls = afterPositive.slice(before);
      assertExpectedCalls(scope, positiveCalls, scenario);

      if (scenario.idempotentMethod) {
        const idempotentCalls = positiveCalls.filter(
          (call) => call.method === scenario.idempotentMethod,
        );
        const keySet = new Set(
          idempotentCalls
            .map((call) => (typeof call.idempotencyKey === "string" ? call.idempotencyKey : ""))
            .filter((entry) => entry.length > 0),
        );
        expect(keySet.size, `${scope} idempotency key missing or unstable`).toBe(1);
      }

      const beforeNegative = sdk.callLog.list(namespace).length;
      if (scenario.capability === "read") {
        await expect(
          connector.executeRead(scenario.toolName, scenario.negativeInput, context),
        ).rejects.toThrow(/Invalid input/i);
      } else {
        await expect(
          connector.prepareWrite(scenario.toolName, scenario.negativeInput, context),
        ).rejects.toThrow(/Invalid input/i);
      }
      const afterNegative = sdk.callLog.list(namespace).length;
      expect(afterNegative, `${scope} negative path emitted SDK calls`).toBe(beforeNegative);
    }
  });

  it("github actions validate method + args + idempotency", async () => {
    const clientStore = createFakeGithubClientStore();
    const sdk = createFakeGithubSdk({ clientStore });
    const connector = createGithubConnector({ sdk });
    const context = {
      workspaceId: "workspace_gsg",
      orgId: "org_gsg",
      scopes: ["repo:read", "repo:write"],
      access_token: "fake_github_access_token",
      metadata: { e2e_namespace: namespace },
    };

    const scenarios: Scenario[] = [
      {
        toolName: "github.listIssues",
        capability: "read",
        positiveInput: { repo: "keppo", state: "open", perPage: 10 },
        negativeInput: { repo: "" },
        expectedCalls: [
          {
            method: "github.issues.listForRepo",
            assertArgs: (args) => hasArgs(args, { repo: "keppo", state: "open", perPage: 10 }),
          },
        ],
      },
      {
        toolName: "github.getIssue",
        capability: "read",
        positiveInput: { repo: "keppo", issue: 1 },
        negativeInput: { repo: "keppo", issue: 0 },
        expectedCalls: [
          {
            method: "github.issues.get",
            assertArgs: (args) => hasArgs(args, { repo: "keppo", issue: 1 }),
          },
        ],
      },
      {
        toolName: "github.listPullRequests",
        capability: "read",
        positiveInput: { repo: "keppo", state: "open", perPage: 10 },
        negativeInput: { repo: "" },
        expectedCalls: [
          {
            method: "github.pulls.list",
            assertArgs: (args) => hasArgs(args, { repo: "keppo", state: "open", perPage: 10 }),
          },
        ],
      },
      {
        toolName: "github.getPullRequest",
        capability: "read",
        positiveInput: { repo: "keppo", pullNumber: 5 },
        negativeInput: { repo: "keppo", pullNumber: 0 },
        expectedCalls: [
          {
            method: "github.pulls.get",
            assertArgs: (args) => hasArgs(args, { repo: "keppo", pullNumber: 5 }),
          },
        ],
      },
      {
        toolName: "github.listPRFiles",
        capability: "read",
        positiveInput: { repo: "keppo", pullNumber: 5, perPage: 20 },
        negativeInput: { repo: "keppo", pullNumber: 0, perPage: 20 },
        expectedCalls: [
          {
            method: "github.pulls.listFiles",
            assertArgs: (args) => hasArgs(args, { repo: "keppo", pullNumber: 5, perPage: 20 }),
          },
        ],
      },
      {
        toolName: "github.searchIssues",
        capability: "read",
        positiveInput: { repo: "keppo", query: "label:bug", perPage: 5 },
        negativeInput: { repo: "", query: "label:bug", perPage: 5 },
        expectedCalls: [
          {
            method: "github.search.issuesAndPullRequests",
            assertArgs: (args) =>
              hasArgs(args, { perPage: 5 }) &&
              typeof args.query === "string" &&
              String(args.query).includes("repo:keppo"),
          },
        ],
      },
      {
        toolName: "github.getRepo",
        capability: "read",
        positiveInput: { repo: "keppo" },
        negativeInput: { repo: "" },
        expectedCalls: [
          {
            method: "github.repos.get",
            assertArgs: (args) => hasArgs(args, { repo: "keppo" }),
          },
        ],
      },
      {
        toolName: "github.listBranches",
        capability: "read",
        positiveInput: { repo: "keppo", perPage: 10 },
        negativeInput: { repo: "", perPage: 10 },
        expectedCalls: [
          {
            method: "github.repos.listBranches",
            assertArgs: (args) => hasArgs(args, { repo: "keppo", perPage: 10 }),
          },
        ],
      },
      {
        toolName: "github.getFileContents",
        capability: "read",
        positiveInput: { repo: "keppo", path: "README.md", ref: "main" },
        negativeInput: { repo: "keppo", path: "" },
        expectedCalls: [
          {
            method: "github.repos.getContent",
            assertArgs: (args) => hasArgs(args, { repo: "keppo", path: "README.md", ref: "main" }),
          },
        ],
      },
      {
        toolName: "github.listLabels",
        capability: "read",
        positiveInput: { repo: "keppo", perPage: 10 },
        negativeInput: { repo: "", perPage: 10 },
        expectedCalls: [
          {
            method: "github.issues.listLabelsForRepo",
            assertArgs: (args) => hasArgs(args, { repo: "keppo", perPage: 10 }),
          },
        ],
      },
      {
        toolName: "github.commentIssue",
        capability: "write",
        positiveInput: {
          repo: "keppo",
          issue: 1,
          body: "contract comment",
        },
        negativeInput: {
          repo: "keppo",
          issue: 1,
          body: "",
        },
        expectedCalls: [
          {
            method: "github.issues.get",
            assertArgs: (args) => hasArgs(args, { repo: "keppo" }),
          },
          {
            method: "github.issues.createComment",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { repo: "keppo", issue: 1 }),
          },
        ],
        idempotentMethod: "github.issues.createComment",
      },
      {
        toolName: "github.createIssue",
        capability: "write",
        positiveInput: {
          repo: "keppo",
          title: "contract issue",
          body: "contract body",
          labels: ["bug"],
          assignees: ["octocat"],
        },
        negativeInput: {
          repo: "keppo",
          title: "",
        },
        expectedCalls: [
          {
            method: "github.issues.create",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { repo: "keppo", title: "contract issue" }),
          },
        ],
        idempotentMethod: "github.issues.create",
      },
      {
        toolName: "github.updateIssue",
        capability: "write",
        positiveInput: {
          repo: "keppo",
          issue: 1,
          state: "closed",
          labels: ["bug", "triaged"],
        },
        negativeInput: {
          repo: "keppo",
          issue: 1,
        },
        expectedCalls: [
          {
            method: "github.issues.update",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { repo: "keppo", issue: 1, state: "closed" }),
          },
        ],
        idempotentMethod: "github.issues.update",
      },
      {
        toolName: "github.createPullRequest",
        capability: "write",
        positiveInput: {
          repo: "keppo",
          title: "contract pr",
          head: "feature/contract",
          base: "main",
          body: "contract body",
        },
        negativeInput: {
          repo: "keppo",
          title: "contract pr",
          head: "",
          base: "main",
        },
        expectedCalls: [
          {
            method: "github.pulls.create",
            requireIdempotencyKey: true,
            assertArgs: (args) =>
              hasArgs(args, { repo: "keppo", title: "contract pr", head: "feature/contract" }),
          },
        ],
        idempotentMethod: "github.pulls.create",
      },
      {
        toolName: "github.mergePullRequest",
        capability: "write",
        positiveInput: {
          repo: "keppo",
          pullNumber: 5,
          mergeMethod: "squash",
        },
        negativeInput: {
          repo: "keppo",
          pullNumber: 0,
        },
        expectedCalls: [
          {
            method: "github.pulls.merge",
            requireIdempotencyKey: true,
            assertArgs: (args) =>
              hasArgs(args, { repo: "keppo", pullNumber: 5, mergeMethod: "squash" }),
          },
        ],
        idempotentMethod: "github.pulls.merge",
      },
      {
        toolName: "github.addLabels",
        capability: "write",
        positiveInput: {
          repo: "keppo",
          issue: 1,
          labels: ["bug", "triaged"],
        },
        negativeInput: {
          repo: "keppo",
          issue: 1,
          labels: [],
        },
        expectedCalls: [
          {
            method: "github.issues.addLabels",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { repo: "keppo", issue: 1 }),
          },
        ],
        idempotentMethod: "github.issues.addLabels",
      },
      {
        toolName: "github.createLabel",
        capability: "write",
        positiveInput: {
          repo: "keppo",
          name: "triaged",
          color: "0e8a16",
          description: "Ready for triage",
        },
        negativeInput: {
          repo: "keppo",
          name: "",
          color: "0e8a16",
        },
        expectedCalls: [
          {
            method: "github.issues.createLabel",
            requireIdempotencyKey: true,
            assertArgs: (args) =>
              hasArgs(args, {
                repo: "keppo",
                name: "triaged",
                color: "0e8a16",
              }),
          },
        ],
        idempotentMethod: "github.issues.createLabel",
      },
      {
        toolName: "github.createOrUpdateFile",
        capability: "write",
        positiveInput: {
          repo: "keppo",
          path: "docs/status.md",
          message: "Update status",
          content: "status: green",
          branch: "main",
        },
        negativeInput: {
          repo: "keppo",
          path: "",
          message: "Update status",
          content: "status: green",
        },
        expectedCalls: [
          {
            method: "github.repos.createOrUpdateFileContents",
            requireIdempotencyKey: true,
            assertArgs: (args) =>
              hasArgs(args, {
                repo: "keppo",
                path: "docs/status.md",
                message: "Update status",
                branch: "main",
              }),
          },
        ],
        idempotentMethod: "github.repos.createOrUpdateFileContents",
      },
      {
        toolName: "github.removeLabel",
        capability: "write",
        positiveInput: {
          repo: "keppo",
          issue: 1,
          label: "bug",
        },
        negativeInput: {
          repo: "keppo",
          issue: 1,
          label: "",
        },
        expectedCalls: [
          {
            method: "github.issues.removeLabel",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { repo: "keppo", issue: 1, label: "bug" }),
          },
        ],
        idempotentMethod: "github.issues.removeLabel",
      },
      {
        toolName: "github.addAssignees",
        capability: "write",
        positiveInput: {
          repo: "keppo",
          issue: 1,
          assignees: ["octocat"],
        },
        negativeInput: {
          repo: "keppo",
          issue: 0,
          assignees: ["octocat"],
        },
        expectedCalls: [
          {
            method: "github.issues.addAssignees",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { repo: "keppo", issue: 1 }),
          },
        ],
        idempotentMethod: "github.issues.addAssignees",
      },
      {
        toolName: "github.removeAssignees",
        capability: "write",
        positiveInput: {
          repo: "keppo",
          issue: 1,
          assignees: ["octocat"],
        },
        negativeInput: {
          repo: "keppo",
          issue: 0,
          assignees: ["octocat"],
        },
        expectedCalls: [
          {
            method: "github.issues.removeAssignees",
            requireIdempotencyKey: true,
            assertArgs: (args) => hasArgs(args, { repo: "keppo", issue: 1 }),
          },
        ],
        idempotentMethod: "github.issues.removeAssignees",
      },
    ];

    for (const scenario of scenarios) {
      const scope = `github/${scenario.toolName}`;
      const before = sdk.callLog.list(namespace).length;

      if (scenario.capability === "read") {
        await connector.executeRead(scenario.toolName, scenario.positiveInput, context);
      } else {
        const prepared = await connector.prepareWrite(
          scenario.toolName,
          scenario.positiveInput,
          context,
        );
        const first = await connector.executeWrite(
          scenario.toolName,
          prepared.normalized_payload,
          context,
        );
        const second = await connector.executeWrite(
          scenario.toolName,
          prepared.normalized_payload,
          context,
        );
        expect(second).toEqual(first);
      }

      const afterPositive = sdk.callLog.list(namespace);
      const positiveCalls = afterPositive.slice(before);
      assertExpectedCalls(scope, positiveCalls, scenario);

      if (scenario.idempotentMethod) {
        const idempotentCalls = positiveCalls.filter(
          (call) => call.method === scenario.idempotentMethod,
        );
        const keySet = new Set(
          idempotentCalls
            .map((call) => (typeof call.idempotencyKey === "string" ? call.idempotencyKey : ""))
            .filter((entry) => entry.length > 0),
        );
        expect(keySet.size, `${scope} idempotency key missing or unstable`).toBe(1);
      }

      const beforeNegative = sdk.callLog.list(namespace).length;
      if (scenario.capability === "read") {
        await expect(
          connector.executeRead(scenario.toolName, scenario.negativeInput, context),
        ).rejects.toThrow(/Invalid input/i);
      } else {
        await expect(
          connector.prepareWrite(scenario.toolName, scenario.negativeInput, context),
        ).rejects.toThrow(/Invalid input/i);
      }
      const afterNegative = sdk.callLog.list(namespace).length;
      expect(afterNegative, `${scope} negative path emitted SDK calls`).toBe(beforeNegative);
    }
  });
});
