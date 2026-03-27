import { describe, expect, it } from "vitest";
import { connectors } from "./connectors/index.js";

describe("Connectors", () => {
  it("gmail prepareWrite generates preview from normalized payload", async () => {
    const gmail = connectors.google!;
    const prepared = await gmail.prepareWrite(
      "gmail.sendEmail",
      {
        to: ["user@example.com"],
        cc: [],
        bcc: [],
        subject: "Subject",
        body: "Hello from test",
      },
      {
        workspaceId: "workspace_demo",
        orgId: "org_demo",
        scopes: ["gmail.send", "gmail.modify", "gmail.readonly"],
      },
    );

    expect(prepared.normalized_payload.subject).toBe("Subject");
    expect(prepared.payload_preview.subject).toBe("Subject");
    expect(prepared.payload_preview.body_preview).toBe("Hello from test");
    expect(prepared.payload_preview.recipients).toEqual(["user@example.com"]);
    expect(prepared.payload_preview.recipient_count).toBe(1);
  });

  it("gmail preview recipients include to/cc/bcc for policy checks", async () => {
    const gmail = connectors.google!;
    const prepared = await gmail.prepareWrite(
      "gmail.sendEmail",
      {
        to: ["user@example.com"],
        cc: ["cc@example.com"],
        bcc: ["bcc@example.com"],
        subject: "Subject",
        body: "Hello from test",
      },
      {
        workspaceId: "workspace_demo",
        orgId: "org_demo",
        scopes: ["gmail.send", "gmail.modify", "gmail.readonly"],
      },
    );

    expect(prepared.payload_preview.recipients).toEqual([
      "user@example.com",
      "cc@example.com",
      "bcc@example.com",
    ]);
    expect(prepared.payload_preview.recipient_count).toBe(3);
  });

  it("stripe redact masks sensitive fields while preserving structure", () => {
    const stripe = connectors.stripe!;
    const redacted = stripe.redact("stripe.issueRefund", {
      customerId: "cus_100",
      amount: 15,
      currency: "usd",
      nested: {
        amount: 15,
        note: "keep",
      },
    });

    expect(redacted.amount).toBe("[redacted]");
    expect((redacted.nested as Record<string, unknown>).amount).toBe("[redacted]");
    expect((redacted.nested as Record<string, unknown>).note).toBe("keep");
  });

  it("fails write tool calls when required scopes are missing", async () => {
    const stripe = connectors.stripe!;
    await expect(
      stripe.prepareWrite(
        "stripe.issueRefund",
        {
          customerId: "cus_100",
          chargeId: "ch_100",
          amount: 10,
          currency: "usd",
        },
        {
          workspaceId: "workspace_demo",
          orgId: "org_demo",
          scopes: ["stripe.read"],
        },
      ),
    ).rejects.toThrow(/Missing scopes/);
  });
});
