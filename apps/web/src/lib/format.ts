import { formatDistanceToNow, format } from "date-fns";

export const pretty = (value: unknown): string => JSON.stringify(value, null, 2);

export const relativeTime = (date: string): string =>
  formatDistanceToNow(new Date(date), { addSuffix: true });

export const fullTimestamp = (date: string): string =>
  format(new Date(date), "MMM d, yyyy HH:mm:ss");
