export type CronFrequency = "minutes" | "hourly" | "daily" | "weekly" | "monthly";

export type CronBuilderState = {
  frequency: CronFrequency;
  minuteInterval: number;
  minuteOfHour: number;
  hour: number;
  minute: number;
  daysOfWeek: number[];
  dayOfMonth: number;
};

export const MINUTE_INTERVAL_OPTIONS = [1, 5, 10, 15, 20, 30] as const;
export const COMMON_TIME_MINUTE_OPTIONS = [0, 15, 30, 45] as const;
export const WEEKDAY_DAY_VALUES = [1, 2, 3, 4, 5] as const;
export const ALL_DAY_VALUES = [0, 1, 2, 3, 4, 5, 6] as const;

const DEFAULT_BUILDER_STATE: CronBuilderState = {
  frequency: "daily",
  minuteInterval: 30,
  minuteOfHour: 0,
  hour: 9,
  minute: 0,
  daysOfWeek: [...WEEKDAY_DAY_VALUES],
  dayOfMonth: 1,
};

const asInteger = (value: string): number | null => {
  if (!/^\d+$/.test(value)) {
    return null;
  }
  return Number(value);
};

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(Math.max(value, min), max);
};

const sortDays = (days: number[]): number[] => {
  return [...days].sort((a, b) => a - b);
};

const normalizeDaysOfWeek = (days: number[]): number[] => {
  const normalized = sortDays([
    ...new Set(days.map((day) => (day === 7 ? 0 : day)).filter((day) => day >= 0 && day <= 6)),
  ]);
  return normalized.length > 0 ? normalized : [...WEEKDAY_DAY_VALUES];
};

const isWeekdaySelection = (days: number[]): boolean => {
  const normalized = normalizeDaysOfWeek(days);
  return (
    normalized.length === WEEKDAY_DAY_VALUES.length &&
    normalized.every((day, index) => day === WEEKDAY_DAY_VALUES[index])
  );
};

const normalizeCronBuilderState = (state: CronBuilderState): CronBuilderState => {
  return {
    frequency: state.frequency,
    minuteInterval: clamp(Math.trunc(state.minuteInterval || 1), 1, 59),
    minuteOfHour: clamp(Math.trunc(state.minuteOfHour || 0), 0, 59),
    hour: clamp(Math.trunc(state.hour || 0), 0, 23),
    minute: clamp(Math.trunc(state.minute || 0), 0, 59),
    daysOfWeek: normalizeDaysOfWeek(state.daysOfWeek),
    dayOfMonth: clamp(Math.trunc(state.dayOfMonth || 1), 1, 31),
  };
};

export const getDefaultBuilderState = (): CronBuilderState => {
  return {
    ...DEFAULT_BUILDER_STATE,
    daysOfWeek: [...DEFAULT_BUILDER_STATE.daysOfWeek],
  };
};

export const builderStateToCron = (input: CronBuilderState): string => {
  const state = normalizeCronBuilderState(input);

  switch (state.frequency) {
    case "minutes":
      return state.minuteInterval === 1 ? "* * * * *" : `*/${state.minuteInterval} * * * *`;
    case "hourly":
      return `${state.minuteOfHour} * * * *`;
    case "daily":
      return `${state.minute} ${state.hour} * * *`;
    case "weekly": {
      const dayExpression = isWeekdaySelection(state.daysOfWeek)
        ? "1-5"
        : normalizeDaysOfWeek(state.daysOfWeek).join(",");
      return `${state.minute} ${state.hour} * * ${dayExpression}`;
    }
    case "monthly":
      return `${state.minute} ${state.hour} ${state.dayOfMonth} * *`;
  }
};

const parseDayOfWeekField = (value: string): number[] | null => {
  if (value === "1-5") {
    return [...WEEKDAY_DAY_VALUES];
  }
  if (value === "0-6") {
    return [...ALL_DAY_VALUES];
  }
  if (!/^[\d,]+$/.test(value)) {
    return null;
  }

  const parsed = value
    .split(",")
    .map((entry) => asInteger(entry))
    .filter((entry): entry is number => entry !== null)
    .map((entry) => (entry === 7 ? 0 : entry));
  if (parsed.length === 0 || parsed.some((entry) => entry < 0 || entry > 6)) {
    return null;
  }
  return normalizeDaysOfWeek(parsed);
};

export const cronToBuilderState = (cron: string): CronBuilderState | null => {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    return null;
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];

  if (hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    if (minute === "*") {
      return {
        ...getDefaultBuilderState(),
        frequency: "minutes",
        minuteInterval: 1,
      };
    }
    const minuteIntervalMatch = /^\*\/(\d+)$/.exec(minute);
    if (minuteIntervalMatch) {
      const interval = Number(minuteIntervalMatch[1]);
      if (interval >= 1 && interval <= 59) {
        return {
          ...getDefaultBuilderState(),
          frequency: "minutes",
          minuteInterval: interval,
        };
      }
    }
    const minuteOfHour = asInteger(minute);
    if (minuteOfHour !== null && minuteOfHour >= 0 && minuteOfHour <= 59) {
      return {
        ...getDefaultBuilderState(),
        frequency: "hourly",
        minuteOfHour,
      };
    }
  }

  if (month !== "*") {
    return null;
  }

  const minuteValue = asInteger(minute);
  const hourValue = asInteger(hour);
  if (
    minuteValue === null ||
    hourValue === null ||
    minuteValue < 0 ||
    minuteValue > 59 ||
    hourValue < 0 ||
    hourValue > 23
  ) {
    return null;
  }

  if (dayOfMonth === "*" && dayOfWeek === "*") {
    return {
      ...getDefaultBuilderState(),
      frequency: "daily",
      hour: hourValue,
      minute: minuteValue,
    };
  }

  if (dayOfMonth === "*") {
    const days = parseDayOfWeekField(dayOfWeek);
    if (!days) {
      return null;
    }
    return {
      ...getDefaultBuilderState(),
      frequency: "weekly",
      hour: hourValue,
      minute: minuteValue,
      daysOfWeek: days,
    };
  }

  if (dayOfWeek !== "*") {
    return null;
  }

  const dayOfMonthValue = asInteger(dayOfMonth);
  if (dayOfMonthValue === null || dayOfMonthValue < 1 || dayOfMonthValue > 31) {
    return null;
  }

  return {
    ...getDefaultBuilderState(),
    frequency: "monthly",
    hour: hourValue,
    minute: minuteValue,
    dayOfMonth: dayOfMonthValue,
  };
};
