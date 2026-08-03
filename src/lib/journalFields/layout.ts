import { JournalFieldLayout } from "@/types/settings";
import {
  DEFAULT_TABLE_ORDER,
  DEFAULT_TABLE_HIDDEN,
  DEFAULT_DETAIL_GROUPS,
  DEFAULT_DETAIL_ORDER,
} from "./registry";

const EMPTY_LAYOUT: JournalFieldLayout = {
  table: { order: [], hidden: [] },
  detail: { order: [], hidden: [], groups: [] },
  removed: [],
  labels: {},
};

export function migrateLegacyLayout(
  legacy: {
    visible_columns?: string[];
    column_order?: string[];
    detail_visible_fields?: string[];
    detail_field_order?: string[];
    deleted_system_fields?: string[];
    field_label_overrides?: Record<string, string>;
  } = {}
): JournalFieldLayout {
  const {
    visible_columns = [],
    column_order = [],
    detail_visible_fields = [],
    detail_field_order = [],
    deleted_system_fields = [],
    field_label_overrides = {},
  } = legacy;

  const deletedSet = new Set(deleted_system_fields);

  // Table order: use legacy order, then append any missing default fields.
  const tableOrder = dedupe([
    ...column_order,
    ...DEFAULT_TABLE_ORDER.filter((k) => !column_order.includes(k)),
  ]);

  // Table hidden: fields that were NOT in visible_columns (and not deleted).
  const tableHidden = dedupe(
    tableOrder.filter((k) => !visible_columns.includes(k) && !deletedSet.has(k))
  );

  // Detail order: use legacy order, then append missing defaults.
  const detailOrder = dedupe([
    ...detail_field_order,
    ...DEFAULT_DETAIL_ORDER.filter((k) => !detail_field_order.includes(k)),
  ]);

  // Detail hidden: fields that were NOT in detail_visible_fields (and not deleted).
  const detailVisibleSet = new Set(
    detail_visible_fields.length > 0 ? detail_visible_fields : DEFAULT_DETAIL_ORDER
  );
  const detailHidden = dedupe(
    detailOrder.filter((k) => !detailVisibleSet.has(k) && !deletedSet.has(k))
  );

  // Removed = deleted system fields that are not core and not already in the layout.
  const removed = dedupe([...deleted_system_fields]);

  // Build groups from legacy order if no groups were persisted.
  // We use the default group structure but respect the user's field order.
  const groups = DEFAULT_DETAIL_GROUPS.map((g) => ({
    id: g.id,
    label: g.label,
    fields: dedupe(detailOrder.filter((k) => g.fields.includes(k))),
  })).filter((g) => g.fields.length > 0);

  // Add an ungrouped bucket for any detail fields that don't belong to a default group.
  const groupedFields = new Set(groups.flatMap((g) => g.fields));
  const ungrouped = detailOrder.filter((k) => !groupedFields.has(k));
  if (ungrouped.length > 0) {
    groups.push({ id: "properties", label: "Properties", fields: ungrouped });
  }

  return {
    table: { order: tableOrder, hidden: tableHidden },
    detail: { order: detailOrder, hidden: detailHidden, groups },
    removed,
    labels: { ...field_label_overrides },
  };
}

export function normalizeLayout(
  stored: Partial<JournalFieldLayout> | null | undefined,
  legacy: {
    visible_columns?: string[];
    column_order?: string[];
    detail_visible_fields?: string[];
    detail_field_order?: string[];
    deleted_system_fields?: string[];
    field_label_overrides?: Record<string, string>;
  } = {}
): JournalFieldLayout {
  if (!stored || Object.keys(stored).length === 0) {
    return migrateLegacyLayout(legacy);
  }

  const backfill = migrateLegacyLayout(legacy);

  const order: JournalFieldLayout = {
    table: {
      order: stored.table?.order?.length ? stored.table.order : backfill.table.order,
      hidden: stored.table?.hidden?.length ? stored.table.hidden : backfill.table.hidden,
    },
    detail: {
      order: stored.detail?.order?.length ? stored.detail.order : backfill.detail.order,
      hidden: stored.detail?.hidden?.length ? stored.detail.hidden : backfill.detail.hidden,
      groups: stored.detail?.groups?.length ? stored.detail.groups : backfill.detail.groups,
    },
    removed: stored.removed?.length ? stored.removed : backfill.removed,
    labels: stored.labels && Object.keys(stored.labels).length ? stored.labels : backfill.labels,
  };

  return order;
}

export function defaultLayout(): JournalFieldLayout {
  return {
    table: { order: DEFAULT_TABLE_ORDER, hidden: DEFAULT_TABLE_HIDDEN },
    detail: { order: DEFAULT_DETAIL_ORDER, hidden: [], groups: DEFAULT_DETAIL_GROUPS },
    removed: [],
    labels: {},
  };
}

function dedupe<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}
