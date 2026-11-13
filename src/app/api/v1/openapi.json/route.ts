import { NextResponse } from "next/server";

/** GET /api/v1/openapi.json — machine-readable description of the integration API. */
export function GET(req: Request) {
  const origin = new URL(req.url).origin;
  const dateRange = [
    { name: "from", in: "query", required: true, schema: { type: "string", format: "date" }, description: "First day, YYYY-MM-DD (factory-local)" },
    { name: "to", in: "query", required: true, schema: { type: "string", format: "date" }, description: "Last day, YYYY-MM-DD; at most 31 days after from" },
  ];
  const errors = {
    "400": { description: "Invalid parameters" },
    "401": { description: "Missing, unknown or revoked API key" },
    "429": { description: "Rate limit (600 calls per minute per key); see x-ratelimit-* and retry-after headers" },
  };
  const spec = {
    openapi: "3.1.0",
    info: {
      title: "FactoryTwin EnergyOS integration API",
      version: "1.0.0",
      description:
        "Read-only access for ERP, MES and BI tools. Create a key under Factory settings → Integration API and send it as `Authorization: Bearer eosk_…`. A key sees one factory. Meter data comes in through POST /api/ingest with a meter token.",
    },
    servers: [{ url: origin }],
    components: { securitySchemes: { apiKey: { type: "http", scheme: "bearer", description: "eosk_… key from Factory settings" } } },
    paths: {
      "/api/v1/summary": { get: { summary: "Energy, tonnes, SEC, cost, holding and data quality for a period", security: [{ apiKey: [] }], parameters: dateRange, responses: { "200": { description: "Summary" }, ...errors } } },
      "/api/v1/heats": { get: { summary: "Heat records with metered and expected energy", security: [{ apiKey: [] }], parameters: dateRange, responses: { "200": { description: "Heats" }, ...errors } } },
      "/api/v1/recommendations": { get: { summary: "Schedule recommendations, predicted effect and decisions", security: [{ apiKey: [] }], responses: { "200": { description: "Recommendations" }, ...errors } } },
      "/api/v1/market": { get: { summary: "Today's IEX Day-Ahead Market prices for India (public, no key)", responses: { "200": { description: "96 fifteen-minute prices and a summary" }, "404": { description: "Not fetched yet" } } } },
      "/api/ingest": { post: { summary: "Push meter readings (meter token from Factory settings)", responses: { "200": { description: "Accepted / rejected rows" } } } },
      "/api/health": { get: { summary: "Liveness and database check", responses: { "200": { description: "ok" }, "503": { description: "database unavailable" } } } },
    },
  };
  return NextResponse.json(spec, { headers: { "cache-control": "public, max-age=3600" } });
}
