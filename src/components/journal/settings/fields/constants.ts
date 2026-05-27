// Shared constants & helpers for the Fields settings panel

export const COLOR_PALETTE = [
  "#EF4444", "#F97316", "#F59E0B", "#EAB308", "#84CC16",
  "#22C55E", "#10B981", "#14B8A6", "#06B6D4", "#0EA5E9",
  "#3B82F6", "#6366F1", "#8B5CF6", "#A855F7", "#D946EF",
  "#EC4899", "#F43F5E", "#6B7280",
];

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
