#!/usr/bin/env node
/**
 * Symlink the centralized repo-root .env into Frontend/ so Next.js's dev
 * request workers can see it. Calling loadEnvConfig() from next.config.mjs
 * sets process.env on the config-loader process only — the request workers
 * Next forks for SSR / route handlers re-discover env from .env files
 * located in the project root (Frontend/) and do NOT inherit those vars.
 *
 * Runs as `predev` and `prebuild` so `npm run dev` / `npm run build` always
 * start with a fresh link, matching vercel/scripts/mirror-frontend.mjs.
 */
import { existsSync, lstatSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(FRONTEND_ROOT, "..");

const ENV_FILES = [".env", ".env.local", ".env.development", ".env.production"];

for (const name of ENV_FILES) {
  const src = join(REPO_ROOT, name);
  const dest = join(FRONTEND_ROOT, name);
  if (!existsSync(src)) continue;
  if (existsSync(dest) || lstatSync(dest, { throwIfNoEntry: false })) {
    rmSync(dest, { force: true });
  }
  symlinkSync(relative(dirname(dest), src), dest);
}

console.log("[link-env] Linked repo-root .env* into Frontend/");
