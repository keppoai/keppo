import { describe, expect, it } from "vitest";
import { parseDeepHealth, parseDlqList } from "./admin-health";

describe("admin health parsers", () => {
  it("normalizes subsystem rows from deep health payloads", () => {
    expect(
      parseDeepHealth({
        ok: true,
        status: "degraded",
        checkedAt: "2026-03-14T08:00:00.000Z",
        responseTimeMs: 42,
        subsystems: [
          {
            name: "queue",
            status: "down",
            critical: 1,
            responseTimeMs: "15",
            jobs: [{ name: "maintenance" }],
          },
        ],
      }),
    ).toEqual({
      ok: true,
      status: "degraded",
      checkedAt: "2026-03-14T08:00:00.000Z",
      responseTimeMs: 42,
      subsystems: [
        {
          name: "queue",
          status: "down",
          critical: true,
          responseTimeMs: 15,
          jobs: [{ name: "maintenance" }],
        },
      ],
    });
  });

  it("rejects malformed DLQ payloads", () => {
    expect(() => parseDlqList({ pending: "nope" })).toThrow("Invalid /health/dlq response");
  });
});
