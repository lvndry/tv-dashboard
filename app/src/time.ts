import { config } from '../config';

const partsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: config.timeZone,
  hourCycle: 'h23',
  hour: '2-digit',
  minute: '2-digit',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

export interface ZonedTime {
  hour: number;
  minute: number;
  weekday: string;
  day: number;
  month: string;
  year: number;
}

/** Wall-clock time in the configured city, independent of the TV's own timezone setting. */
export function zoned(epochMs: number = Date.now()): ZonedTime {
  const parts: Record<string, string> = {};
  for (const part of partsFormatter.formatToParts(new Date(epochMs))) parts[part.type] = part.value;
  return {
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: parts.weekday ?? '',
    day: Number(parts.day),
    month: parts.month ?? '',
    year: Number(parts.year),
  };
}

const pad = (value: number): string => String(value).padStart(2, '0');

export function clockParts(epochMs: number, use24Hour: boolean): { hours: string; minutes: string; suffix: string } {
  const time = zoned(epochMs);
  if (use24Hour) return { hours: pad(time.hour), minutes: pad(time.minute), suffix: '' };
  const hour12 = time.hour % 12 === 0 ? 12 : time.hour % 12;
  return { hours: String(hour12), minutes: pad(time.minute), suffix: time.hour < 12 ? 'am' : 'pm' };
}

export function timeLabel(epochMs: number): string {
  const time = zoned(epochMs);
  return `${pad(time.hour)}:${pad(time.minute)}`;
}

export function hourLabel(epochMs: number): string {
  return `${pad(zoned(epochMs).hour)}h`;
}

export function dateLabel(epochMs: number): string {
  const time = zoned(epochMs);
  return `${time.weekday} ${time.day} ${time.month}`;
}

export function weekdayShort(epochMs: number): string {
  return zoned(epochMs).weekday.slice(0, 3);
}

function dayKey(epochMs: number): string {
  const time = zoned(epochMs);
  return `${time.year}-${time.month}-${time.day}`;
}

export function isSameDay(first: number, second: number): boolean {
  return dayKey(first) === dayKey(second);
}

export function relativeAge(epochMs: number, now: number = Date.now()): string {
  const minutes = Math.round((now - epochMs) / 60000);
  if (minutes < 2) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24 && isSameDay(epochMs, now)) return `${hours} h ago`;
  if (isSameDay(epochMs, now - 86400000)) return `yesterday, ${timeLabel(epochMs)}`;
  if (now - epochMs < 6 * 86400000) return `${zoned(epochMs).weekday}, ${timeLabel(epochMs)}`;
  const time = zoned(epochMs);
  return `${time.day} ${time.month}`;
}
