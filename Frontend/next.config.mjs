// The centralized .env lives at the repo root. `scripts/link-env.mjs`
// (wired as `predev`/`prebuild` in package.json) symlinks it into Frontend/
// so Next.js's dev request workers pick it up via the standard project-root
// .env discovery. Calling loadEnvConfig() here would only set process.env
// on the config-loader process — Next's forked workers re-discover env from
// .env files in the project root and would not inherit those vars.

/** @type {import('next').NextConfig} */
const isDev = process.env.NODE_ENV !== "production";

// `'unsafe-eval'` is required by Next.js's dev-mode webpack HMR runtime.
// Without it, React never hydrates and every onClick / onSubmit silently
// falls back to native browser behaviour. Production bundles do not need it.
const scriptSrc = isDev
  ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
  : "script-src 'self' 'unsafe-inline'";

const connectSrc = isDev ? "connect-src 'self' ws: wss:" : "connect-src 'self'";

const csp = [
  "default-src 'self'",
  scriptSrc,
  "style-src 'self' 'unsafe-inline' fonts.googleapis.com",
  "font-src 'self' fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  connectSrc,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // PGlite ships a WASM bundle + extension tarballs that webpack must not
  // rewrite — leave it as an external CommonJS require resolved at runtime.
  experimental: {
    serverComponentsExternalPackages: ["@electric-sql/pglite", "pg"],
    // Force the migration SQL files into every serverless function bundle.
    // Without this, Vercel's Output File Tracing can't see fs.readFile()
    // hitting "../Backend/app/db/migrations/sql/postgres/*.sql" because
    // the paths are computed at runtime by lib/server/db/migrate.ts.
    outputFileTracingIncludes: {
      "/**/*": ["../Backend/app/db/migrations/sql/postgres/*.sql"],
    },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-DNS-Prefetch-Control", value: "on" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          { key: "Content-Security-Policy", value: csp },
        ],
      },
    ];
  },
};

export default nextConfig;
