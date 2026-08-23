import { Account } from "@/types/trading";
import { CustomFieldDefinition } from "@/types/settings";

export type FieldSource =
  | { kind: "trades"; column: string }
  | { kind: "trade_reviews"; column: string }
  | { kind: "computed"; id: string }
  | { kind: "custom"; key: string };

export type FieldValueType =
  | "text"
  | "number"
  | "money"
  | "percent"
  | "date"
  | "badge"
  | "select"
  | "multi_select"
  | "playbook"
  | "account"
  | "duration"
  | "readonly";

export type FieldSurface = "table" | "detail";

export interface FieldDef {
  key: string;
  label: string;
  group: "core" | "system" | "custom";
  valueType: FieldValueType;
  source: FieldSource;
  editor?: FieldValueType;
  optionsProperty?: string;
  surfaces: FieldSurface[];
  erasable: boolean;
  width?: string;
  // Per-key render override name (used for special cells like result, symbol, closes)
  renderKey?: string;
  // If true, the table header should be right-aligned
  alignRight?: boolean;
  // If true, the table header should be centered
  alignCenter?: boolean;
}

// Core fields cannot be removed, only hidden/renamed.
const core = (def: Omit<FieldDef, "group" | "erasable">): FieldDef => ({
  ...def,
  group: "core",
  erasable: false,
});

const system = (def: Omit<FieldDef, "group" | "erasable"> & { erasable?: boolean }): FieldDef => ({
  ...def,
  group: "system",
  erasable: def.erasable ?? true,
});

const computed = (id: string): FieldSource => ({ kind: "computed", id });
const trades = (column: string): FieldSource => ({ kind: "trades", column });
const reviews = (column: string): FieldSource => ({ kind: "trade_reviews", column });

export const JOURNAL_FIELD_REGISTRY: FieldDef[] = [
  // ── Core / calculated fields ───────────────────────────────────────────────
  core({
    key: "trade_number",
    label: "#",
    valueType: "readonly",
    source: trades("trade_number"),
    surfaces: ["table", "detail"],
    width: "minmax(40px, 0.4fr)",
  }),
  core({
    key: "entry_time",
    label: "Date (EST)",
    valueType: "date",
    source: trades("entry_time"),
    surfaces: ["table", "detail"],
    width: "minmax(110px, 1.5fr)",
  }),
  core({
    key: "day",
    label: "Day",
    valueType: "readonly",
    source: computed("day"),
    surfaces: ["table", "detail"],
    width: "minmax(50px, 0.5fr)",
  }),
  core({
    key: "symbol",
    label: "Pair",
    valueType: "readonly",
    source: trades("symbol"),
    surfaces: ["table", "detail"],
    width: "minmax(70px, 1fr)",
    renderKey: "symbol",
  }),
  core({
    key: "account",
    label: "Account",
    valueType: "account",
    source: trades("account_id"),
    surfaces: ["table", "detail"],
    width: "minmax(80px, 1fr)",
  }),
  core({
    key: "direction",
    label: "Direction",
    valueType: "badge",
    source: trades("direction"),
    surfaces: ["table", "detail"],
    width: "minmax(70px, 0.7fr)",
    renderKey: "direction",
  }),
  core({
    key: "net_pnl",
    label: "P&L",
    valueType: "money",
    source: trades("net_pnl"),
    surfaces: ["table", "detail"],
    width: "minmax(80px, 1fr)",
    alignRight: true,
  }),
  core({
    key: "r_multiple_actual",
    label: "RR",
    valueType: "number",
    source: trades("r_multiple_actual"),
    surfaces: ["table", "detail"],
    width: "minmax(60px, 0.8fr)",
    alignRight: true,
  }),
  core({
    key: "account_pct",
    label: "Acct %",
    valueType: "percent",
    source: computed("account_pct"),
    surfaces: ["table", "detail"],
    width: "minmax(70px, 0.9fr)",
    alignRight: true,
  }),
  core({
    key: "result",
    label: "Result",
    valueType: "badge",
    source: computed("result"),
    surfaces: ["table"],
    width: "minmax(70px, 0.8fr)",
    alignCenter: true,
    renderKey: "result",
  }),
  core({
    key: "trade_type",
    label: "Type",
    valueType: "badge",
    source: trades("trade_type"),
    surfaces: ["table"],
    width: "minmax(80px, 1fr)",
  }),
  core({
    key: "status",
    label: "Status",
    valueType: "badge",
    source: computed("status"),
    surfaces: ["table"],
    width: "minmax(80px, 0.9fr)",
    alignCenter: true,
    renderKey: "status",
  }),
  core({
    key: "read_quality",
    label: "Read",
    valueType: "badge",
    source: computed("read_quality"),
    surfaces: ["table"],
    width: "minmax(70px, 0.8fr)",
    alignCenter: true,
    renderKey: "read_quality",
  }),
  core({
    key: "closes",
    label: "Closes",
    valueType: "number",
    source: computed("closes"),
    surfaces: ["table"],
    width: "minmax(60px, 0.7fr)",
    alignCenter: true,
    renderKey: "closes",
  }),
  core({
    key: "duration_seconds",
    label: "Duration",
    valueType: "duration",
    source: trades("duration_seconds"),
    surfaces: ["table", "detail"],
    width: "minmax(70px, 0.8fr)",
  }),

  // ── Editable system fields ───────────────────────────────────────────────────
  system({
    key: "session",
    label: "Session",
    valueType: "select",
    source: trades("session"),
    editor: "select",
    optionsProperty: "session",
    surfaces: ["table", "detail"],
    width: "minmax(90px, 1.2fr)",
  }),
  system({
    key: "model",
    label: "Planned Model",
    valueType: "playbook",
    source: trades("playbook_id"),
    editor: "playbook",
    surfaces: ["table", "detail"],
    width: "minmax(90px, 1.5fr)",
  }),
  system({
    key: "actual_model",
    label: "Actual Model",
    valueType: "playbook",
    source: trades("actual_playbook_id"),
    editor: "playbook",
    surfaces: ["table", "detail"],
    width: "minmax(90px, 1.5fr)",
  }),
  system({
    key: "profile",
    label: "Planned Profile",
    valueType: "select",
    source: trades("profile"),
    editor: "select",
    optionsProperty: "profile",
    surfaces: ["table", "detail"],
    width: "minmax(90px, 1.2fr)",
  }),
  system({
    key: "actual_profile",
    label: "Actual Profile",
    valueType: "select",
    source: trades("actual_profile"),
    editor: "select",
    optionsProperty: "profile",
    surfaces: ["table", "detail"],
    width: "minmax(90px, 1.2fr)",
  }),
  system({
    key: "regime",
    label: "Planned Regime",
    valueType: "select",
    source: reviews("regime"),
    editor: "select",
    optionsProperty: "regime",
    surfaces: ["table", "detail"],
    width: "minmax(90px, 1.2fr)",
    erasable: true,
  }),
  system({
    key: "actual_regime",
    label: "Actual Regime",
    valueType: "select",
    source: trades("actual_regime"),
    editor: "select",
    optionsProperty: "regime",
    surfaces: ["table", "detail"],
    width: "minmax(90px, 1.2fr)",
    erasable: true,
  }),
  system({
    key: "alignment",
    label: "HTF Timeframes",
    valueType: "multi_select",
    source: trades("alignment"),
    editor: "multi_select",
    optionsProperty: "timeframe",
    surfaces: ["table", "detail"],
    width: "minmax(90px, 1.2fr)",
    erasable: true,
  }),
  system({
    key: "entry_timeframes",
    label: "Entry Timeframes",
    valueType: "multi_select",
    source: trades("entry_timeframes"),
    editor: "multi_select",
    optionsProperty: "entry_timeframe",
    surfaces: ["table", "detail"],
    width: "minmax(90px, 1.2fr)",
    erasable: true,
  }),
  system({
    key: "emotional_state_before",
    label: "Emotion",
    valueType: "select",
    source: reviews("emotional_state_before"),
    editor: "select",
    optionsProperty: "emotion",
    surfaces: ["table", "detail"],
    width: "minmax(90px, 1.2fr)",
    erasable: true,
  }),
  system({
    key: "place",
    label: "Place",
    valueType: "text",
    source: trades("place"),
    editor: "text",
    surfaces: ["table", "detail"],
    width: "minmax(80px, 1fr)",
    erasable: true,
  }),
];

export const JOURNAL_FIELD_MAP = new Map<string, FieldDef>(
  JOURNAL_FIELD_REGISTRY.map((f) => [f.key, f])
);

export function getFieldDef(key: string): FieldDef | undefined {
  return JOURNAL_FIELD_MAP.get(key);
}

export function buildFieldRegistry(
  customFields: CustomFieldDefinition[] = [],
  accountList: Account[] = []
): FieldDef[] {
  const custom = customFields
    .filter((f) => f.is_active)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((f): FieldDef => {
      const valueType: FieldValueType =
        f.type === "multi_select"
          ? "multi_select"
          : f.type === "select"
          ? "select"
          : f.type === "number"
          ? "number"
          : f.type === "checkbox"
          ? "badge"
          : "text";
      return {
        key: f.key,
        label: f.label,
        group: "custom",
        valueType,
        source: { kind: "custom", key: f.key },
        editor: valueType,
        surfaces: ["table", "detail"],
        erasable: true,
        width: "minmax(100px, 1.2fr)",
      };
    });

  return [...JOURNAL_FIELD_REGISTRY, ...custom];
}

/**
 * Resolve a field's display name.
 * Pass `fallbackLabel` (the label from the *built* registry) so custom fields
 * resolve to their name instead of their storage key.
 */
export function resolveFieldLabel(
  key: string,
  fallbackOrOverrides?: string | Record<string, string>,
  maybeOverrides?: Record<string, string>
): string {
  const fallbackLabel = typeof fallbackOrOverrides === "string" ? fallbackOrOverrides : undefined;
  const labelOverrides =
    (typeof fallbackOrOverrides === "string" ? maybeOverrides : fallbackOrOverrides) ?? {};
  return (
    labelOverrides[key]?.trim() ||
    JOURNAL_FIELD_MAP.get(key)?.label ||
    fallbackLabel?.trim() ||
    key
  );
}


/**
 * Single source of truth for user-renamed field labels.
 * `journal_field_layout.labels` is canonical; the legacy `field_label_overrides`
 * and `column_overrides[key].label` stores are read only as migration fallbacks.
 */
export function resolveLabelMap(settings?: {
  journal_field_layout?: { labels?: Record<string, string> } | null;
  field_label_overrides?: Record<string, string> | null;
  column_overrides?: Record<string, { label?: string }> | null;
} | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, ov] of Object.entries(settings?.column_overrides || {})) {
    if (ov?.label?.trim()) out[key] = ov.label.trim();
  }
  for (const [key, label] of Object.entries(settings?.field_label_overrides || {})) {
    if (label?.trim()) out[key] = label.trim();
  }
  for (const [key, label] of Object.entries(settings?.journal_field_layout?.labels || {})) {
    if (label?.trim()) out[key] = label.trim();
  }
  return out;
}


export const DEFAULT_TABLE_ORDER = [
  "trade_number",
  "entry_time",
  "day",
  "symbol",
  "r_multiple_actual",
  "account_pct",
  "result",
  "session",
  "model",
  "alignment",
  "entry_timeframes",
  "profile",
  "emotional_state_before",
  "place",
];

export const DEFAULT_TABLE_HIDDEN = [
  "direction",
  "net_pnl",
  "status",
  "closes",
  "trade_type",
  "duration_seconds",
  "account",
];

export const DEFAULT_DETAIL_GROUPS = [
  {
    id: "overview",
    label: "Overview",
    fields: [
      "status",
      "account",
      "symbol",
      "day",
      "entry_time",
      "direction",
      "net_pnl",
      "r_multiple_actual",
      "account_pct",
    ],
  },
  {
    id: "setup",
    label: "Setup",
    fields: [
      "session",
      "model",
      "actual_model",
      "profile",
      "actual_profile",
      "regime",
      "actual_regime",
      "alignment",
      "entry_timeframes",
      "place",
    ],
  },
  {
    id: "psychology",
    label: "Psychology",
    fields: ["emotional_state_before"],
  },
];

// Default detail order flattened from groups above.
export const DEFAULT_DETAIL_ORDER = DEFAULT_DETAIL_GROUPS.flatMap((g) => g.fields);
