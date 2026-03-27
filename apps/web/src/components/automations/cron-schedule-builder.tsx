import { useEffect, useId, useMemo, useState } from "react";
import {
  builderStateToCron,
  COMMON_TIME_MINUTE_OPTIONS,
  cronToBuilderState,
  getDefaultBuilderState,
  MINUTE_INTERVAL_OPTIONS,
  WEEKDAY_DAY_VALUES,
  type CronBuilderState,
  type CronFrequency,
} from "@/lib/cron-builder";
import { humanizeCron } from "@/lib/cron-humanizer";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { HelpText } from "@/components/ui/help-text";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";

interface CronScheduleBuilderProps {
  value: string;
  onChange: (cron: string) => void;
  id?: string;
}

const FREQUENCY_OPTIONS: Array<{ value: CronFrequency; label: string }> = [
  { value: "minutes", label: "Every N minutes" },
  { value: "hourly", label: "Hourly" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

const WEEKLY_DAY_OPTIONS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
] as const;

const toSentenceCase = (value: string): string => {
  if (!value) {
    return value;
  }
  return `${value.slice(0, 1).toLowerCase()}${value.slice(1)}`;
};

const toOptionList = (values: readonly number[], currentValue: number): number[] => {
  return [...new Set([...values, currentValue])].sort((a, b) => a - b);
};

const TIME_MINUTE_OPTIONS = Array.from({ length: 60 }, (_, index) => index);
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, index) => index);
const DAY_OF_MONTH_OPTIONS = Array.from({ length: 31 }, (_, index) => index + 1);

const formatHourOption = (hour: number): string => {
  const period = hour >= 12 ? "PM" : "AM";
  const normalizedHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${normalizedHour}:00 ${period}`;
};

const formatMinuteOption = (minute: number): string => {
  return minute.toString().padStart(2, "0");
};

const isWeekdaysSelection = (daysOfWeek: number[]): boolean => {
  return (
    daysOfWeek.length === WEEKDAY_DAY_VALUES.length &&
    WEEKDAY_DAY_VALUES.every((day) => daysOfWeek.includes(day))
  );
};

export function CronScheduleBuilder({ value, onChange, id }: CronScheduleBuilderProps) {
  const generatedId = useId().replaceAll(":", "");
  const idPrefix = id ?? `cron-builder-${generatedId}`;
  const [state, setState] = useState<CronBuilderState>(() => {
    return cronToBuilderState(value) ?? getDefaultBuilderState();
  });

  useEffect(() => {
    const parsedState = cronToBuilderState(value);
    if (parsedState) {
      setState(parsedState);
      return;
    }

    const fallbackState = getDefaultBuilderState();
    const fallbackCron = builderStateToCron(fallbackState);
    setState(fallbackState);
    if (value !== fallbackCron) {
      onChange(fallbackCron);
    }
  }, [onChange, value]);

  const cronValue = useMemo(() => builderStateToCron(state), [state]);
  const commonMinuteOptions = useMemo(() => {
    return toOptionList(COMMON_TIME_MINUTE_OPTIONS, state.minute);
  }, [state.minute]);
  const minuteIntervalOptions = useMemo(() => {
    return toOptionList(MINUTE_INTERVAL_OPTIONS, state.minuteInterval);
  }, [state.minuteInterval]);

  const updateState = (updater: (current: CronBuilderState) => CronBuilderState) => {
    setState((current) => {
      const nextState = updater(current);
      const nextCron = builderStateToCron(nextState);
      if (nextCron !== value) {
        onChange(nextCron);
      }
      return nextState;
    });
  };

  return (
    <div className="space-y-4 rounded-2xl border bg-muted/10 p-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-frequency`}>Schedule</Label>
          <NativeSelect
            id={`${idPrefix}-frequency`}
            className="w-full"
            value={state.frequency}
            onChange={(event) => {
              const frequency = event.currentTarget.value as CronFrequency;
              updateState((current) => ({ ...current, frequency }));
            }}
          >
            {FREQUENCY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
        </div>

        {state.frequency === "minutes" ? (
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-minute-interval`}>Interval</Label>
            <NativeSelect
              id={`${idPrefix}-minute-interval`}
              className="w-full"
              value={state.minuteInterval}
              onChange={(event) => {
                const minuteInterval = Number(event.currentTarget.value);
                updateState((current) => ({ ...current, minuteInterval }));
              }}
            >
              {minuteIntervalOptions.map((option) => (
                <option key={option} value={option}>
                  {option} minute{option === 1 ? "" : "s"}
                </option>
              ))}
            </NativeSelect>
          </div>
        ) : null}

        {state.frequency === "hourly" ? (
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-minute-of-hour`}>Minute past the hour</Label>
            <NativeSelect
              id={`${idPrefix}-minute-of-hour`}
              className="w-full"
              value={state.minuteOfHour}
              onChange={(event) => {
                const minuteOfHour = Number(event.currentTarget.value);
                updateState((current) => ({ ...current, minuteOfHour }));
              }}
            >
              {TIME_MINUTE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  :{formatMinuteOption(option)}
                </option>
              ))}
            </NativeSelect>
          </div>
        ) : null}

        {state.frequency === "daily" ||
        state.frequency === "weekly" ||
        state.frequency === "monthly" ? (
          <div className="space-y-2 md:col-span-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor={`${idPrefix}-hour`}>Hour</Label>
                <NativeSelect
                  id={`${idPrefix}-hour`}
                  className="w-full"
                  value={state.hour}
                  onChange={(event) => {
                    const hour = Number(event.currentTarget.value);
                    updateState((current) => ({ ...current, hour }));
                  }}
                >
                  {HOUR_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {formatHourOption(option)}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${idPrefix}-minute`}>Minute</Label>
                <NativeSelect
                  id={`${idPrefix}-minute`}
                  className="w-full"
                  value={state.minute}
                  onChange={(event) => {
                    const minute = Number(event.currentTarget.value);
                    updateState((current) => ({ ...current, minute }));
                  }}
                >
                  {commonMinuteOptions.map((option) => (
                    <option key={option} value={option}>
                      {formatMinuteOption(option)}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>
          </div>
        ) : null}

        {state.frequency === "weekly" ? (
          <div className="space-y-3 md:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Label>Days of the week</Label>
              <Button
                type="button"
                variant={isWeekdaysSelection(state.daysOfWeek) ? "secondary" : "outline"}
                size="sm"
                onClick={() => {
                  updateState((current) => ({
                    ...current,
                    daysOfWeek: [...WEEKDAY_DAY_VALUES],
                  }));
                }}
              >
                Weekdays
              </Button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {WEEKLY_DAY_OPTIONS.map((day) => {
                const checkboxId = `${idPrefix}-day-${day.value}`;
                const isChecked = state.daysOfWeek.includes(day.value);
                return (
                  <label
                    key={day.value}
                    htmlFor={checkboxId}
                    className={cn(
                      "flex min-h-11 items-center gap-3 rounded-xl border bg-background px-3 py-2 text-sm shadow-xs transition-colors",
                      isChecked ? "border-primary/35 bg-primary/5" : "hover:bg-muted/40",
                    )}
                  >
                    <Checkbox
                      id={checkboxId}
                      checked={isChecked}
                      onCheckedChange={(checked) => {
                        updateState((current) => {
                          const nextDays =
                            checked === true
                              ? [...current.daysOfWeek, day.value]
                              : current.daysOfWeek.filter((value) => value !== day.value);
                          return {
                            ...current,
                            daysOfWeek: nextDays.length > 0 ? nextDays : current.daysOfWeek,
                          };
                        });
                      }}
                    />
                    <span>{day.label}</span>
                  </label>
                );
              })}
            </div>
          </div>
        ) : null}

        {state.frequency === "monthly" ? (
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-day-of-month`}>Day of the month</Label>
            <NativeSelect
              id={`${idPrefix}-day-of-month`}
              className="w-full"
              value={state.dayOfMonth}
              onChange={(event) => {
                const dayOfMonth = Number(event.currentTarget.value);
                updateState((current) => ({ ...current, dayOfMonth }));
              }}
            >
              {DAY_OF_MONTH_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </NativeSelect>
          </div>
        ) : null}
      </div>

      <HelpText>Runs {toSentenceCase(humanizeCron(cronValue))}.</HelpText>
    </div>
  );
}
