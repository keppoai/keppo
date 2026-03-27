import { describe, expect, it } from "vitest";
import { humanizeCron } from "./cron-humanizer";

describe("humanizeCron", () => {
  it("every day at 9:00 AM", () => {
    expect(humanizeCron("0 9 * * *")).toBe("Every day at 9:00 AM");
  });

  it("weekdays at 9:00 AM", () => {
    expect(humanizeCron("0 9 * * 1-5")).toBe("Weekdays at 9:00 AM");
  });

  it("every 30 minutes", () => {
    expect(humanizeCron("*/30 * * * *")).toBe("Every 30 minutes");
  });

  it("every Friday at 5:00 PM", () => {
    expect(humanizeCron("0 17 * * 5")).toBe("Every Friday at 5:00 PM");
  });

  it("1st of every month at midnight", () => {
    expect(humanizeCron("0 0 1 * *")).toBe("1st of every month at 12:00 AM");
  });

  it("every minute", () => {
    expect(humanizeCron("* * * * *")).toBe("Every minute");
  });

  it("every hour", () => {
    expect(humanizeCron("0 */1 * * *")).toBe("Every hour");
  });

  it("every 2 hours", () => {
    expect(humanizeCron("0 */2 * * *")).toBe("Every 2 hours");
  });

  it("every day at noon", () => {
    expect(humanizeCron("0 12 * * *")).toBe("Every day at 12:00 PM");
  });

  it("every Sunday at 8:30 AM", () => {
    expect(humanizeCron("30 8 * * 0")).toBe("Every Sunday at 8:30 AM");
  });

  it("15th of every month at 3:00 PM", () => {
    expect(humanizeCron("0 15 15 * *")).toBe("15th of every month at 3:00 PM");
  });

  it("returns raw expression for unrecognized patterns", () => {
    expect(humanizeCron("0 9 * 1-6 *")).toBe("0 9 * 1-6 *");
  });

  it("returns raw expression for invalid input", () => {
    expect(humanizeCron("not a cron")).toBe("not a cron");
  });

  it("every 1 minute is 'Every minute'", () => {
    expect(humanizeCron("*/1 * * * *")).toBe("Every minute");
  });
});
