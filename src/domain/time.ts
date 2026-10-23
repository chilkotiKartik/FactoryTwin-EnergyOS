/**
 * Time helpers. Storage is always UTC epoch milliseconds; the interface works in
 * the factory's IANA time zone. Local "minute of day" values (0..1439) are used
 * for tariff windows, shift windows and the optimiser grid.
 */

export const MINUTE_MS = 60_000;
export const DAY_MINUTES = 1440;

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = partsFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsFormatters.set(timeZone, f);
  }
  return f;
}

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function localParts(ts: number, timeZone: string): LocalParts {
  const parts = formatterFor(timeZone).formatToParts(new Date(ts));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

/** Local minute of day (0..1439) for a UTC timestamp. */
export function localMinuteOfDay(ts: number, timeZone: string): number {
  const p = localParts(ts, timeZone);
  return p.hour * 60 + p.minute;
}

/** Local calendar date (YYYY-MM-DD) for a UTC timestamp. */
export function localDate(ts: number, timeZone: string): string {
  const p = localParts(ts, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Offset (ms) of the zone from UTC at a given instant: local = utc + offset. */
export function zoneOffsetMs(ts: number, timeZone: string): number {
  const p = localParts(ts, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ts / 1000) * 1000;
}

/**
 * UTC timestamp of a local wall-clock time. Iterates twice so that it is correct
 * across DST transitions for zones that have them (India does not).
 */
export function localToUtc(date: string, minuteOfDay: number, timeZone: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const naive = Date.UTC(y, m - 1, d, 0, 0, 0) + minuteOfDay * MINUTE_MS;
  let guess = naive - zoneOffsetMs(naive, timeZone);
  guess = naive - zoneOffsetMs(guess, timeZone);
  return guess;
}

/** Midnight (local) of a date, as UTC ms. */
export function localDayStart(date: string, timeZone: string): number {
  return localToUtc(date, 0, timeZone);
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export function isIsoDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const t = Date.parse(`${v}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v;
}

export function minuteToHHMM(min: number): string {
  const m = ((Math.round(min) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  const extraDays = Math.floor(Math.round(min) / DAY_MINUTES);
  const s = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return extraDays > 0 ? `${s} (+${extraDays}d)` : s;
}

/** Parse "HH:MM" into minute of day; returns null when invalid. */
export function hhmmToMinute(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 24 || mi > 59 || (h === 24 && mi !== 0)) return null;
  return h * 60 + mi;
}

export function formatLocalTime(ts: number, timeZone: string): string {
  const p = localParts(ts, timeZone);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

export function formatLocalDateTime(ts: number, timeZone: string): string {
  return `${localDate(ts, timeZone)} ${formatLocalTime(ts, timeZone)}`;
}
