import type { NextConfig } from "next";

const csp = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

const nextConfig: NextConfig = {
  async headers() {
    return [
      // Pages get a per-request nonce policy from src/proxy.ts; this strict one covers the API.
      { source: "/api/:path*", headers: [{ key: "Content-Security-Policy", value: csp }] },
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          ...(process.env.COOKIE_SECURE === "true" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
        ],
      },
    ];
  },
  // Every screen is per-user and per-factory, so pages render dynamically.
  serverExternalPackages: ["@libsql/client", "libsql"],
  poweredByHeader: false,
  experimental: {
    serverActions: { bodySizeLimit: "3mb" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
