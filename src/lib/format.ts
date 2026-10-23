const nf = (d: number) => new Intl.NumberFormat("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
const cache = new Map<number, Intl.NumberFormat>();
function f(d: number) {
  let x = cache.get(d);
  if (!x) {
    x = nf(d);
    cache.set(d, x);
  }
  return x;
}

export const fmt = (v: number | null | undefined, digits = 0): string => (v === null || v === undefined || !Number.isFinite(v) ? "—" : f(digits).format(v));

/** Paise → "₹1,234". */
export const inr = (paise: number | null | undefined, digits = 0): string =>
  paise === null || paise === undefined || !Number.isFinite(paise) ? "—" : `${paise < 0 ? "−" : ""}₹${f(digits).format(Math.abs(paise) / 100)}`;

export const inrRupees = (rupees: number | null | undefined, digits = 0): string =>
  rupees === null || rupees === undefined || !Number.isFinite(rupees) ? "—" : `${rupees < 0 ? "−" : ""}₹${f(digits).format(Math.abs(rupees))}`;

export const pct = (v: number | null | undefined, digits = 1, signed = true): string =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : `${signed && v > 0 ? "+" : v < 0 ? "−" : ""}${f(digits).format(Math.abs(v))}%`;

export const signed = (v: number | null | undefined, digits = 0): string =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${f(digits).format(Math.abs(v))}`;

export const hhmm = (min: number | null | undefined): string => {
  if (min === null || min === undefined || !Number.isFinite(min)) return "—";
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

const tzFmt = new Map<string, Intl.DateTimeFormat>();
export function localTime(ts: number | null | undefined, tz: string, withDate = false): string {
  if (ts === null || ts === undefined) return "—";
  const key = `${tz}|${withDate}`;
  let x = tzFmt.get(key);
  if (!x) {
    x = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hourCycle: "h23",
      ...(withDate ? { day: "2-digit", month: "short", year: "numeric" } : {}),
      hour: "2-digit",
      minute: "2-digit",
    });
    tzFmt.set(key, x);
  }
  return x.format(new Date(ts));
}

export function dayLabel(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "short", year: "numeric" }).format(d);
}

import { formatLocalTime, localDate } from "@/domain/time";

/** UTC ms → value for <input type="datetime-local"> in the factory zone. */
export function toLocalInput(ts: number | null | undefined, tz: string): string {
  if (ts === null || ts === undefined) return "";
  return `${localDate(ts, tz)}T${formatLocalTime(ts, tz)}`;
}
