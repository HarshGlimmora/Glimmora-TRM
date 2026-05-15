/** @type {import('next').NextConfig} */
const isDev = process.env.NODE_ENV !== "production";

// `'unsafe-eval'` is required by Next.js's dev-mode webpack HMR runtime.
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
  experimental: {
    serverComponentsExternalPackages: ["@electric-sql/pglite", "pg"],
  },
  // The app/, lib/, components/ tree is a mirror of ../Frontend built out of
  // real dirs + per-file symlinks (see scripts/mirror-frontend.mjs). Webpack's
  // default `resolve.symlinks=true` would realpath those source files to
  // ../Frontend/..., which then resolves bare imports like
  // `@electric-sql/pglite` against ../Frontend/node_modules — OUTSIDE this
  // project root. Next's `serverComponentsExternalPackages` only externalizes
  // packages found under the project's own node_modules, so PGlite (and `pg`)
  // would get webpack-bundled, which breaks PGlite's WASM extension loader.
  //
  // Disabling symlink resolution keeps the imports anchored inside vercel/,
  // so the local node_modules wins and the external-packages rule applies.
  webpack: (config) => {
    config.resolve = config.resolve ?? {};
    config.resolve.symlinks = false;
    return config;
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
