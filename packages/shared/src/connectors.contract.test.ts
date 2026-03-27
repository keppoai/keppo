import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { connectors } from "./connectors/index.js";
import { PROVIDER_DEFAULT_SCOPES } from "./provider-default-scopes.js";
import { createProviderTransportHarness } from "./test-utils/provider-transport-harness.js";
import { toolMap } from "./tooling.js";

type ContractProviderId =
  | "google"
  | "stripe"
  | "github"
  | "slack"
  | "notion"
  | "reddit"
  | "x"
  | "custom";

type ProviderActionScenario = {
  toolName: string;
  capability: "read" | "write";
  positiveInput: Record<string, unknown>;
};

type ProviderActionPack = {
  providerId: ContractProviderId;
  scenarios: ProviderActionScenario[];
};

type ConnectorContractCase = {
  name: string;
  provider: ContractProviderId;
  readTool: string;
  writeTool: string;
  allScopes: string[];
  missingReadScopes: string[];
  missingWriteScopes: string[];
};

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const matrixModulePath = pathToFileURL(
  path.resolve(repoRoot, "tests/provider-conformance/action-matrix.ts"),
).href;
const matrixModule = (await import(matrixModulePath)) as {
  providerActionPacks: ProviderActionPack[];
};

const providerActionPacks = matrixModule.providerActionPacks;

const getScenarioInput = (
  provider: ContractProviderId,
  toolName: string,
): Record<string, unknown> => {
  const pack = providerActionPacks.find((entry) => entry.providerId === provider);
  const scenario = pack?.scenarios.find((entry) => entry.toolName === toolName);
  if (!scenario) {
    throw new Error(`Missing provider action scenario for ${provider}/${toolName}`);
  }
  return scenario.positiveInput;
};

const buildScopes = (provider: ContractProviderId): string[] => {
  if (provider === "custom") {
    return ["custom.read", "custom.write"];
  }
  return [...PROVIDER_DEFAULT_SCOPES[provider]];
};

const isMockedTransportProvider = (
  provider: ContractProviderId,
): provider is Exclude<ContractProviderId, "custom"> => {
  return provider !== "custom";
};

const cases: ConnectorContractCase[] = [
  {
    name: "stripe",
    provider: "stripe",
    readTool: "stripe.listCharges",
    writeTool: "stripe.issueRefund",
    allScopes: buildScopes("stripe"),
    missingReadScopes: [],
    missingWriteScopes: ["stripe.read"],
  },
  {
    name: "slack",
    provider: "slack",
    readTool: "slack.listChannels",
    writeTool: "slack.postMessage",
    allScopes: buildScopes("slack"),
    missingReadScopes: [],
    missingWriteScopes: ["slack.read"],
  },
  {
    name: "github",
    provider: "github",
    readTool: "github.listIssues",
    writeTool: "github.commentIssue",
    allScopes: buildScopes("github"),
    missingReadScopes: [],
    missingWriteScopes: ["repo:read"],
  },
  {
    name: "notion",
    provider: "notion",
    readTool: "notion.searchPages",
    writeTool: "notion.createPage",
    allScopes: buildScopes("notion"),
    missingReadScopes: [],
    missingWriteScopes: ["notion.read"],
  },
  {
    name: "reddit",
    provider: "reddit",
    readTool: "reddit.searchPosts",
    writeTool: "reddit.createPost",
    allScopes: buildScopes("reddit"),
    missingReadScopes: [],
    missingWriteScopes: ["reddit.read"],
  },
  {
    name: "x",
    provider: "x",
    readTool: "x.searchPosts",
    writeTool: "x.createPost",
    allScopes: buildScopes("x"),
    missingReadScopes: [],
    missingWriteScopes: ["x.read"],
  },
  {
    name: "custom",
    provider: "custom",
    readTool: "custom.callRead",
    writeTool: "custom.callWrite",
    allScopes: buildScopes("custom"),
    missingReadScopes: [],
    missingWriteScopes: ["custom.read"],
  },
];

describe("Connector Contract Suite", () => {
  for (const testCase of cases) {
    it(`${testCase.name}: listTools/executeRead/prepareWrite/executeWrite/redact contract`, async () => {
      const connector = connectors[testCase.provider];
      if (!connector) {
        throw new Error(`Missing connector for ${testCase.provider}`);
      }

      const context = {
        workspaceId: "workspace_contract",
        orgId: "org_contract",
        scopes: testCase.allScopes,
        access_token: "test_access_token",
      };
      const readInput = getScenarioInput(testCase.provider, testCase.readTool);
      const writeInput = getScenarioInput(testCase.provider, testCase.writeTool);
      const transportHarness = isMockedTransportProvider(testCase.provider)
        ? createProviderTransportHarness(testCase.provider)
        : null;

      transportHarness?.install();
      try {
        const tools = connector.listTools(context);
        expect(tools.some((tool) => tool.name === testCase.readTool)).toBe(true);
        expect(tools.some((tool) => tool.name === testCase.writeTool)).toBe(true);

        const readOutput = await connector.executeRead(testCase.readTool, readInput, context);
        expect(typeof readOutput).toBe("object");

        const prepared = await connector.prepareWrite(testCase.writeTool, writeInput, context);
        expect(typeof prepared.normalized_payload).toBe("object");
        expect(typeof prepared.payload_preview).toBe("object");
        expect(Object.keys(prepared.normalized_payload).length).toBeGreaterThan(0);
        expect(Object.keys(prepared.payload_preview).length).toBeGreaterThan(0);

        const executed = await connector.executeWrite(
          testCase.writeTool,
          prepared.normalized_payload,
          context,
        );
        expect(typeof executed).toBe("object");
        expect(executed.status ?? executed.provider_action_id).toBeTruthy();

        if (transportHarness) {
          expect(transportHarness.listRequests().length).toBeGreaterThan(0);
        }

        const redacted = connector.redact(testCase.writeTool, {
          ...prepared.normalized_payload,
          body: "sensitive body",
          amount: 50,
          token: "secret",
        });
        expect(typeof redacted).toBe("object");

        const writeDefinition = toolMap.get(testCase.writeTool);
        expect(writeDefinition).toBeTruthy();
        if (writeDefinition && writeDefinition.redaction_policy.includes("body")) {
          expect(redacted.body).toBe("[redacted]");
        }

        await expect(
          connector.prepareWrite(testCase.writeTool, { invalid: true }, context),
        ).rejects.toThrow(/Invalid input/i);
      } finally {
        transportHarness?.restore();
      }
    });

    it(`${testCase.name}: missing scope checks`, async () => {
      const connector = connectors[testCase.provider];
      if (!connector) {
        throw new Error(`Missing connector for ${testCase.provider}`);
      }
      const readContext = {
        workspaceId: "workspace_contract",
        orgId: "org_contract",
        scopes: testCase.missingReadScopes,
        access_token: "test_access_token",
      };
      const writeContext = {
        workspaceId: "workspace_contract",
        orgId: "org_contract",
        scopes: testCase.missingWriteScopes,
        access_token: "test_access_token",
      };

      await expect(
        connector.executeRead(
          testCase.readTool,
          getScenarioInput(testCase.provider, testCase.readTool),
          readContext,
        ),
      ).rejects.toThrow(/Missing scopes/i);
      await expect(
        connector.prepareWrite(
          testCase.writeTool,
          getScenarioInput(testCase.provider, testCase.writeTool),
          writeContext,
        ),
      ).rejects.toThrow(/Missing scopes/i);
    });
  }

  it("google: gmail read/write contract uses the shared transport harness", async () => {
    const gmail = connectors.google;
    if (!gmail) {
      throw new Error("Missing Gmail connector");
    }

    const transportHarness = createProviderTransportHarness("google");
    transportHarness.install();
    try {
      const context = {
        workspaceId: "workspace_contract",
        orgId: "org_contract",
        scopes: ["gmail.readonly", "gmail.send", "gmail.modify"],
        access_token: "token_123",
      };

      const tools = gmail.listTools(context);
      expect(tools.some((tool) => tool.name === "gmail.listUnread")).toBe(true);
      expect(tools.some((tool) => tool.name === "gmail.sendEmail")).toBe(true);

      const read = await gmail.executeRead(
        "gmail.listUnread",
        getScenarioInput("google", "gmail.listUnread"),
        context,
      );
      expect(Array.isArray(read.threads)).toBe(true);

      const prepared = await gmail.prepareWrite(
        "gmail.sendEmail",
        getScenarioInput("google", "gmail.sendEmail"),
        context,
      );
      expect(prepared.normalized_payload.subject).toBe(
        String(getScenarioInput("google", "gmail.sendEmail").subject),
      );
      expect(prepared.payload_preview.subject).toBe(
        String(getScenarioInput("google", "gmail.sendEmail").subject),
      );

      const write = await gmail.executeWrite(
        "gmail.sendEmail",
        prepared.normalized_payload,
        context,
      );
      expect(write.provider_action_id).toBe("msg_sent_1");

      const redacted = gmail.redact("gmail.sendEmail", {
        body: "Hello",
        to: ["customer@example.com"],
      });
      expect(redacted.body).toBe("[redacted]");
      expect(transportHarness.listRequests().length).toBeGreaterThan(0);
    } finally {
      transportHarness.restore();
    }
  });

  it("stripe: write mode policy blocks disabled operations", async () => {
    const stripe = connectors.stripe;
    if (!stripe) {
      throw new Error("Missing Stripe connector");
    }
    const context = {
      workspaceId: "workspace_contract",
      orgId: "org_contract",
      scopes: ["stripe.read", "stripe.write"],
      metadata: {
        allowed_write_modes: ["refund"],
      },
    };

    const preparedRefund = await stripe.prepareWrite(
      "stripe.issueRefund",
      getScenarioInput("stripe", "stripe.issueRefund"),
      context,
    );
    expect(preparedRefund.normalized_payload.type).toBe("refund");

    await expect(
      stripe.prepareWrite(
        "stripe.cancelSubscription",
        {
          customerId: "cus_123",
          subscriptionId: "sub_123",
          atPeriodEnd: false,
        },
        context,
      ),
    ).rejects.toThrow(/write mode policy/i);
  });
});
