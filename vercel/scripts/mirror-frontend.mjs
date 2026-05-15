#!/usr/bin/env node
/**
 * Mirror ../Frontend into ./ (the vercel deployment shell) using:
 *   - real directories for every subdir
 *   - relative file-level symlinks for every file
 *
 * Next.js's app-router file-system scanner does not recurse into a
 * symlinked DIRECTORY whose target lies outside the project root
 * (it treats those entries as "outside the app dir" and skips them).
 * It does, however, happily follow symlinked FILES, so we mirror the
 * tree as real dirs + file symlinks.
 *
 * Run automatically via `predev` and `prebuild` in package.json so
 * `npm run dev` / `npm run build` always see a fresh mirror.
 *
 * Files we mirror at the tree level:
 *   - app/         (app-router routes — must be real dirs)
 *   - components/  (kept as real dirs for consistency / Tailwind scanning)
 *   - lib/         (same — also covers @/lib/... imports)
 *
 * Single-file mirrors handled separately:
 *   - middleware.ts
 *   - postcss.config.mjs
 *   - tailwind.config.ts
 */
import { mkdirSync, readdirSync, lstatSync, symlinkSync, rmSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VERCEL_ROOT = resolve(__dirname, "..");
const FRONTEND_ROOT = resolve(VERCEL_ROOT, "..", "Frontend");

const TREE_MIRRORS = ["app", "components", "lib"];
const FILE_MIRRORS = ["middleware.ts", "postcss.config.mjs", "tailwind.config.ts"];

// Centralized env lives at the REPO ROOT (one level above Frontend/), not
// inside Frontend/. Next.js auto-loads `.env*` from its project root, so we
// symlink the repo-root `.env` into vercel/ here. Setting env via
// `loadEnvConfig` inside next.config.mjs does NOT propagate to Next's dev
// request workers — only files in the project root do.
const REPO_ROOT_ENV_LINKS = [".env", ".env.local", ".env.development", ".env.production"];

function mirrorTree(srcDir, destDir) {
  if (existsSync(destDir)) {
    rmSync(destDir, { recursive: true, force: true });
  }
  mkdirSync(destDir, { recursive: true });
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = join(srcDir, entry.name);
    const destPath = join(destDir, entry.name);
    if (entry.isDirectory()) {
      mirrorTree(srcPath, destPath);
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      // Relative symlink so it resolves the same on local + Vercel build runners.
      const linkTarget = relative(dirname(destPath), srcPath);
      symlinkSync(linkTarget, destPath);
    }
  }
}

function mirrorFile(name) {
  const srcPath = join(FRONTEND_ROOT, name);
  const destPath = join(VERCEL_ROOT, name);
  if (!existsSync(srcPath)) return;
  if (existsSync(destPath) || lstatSync(destPath, { throwIfNoEntry: false })) {
    rmSync(destPath, { force: true });
  }
  const linkTarget = relative(dirname(destPath), srcPath);
  symlinkSync(linkTarget, destPath);
}

function mirrorRepoRootFile(name) {
  const srcPath = resolve(VERCEL_ROOT, "..", name);
  const destPath = join(VERCEL_ROOT, name);
  if (!existsSync(srcPath)) return;
  if (existsSync(destPath) || lstatSync(destPath, { throwIfNoEntry: false })) {
    rmSync(destPath, { force: true });
  }
  const linkTarget = relative(dirname(destPath), srcPath);
  symlinkSync(linkTarget, destPath);
}

if (!existsSync(FRONTEND_ROOT)) {
  console.error(`[mirror-frontend] Frontend not found at ${FRONTEND_ROOT}`);
  process.exit(1);
}

for (const name of TREE_MIRRORS) {
  const src = join(FRONTEND_ROOT, name);
  const dest = join(VERCEL_ROOT, name);
  if (!existsSync(src)) continue;
  mirrorTree(src, dest);
}
for (const name of FILE_MIRRORS) {
  mirrorFile(name);
}
for (const name of REPO_ROOT_ENV_LINKS) {
  mirrorRepoRootFile(name);
}

console.log("[mirror-frontend] Mirror refreshed: app/, components/, lib/, middleware.ts, postcss.config.mjs, tailwind.config.ts, .env*");
