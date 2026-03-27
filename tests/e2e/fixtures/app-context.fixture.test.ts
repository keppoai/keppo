import { describe, expect, it, vi } from "vitest";
import { maybeAttachServiceLogs } from "./app-context.fixture";

describe("maybeAttachServiceLogs", () => {
  it("attaches redacted service logs on unexpected outcome", async () => {
    const attach = vi.fn(async () => undefined);
    const readLogs = vi.fn(async () => "tail");

    await maybeAttachServiceLogs({
      status: "failed",
      expectedStatus: "passed",
      workerIndex: 0,
      readLogs,
      attach,
    });

    expect(readLogs).toHaveBeenCalledWith(0);
    expect(attach).toHaveBeenCalledWith("service-logs", {
      body: "tail",
      contentType: "text/plain",
    });
  });

  it("does not attach logs when outcome matches expectation", async () => {
    const attach = vi.fn(async () => undefined);
    const readLogs = vi.fn(async () => "tail");

    await maybeAttachServiceLogs({
      status: "passed",
      expectedStatus: "passed",
      workerIndex: 0,
      readLogs,
      attach,
    });

    expect(readLogs).not.toHaveBeenCalled();
    expect(attach).not.toHaveBeenCalled();
  });

  it("attaches fallback text when tail collection fails", async () => {
    const attach = vi.fn(async () => undefined);

    await maybeAttachServiceLogs({
      status: "failed",
      expectedStatus: "passed",
      workerIndex: 0,
      readLogs: async () => {
        throw new Error("broken");
      },
      attach,
    });

    const body = (attach.mock.calls[0]?.[1] as { body: string }).body;
    expect(body).toContain("Failed to collect service logs: broken");
  });
});
