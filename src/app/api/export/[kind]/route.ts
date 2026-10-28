import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { currentActor } from "@/server/auth/session-next";
import { AppError } from "@/server/errors";
import { buildExport } from "@/server/services/exports";

/** GET /api/export/:kind?from=YYYY-MM-DD&to=YYYY-MM-DD — CSV export for the signed-in user's active factory. */
export async function GET(req: Request, ctx: RouteContext<"/api/export/[kind]">) {
  const { kind } = await ctx.params;
  const actor = await currentActor();
  if (!actor) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (actor.mustChangePassword) return NextResponse.json({ error: "Set your own password first." }, { status: 403 });
  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? from;
  try {
    const { filename, csv } = await buildExport(getDb(), actor, kind, from, to);
    return new NextResponse(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename.replace(/[^\w.-]/g, "_")}"`,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: e.code === "FORBIDDEN" ? 403 : 400 });
    console.error("[energyos] export error", e);
    return NextResponse.json({ error: "Internal error." }, { status: 500 });
  }
}
