const DAYS_OF_WEEK = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const ORDINALS: Record<number, string> = {
  1: "1st",
  2: "2nd",
  3: "3rd",
  21: "21st",
  22: "22nd",
  23: "23rd",
  31: "31st",
};

const ordinal = (n: number): string => ORDINALS[n] ?? `${n}th`;

const formatHour = (hour: number): string => {
  if (hour === 0) return "12:00 AM";
  if (hour === 12) return "12:00 PM";
  if (hour < 12) return `${hour}:00 AM`;
  return `${hour - 12}:00 PM`;
};

const formatHourMinute = (hour: number, minute: number): string => {
  const period = hour >= 12 ? "PM" : "AM";
  const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  const displayMinute = minute.toString().padStart(2, "0");
  return `${displayHour}:${displayMinute} ${period}`;
};

export const humanizeCron = (expression: string): string => {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    return expression;
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];

  // Every N minutes: */N * * * *
  if (hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    if (minute === "*") return "Every minute";
    const stepMatch = /^\*\/(\d+)$/.exec(minute);
    if (stepMatch) {
      const interval = Number(stepMatch[1]);
      if (interval === 1) return "Every minute";
      return `Every ${interval} minutes`;
    }
  }

  // Every N hours: 0 */N * * *
  if (minute === "0" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    const stepMatch = /^\*\/(\d+)$/.exec(hour);
    if (stepMatch) {
      const interval = Number(stepMatch[1]);
      if (interval === 1) return "Every hour";
      return `Every ${interval} hours`;
    }
  }

  // Specific hour patterns
  const hourNum = /^\d+$/.test(hour) ? Number(hour) : null;
  const minuteNum = /^\d+$/.test(minute) ? Number(minute) : null;

  if (hourNum !== null && minuteNum !== null && month === "*") {
    const timeStr = formatHourMinute(hourNum, minuteNum);

    // Every day at H:MM: M H * * *
    if (dayOfMonth === "*" && dayOfWeek === "*") {
      return `Every day at ${timeStr}`;
    }

    // Weekdays: M H * * 1-5
    if (dayOfMonth === "*" && dayOfWeek === "1-5") {
      return `Weekdays at ${timeStr}`;
    }

    // Specific day of week: M H * * N
    if (dayOfMonth === "*" && /^\d$/.test(dayOfWeek)) {
      const dow = Number(dayOfWeek);
      if (dow >= 0 && dow <= 6) {
        return `Every ${DAYS_OF_WEEK[dow]} at ${timeStr}`;
      }
    }

    // Multiple days of week: M H * * N,N,N
    if (dayOfMonth === "*" && /^[\d,]+$/.test(dayOfWeek)) {
      const days = dayOfWeek
        .split(",")
        .map(Number)
        .filter((d) => d >= 0 && d <= 6)
        .map((d) => SHORT_DAYS[d]);
      if (days.length > 0) {
        return `${days.join(", ")} at ${timeStr}`;
      }
    }

    // Day of month: M H D * *
    if (/^\d+$/.test(dayOfMonth) && dayOfWeek === "*") {
      const dom = Number(dayOfMonth);
      if (dom >= 1 && dom <= 31) {
        return `${ordinal(dom)} of every month at ${minuteNum === 0 ? formatHour(hourNum) : timeStr}`;
      }
    }
  }

  return expression;
};
