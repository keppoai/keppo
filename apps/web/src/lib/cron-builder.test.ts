import { describe, expect, it } from "vitest";
import {
  builderStateToCron,
  cronToBuilderState,
  getDefaultBuilderState,
  type CronBuilderState,
} from "./cron-builder";

describe("cron-builder", () => {
  it.each<[string, CronBuilderState]>([
    [
      "minutes",
      {
        ...getDefaultBuilderState(),
        frequency: "minutes",
        minuteInterval: 30,
      },
    ],
    [
      "hourly",
      {
        ...getDefaultBuilderState(),
        frequency: "hourly",
        minuteOfHour: 15,
      },
    ],
    [
      "daily",
      {
        ...getDefaultBuilderState(),
        frequency: "daily",
        hour: 9,
        minute: 0,
      },
    ],
    [
      "weekly",
      {
        ...getDefaultBuilderState(),
        frequency: "weekly",
        hour: 9,
        minute: 0,
        daysOfWeek: [1, 3, 5],
      },
    ],
    [
      "monthly",
      {
        ...getDefaultBuilderState(),
        frequency: "monthly",
        hour: 0,
        minute: 0,
        dayOfMonth: 1,
      },
    ],
  ])("round-trips %s builder state", (_label, state) => {
    expect(cronToBuilderState(builderStateToCron(state))).toEqual(state);
  });

  it("parses known cron expressions", () => {
    expect(cronToBuilderState("*/30 * * * *")).toEqual({
      ...getDefaultBuilderState(),
      frequency: "minutes",
      minuteInterval: 30,
    });
    expect(cronToBuilderState("0 9 * * 1-5")).toEqual({
      ...getDefaultBuilderState(),
      frequency: "weekly",
      hour: 9,
      minute: 0,
      daysOfWeek: [1, 2, 3, 4, 5],
    });
    expect(cronToBuilderState("0 0 1 * *")).toEqual({
      ...getDefaultBuilderState(),
      frequency: "monthly",
      hour: 0,
      minute: 0,
      dayOfMonth: 1,
    });
  });

  it("returns null for unsupported expressions", () => {
    expect(cronToBuilderState("0 9 * 1-6 *")).toBeNull();
    expect(cronToBuilderState("0 9 * * MON")).toBeNull();
    expect(cronToBuilderState("0 */2 * * *")).toBeNull();
    expect(cronToBuilderState("not a cron")).toBeNull();
  });

  it("handles edge cases", () => {
    expect(cronToBuilderState("* * * * *")).toEqual({
      ...getDefaultBuilderState(),
      frequency: "minutes",
      minuteInterval: 1,
    });
    expect(cronToBuilderState("30 8 * * 0")).toEqual({
      ...getDefaultBuilderState(),
      frequency: "weekly",
      hour: 8,
      minute: 30,
      daysOfWeek: [0],
    });

    const allDaysState: CronBuilderState = {
      ...getDefaultBuilderState(),
      frequency: "weekly",
      hour: 6,
      minute: 45,
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    };
    expect(builderStateToCron(allDaysState)).toBe("45 6 * * 0,1,2,3,4,5,6");
    expect(cronToBuilderState("45 6 * * 0,1,2,3,4,5,6")).toEqual(allDaysState);
  });
});
