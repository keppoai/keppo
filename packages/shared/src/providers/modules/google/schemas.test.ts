import { describe, expect, it } from "vitest";
import { automationTriggers } from "./schemas.js";

describe("google incoming email trigger matching", () => {
  const trigger = automationTriggers.triggers.incoming_email;
  if (!trigger) {
    throw new Error("Missing Google incoming email trigger definition.");
  }

  it("matches a from filter against display-name email headers", () => {
    expect(
      trigger.matchesEvent({
        filter: {
          from: "alerts@example.com",
        },
        event: {
          delivery_id: "delivery_1",
          event_type: "google.gmail.incoming_email",
          history_id: "123",
          message: {
            id: "msg_1",
            thread_id: "thr_1",
            from: '"Alerts" <alerts@example.com>',
            to: ["ops@example.com"],
            subject: "Deployment",
            label_ids: ["INBOX"],
          },
        },
      }),
    ).toBe(true);
  });
});
