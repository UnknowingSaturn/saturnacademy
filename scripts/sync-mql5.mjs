#!/usr/bin/env node
/**
 * mql5/ → distribution targets sync + drift check.
 *
 * Canonical source of truth lives in /mql5. This script copies each EA into
 * every place that serves or bundles it, then verifies that critical shared
 * constants (endpoint URLs, project ref) are identical across every copy.
 *
 * Usage:
 *   node scripts/sync-mql5.mjs            # sync + check (default)
 *   node scripts/sync-mql5.mjs --check    # verify only, fail if drift
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// canonical → list of distribution targets
const DISTRIBUTION = {
  "TradeJournalBridge.mq5": [
    "public/TradeJournalBridge.mq5",
    "mt5-bridge/TradeJournalBridge.mq5",
  ],
  "TradeCopierMaster.mq5": [
    "public/TradeCopierMaster.mq5",
    "mt5-bridge/TradeCopierMaster.mq5",
    "copier-desktop/src-tauri/resources/TradeCopierMaster.mq5",
  ],
  "TradeCopierReceiver.mq5": [
    "public/TradeCopierReceiver.mq5",
    "mt5-bridge/TradeCopierReceiver.mq5",
    "copier-desktop/src-tauri/resources/TradeCopierReceiver.mq5",
  ],
};

// Constants that MUST match across every copy.  Regex captures the value.
const SHARED_CONSTANTS = [
  { name: "EDGE_FUNCTION_URL", re: /EDGE_FUNCTION_URL\s*=\s*"([^"]+)"/ },
  { name: "SYNC_STATE_URL", re: /SYNC_STATE_URL\s*=\s*"([^"]+)"/, optional: true },
  { name: "PROJECT_REF_HOST", re: /"https:\/\/([a-z0-9]+)\.supabase\.co\/functions\/v1\/ingest-events"/ },
];

const args = new Set(process.argv.slice(2));
const checkOnly = args.has("--check");

const sha = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 12);

function readCanonical(name) {
  const p = join(ROOT, "mql5", name);
  if (!existsSync(p)) {
    console.error(`✗ Missing canonical file: mql5/${name}`);
    process.exit(1);
  }
  return readFileSync(p);
}

function extractConstants(name, source) {
  const text = source.toString("utf8");
  const result = {};
  for (const { name: k, re, optional } of SHARED_CONSTANTS) {
    const m = text.match(re);
    if (!m) {
      if (optional) continue;
      console.error(`✗ ${name}: missing required constant ${k}`);
      process.exit(1);
    }
    result[k] = m[1];
  }
  return result;
}

function sync() {
  console.log("→ Syncing mql5/ to distribution targets");
  for (const [name, targets] of Object.entries(DISTRIBUTION)) {
    const buf = readCanonical(name);
    for (const rel of targets) {
      const out = join(ROOT, rel);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, buf);
      console.log(`  ✓ ${rel}  [${sha(buf)} · ${buf.length}b]`);
    }
  }
}

function check() {
  console.log("→ Verifying distribution copies match canonical");
  let drift = 0;
  // 1. byte-identical check
  for (const [name, targets] of Object.entries(DISTRIBUTION)) {
    const canonical = readCanonical(name);
    const canHash = sha(canonical);
    for (const rel of targets) {
      const out = join(ROOT, rel);
      if (!existsSync(out)) {
        console.error(`  ✗ MISSING ${rel}`);
        drift++;
        continue;
      }
      const got = readFileSync(out);
      const gotHash = sha(got);
      if (gotHash !== canHash) {
        console.error(`  ✗ DRIFT ${rel}  (got ${gotHash}, want ${canHash})`);
        drift++;
      }
    }
  }
  // 2. shared-constant check across canonical files
  console.log("→ Verifying shared constants across EAs");
  const seen = {};
  for (const name of Object.keys(DISTRIBUTION)) {
    const buf = readCanonical(name);
    const c = extractConstants(name, buf);
    for (const [k, v] of Object.entries(c)) {
      if (!seen[k]) seen[k] = { value: v, files: [name] };
      else if (seen[k].value !== v) {
        console.error(`  ✗ ${k} drift: ${seen[k].files.join(",")}=${seen[k].value} vs ${name}=${v}`);
        drift++;
      } else {
        seen[k].files.push(name);
      }
    }
  }
  for (const [k, { value, files }] of Object.entries(seen)) {
    console.log(`  ✓ ${k} = ${value}  (${files.length} files)`);
  }
  if (drift > 0) {
    console.error(`\n✗ ${drift} drift issue(s) found. Run \`bun run mql5:sync\`.`);
    process.exit(1);
  }
  console.log("✓ All distribution copies in sync");
}

if (checkOnly) {
  check();
} else {
  sync();
  check();
}
