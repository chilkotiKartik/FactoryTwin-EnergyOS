export type ErrorCode = "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION" | "CONFLICT" | "STALE" | "PAUSED";

/** Errors whose message is safe to show to the user. Anything else is logged and replaced. */
export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const forbidden = (msg = "Your role does not allow this action.") => new AppError("FORBIDDEN", msg);
export const notFound = (what = "Record") => new AppError("NOT_FOUND", `${what} not found.`);
export const conflict = (msg: string) => new AppError("CONFLICT", msg);
export const validation = (msg: string, fieldErrors?: Record<string, string>) => new AppError("VALIDATION", msg, fieldErrors);

export interface ActionResult<T = undefined> {
  ok: boolean;
  message?: string;
  code?: ErrorCode | "INTERNAL";
  fieldErrors?: Record<string, string>;
  data?: T;
}

/** Convert any thrown value into a safe action result. */
export function toActionError(e: unknown): ActionResult<never> {
  if (e instanceof AppError) return { ok: false, code: e.code, message: e.message, fieldErrors: e.fieldErrors };
  // Never leak internal errors to the client.
  console.error("[energyos] internal error", e);
  return { ok: false, code: "INTERNAL", message: "Something went wrong on the server. Nothing was changed." };
}
