import "server-only";
import { cookies } from "next/headers";
import { DAY_COOKIE } from "@/lib/constants";
import { isIsoDate } from "@/domain/time";
import { getDb } from "@/db/client";
import type { Actor } from "./context";
import { availableDays } from "./services/analytics";

/** The day the user is looking at: ?day=, then the day cookie, then the latest day with heats. */
export async function selectedDay(actor: Actor, override?: string | string[] | null): Promise<{ day: string | null; days: string[] }> {
  const days = await availableDays(getDb(), actor);
  const o = typeof override === "string" ? override : null;
  if (o && isIsoDate(o)) return { day: o, days };
  const c = (await cookies()).get(DAY_COOKIE)?.value;
  if (c && isIsoDate(c) && days.includes(c)) return { day: c, days };
  return { day: days[0] ?? null, days };
}
