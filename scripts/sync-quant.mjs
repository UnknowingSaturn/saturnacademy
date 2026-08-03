#!/usr/bin/env node
/**
 * shared/quant → supabase/functions/_shared/quant/vendor sync + drift check.
 *
 * Why this exists: Supabase edge functions are bundled from `supabase/functions/`
 * only. Anything imported from the repo root (`shared/`) resolves at type-check
 * time but FAILS TO BUNDLE at deploy time with
 * `Module not found ".../shared/quant/*.ts"`, which silently blocks deploys of
 * every function in that import graph (that is how the multi-TP grouping code
 * sat undeployed for weeks).
 *
 * So the canonical source stays at shared/quant/*.ts (consumed directly by the
 * Vite client) and this script vendors byte-identical copies into
 * supabase/functions/_shared/quant/vendor/ so the Deno bundler can see them.
 *
 * Usage:
 *   node scripts/sync-quant.mjs           # sync
 *   node scripts/sync-quant.mjs --check   # verify only, exit 1 on drift
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SRC_DIR = join(ROOT, "shared", "quant");
const OUT_DIR = join(ROOT, "supabase", "functions", "_shared", "quant", "vendor");

const HEADER = `// GENERATED FILE — DO NOT EDIT.
// Vendored copy of shared/quant/<name> for the Deno edge bundler.
// Edit the canonical file at shared/quant/ and run \`npm run quant:sync\`.
`;

const checkOnly = process.argv.includes("--check");

const files = readdirSync(SRC_DIR).filter((f) => f.endsWith(".ts"));
if (files.length === 0) {
  console.error("sync-quant: no source files found in shared/quant");
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });

let drift = 0;
for (const name of files) {
  const raw = readFileSync(join(SRC_DIR, name), "utf8");
  // Deno needs explicit file extensions on relative specifiers; the Vite-side
  // canonical files stay extensionless. Rewrite on the way into vendor/.
  const src = raw.replace(/(from\s+")(\.\/[^"]+)(")/g, (m, a, spec, c) =>
    spec.endsWith(".ts") ? m : a + spec + ".ts" + c);
  const expected = HEADER.replace("<name>", name) + src;
  const target = join(OUT_DIR, name);
  const current = existsSync(target) ? readFileSync(target, "utf8") : null;

  if (current === expected) continue;

  drift += 1;
  if (checkOnly) {
    console.error(`sync-quant: DRIFT ${name} (${hash(current)} != ${hash(expected)})`);
  } else {
    writeFileSync(target, expected);
    console.log(`sync-quant: wrote ${name}`);
  }
}

function hash(s) {
  return s == null ? "missing" : createHash("sha256").update(s).digest("hex").slice(0, 8);
}

if (checkOnly && drift > 0) {
  console.error(`sync-quant: ${drift} file(s) out of date. Run \`npm run quant:sync\`.`);
  process.exit(1);
}
console.log(checkOnly ? "sync-quant: vendored copies up to date" : `sync-quant: ${files.length} file(s) in sync`);
