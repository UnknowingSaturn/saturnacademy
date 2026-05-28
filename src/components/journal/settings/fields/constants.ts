// Shared constants & helpers for the Fields settings panel.
// COLOR_PALETTE is re-exported from the single source of truth in @/lib/colorPalette.
export { COLOR_PALETTE } from "@/lib/colorPalette";


export const SYSTEM_OPTION_PROPERTY: Record<string, string> = {
  session: "session",
  profile: "profile",
  actual_profile: "profile",
  regime: "regime",
  actual_regime: "regime",
  alignment: "timeframe",
  entry_timeframes: "entry_timeframe",
  emotional_state_before: "emotion",
};

export function kindHint(kind: string): string {
  switch (kind) {
    case "readonly":         return "Auto-filled";
    case "select":           return "Single select";
    case "multi-select":     return "Multi-select";
    case "playbook-select":  return "Playbook";
    case "dual-playbook":    return "Planned + Actual playbook";
    case "dual-select":      return "Planned + Actual select";
    case "dual-multi":       return "Planned + Actual multi-select";
    case "text":             return "Text";
    case "account-select":   return "Account picker";
    default:                 return "";
  }
}

import type { CustomFieldDefinition } from "@/types/settings";

export type FieldRow = {
  key: string;
  defaultLabel: string;
  category: "core" | "system" | "custom";
  description?: string;
  optionsPropertyName?: string;
  customDef?: CustomFieldDefinition;
  isInTable: boolean;
  isInDetail: boolean;
};
