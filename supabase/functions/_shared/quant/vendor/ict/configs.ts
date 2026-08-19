// GENERATED FILE — DO NOT EDIT.
// Vendored copy of shared/quant/ict/configs.ts for the Deno edge bundler.
// Edit the canonical file at shared/quant/ and run `npm run quant:sync`.
// ============================================================================
// Named strategy configs — loaded from `configs/grid.json` so the UI presets
// and the backtest worker read the SAME definition. A preset is a plain patch
// over `DEFAULT_ENGINE_CONFIG`; nothing here bypasses the engine.
// ============================================================================

import { KILLZONES, RTH, type TradeWindow } from "../sessions.ts";
import type { EngineConfig } from "./engine.ts";
import grid from "./configs/grid.json.ts" with { type: "json" };

export interface NamedConfig {
  key: string;
  label: string;
  blurb: string;
  windowKeys: string[];
  /** Engine field patch, minus `windows` (which comes from `windowKeys`). */
  patch: Partial<Omit<EngineConfig, "windows">>;
}

export const NAMED_CONFIGS: NamedConfig[] = (grid as { configs: NamedConfig[] }).configs;

export function namedConfig(key: string): NamedConfig | undefined {
  return NAMED_CONFIGS.find((c) => c.key === key);
}

/** Window key → concrete ET window. Unknown keys fall back to NY AM. */
export function windowForKey(key: string): TradeWindow {
  return key === "rth" ? RTH : (KILLZONES[key] ?? KILLZONES.ny_am);
}

export function windowsForKeys(keys: string[]): TradeWindow[] {
  const seen = new Set<string>();
  const out: TradeWindow[] = [];
  for (const k of keys) {
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(windowForKey(k));
  }
  return out.length ? out : [KILLZONES.ny_am];
}

/** Full engine patch for a named config, windows included. */
export function engineConfigFor(key: string): Partial<EngineConfig> | undefined {
  const c = namedConfig(key);
  if (!c) return undefined;
  return { ...c.patch, windows: windowsForKeys(c.windowKeys) };
}
