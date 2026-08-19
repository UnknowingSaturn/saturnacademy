// ============================================================================
// Named strategy configs — loaded from `configs/grid.json` so the UI presets
// and the backtest worker read the SAME definition. A preset is a plain patch
// over `DEFAULT_ENGINE_CONFIG`; nothing here bypasses the engine.
// ============================================================================

import { KILLZONES, RTH, type TradeWindow } from "../sessions";
import type { EngineConfig } from "./engine";
import grid from "./configs/grid.json" with { type: "json" };

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

/**
 * Window key → concrete ET window.
 *   "rth"                → regular trading hours
 *   "et:<start>-<end>"   → custom window, ET minutes-from-midnight
 *   anything else        → a named killzone (unknown keys fall back to NY AM)
 */
export function windowForKey(key: string): TradeWindow {
  if (key === "rth") return RTH;
  if (key.startsWith("et:")) {
    const [a, b] = key.slice(3).split("-").map(Number);
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) {
      return { key, label: `Custom ${etLabel(a)}–${etLabel(b)} ET`, startMin: a, endMin: Math.min(b, 1440) };
    }
  }
  return KILLZONES[key] ?? KILLZONES.ny_am;
}

/** Build the canonical key for a custom ET window. */
export function customWindowKey(startMin: number, endMin: number): string {
  return `et:${Math.max(0, Math.round(startMin))}-${Math.min(1440, Math.round(endMin))}`;
}

function etLabel(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
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
