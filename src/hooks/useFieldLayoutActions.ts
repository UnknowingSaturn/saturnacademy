import { useCallback, useMemo } from "react";
import { useUserSettings, useUpdateUserSettings } from "@/hooks/useUserSettings";
import { JournalFieldLayout } from "@/types/settings";

/**
 * Single entry point for every journal field-layout mutation.
 *
 * Both the settings dialog and the inline (Notion-style) menus on the table
 * header / detail panel call these, so the two surfaces can never disagree.
 */
export function useFieldLayoutActions() {
  const { data: settings } = useUserSettings();
  const updateSettings = useUpdateUserSettings();

  const layout = settings?.journal_field_layout;
  const labels = useMemo(() => settings?.field_label_overrides || {}, [settings?.field_label_overrides]);

  const save = useCallback(
    async (next: JournalFieldLayout) => {
      // Keep legacy columns written (unread) for one release as a rollback path.
      const visibleColumns = next.table.order.filter((k) => !next.table.hidden.includes(k));
      const detailOrder = next.detail.groups.flatMap((g) => g.fields);
      const detailVisible = detailOrder.filter((k) => !next.detail.hidden.includes(k));

      await updateSettings.mutateAsync({
        journal_field_layout: next,
        visible_columns: visibleColumns,
        column_order: next.table.order,
        detail_field_order: detailOrder,
        detail_visible_fields: detailVisible,
        deleted_system_fields: next.removed,
      });
    },
    [updateSettings],
  );

  const clone = useCallback((l: JournalFieldLayout): JournalFieldLayout => ({
    table: { order: [...l.table.order], hidden: [...l.table.hidden] },
    detail: {
      order: [...(l.detail.order || [])],
      hidden: [...l.detail.hidden],
      groups: l.detail.groups.map((g) => ({ ...g, fields: [...g.fields] })),
    },
    removed: [...l.removed],
    labels: { ...(l.labels || {}) },
  }), []);

  // ── Table ────────────────────────────────────────────────────────────────
  const hideColumn = useCallback(async (key: string) => {
    if (!layout) return;
    const next = clone(layout);
    if (!next.table.hidden.includes(key)) next.table.hidden.push(key);
    await save(next);
  }, [layout, clone, save]);

  const showColumn = useCallback(async (key: string, afterKey?: string) => {
    if (!layout) return;
    const next = clone(layout);
    next.table.hidden = next.table.hidden.filter((k) => k !== key);
    next.removed = next.removed.filter((k) => k !== key);
    next.table.order = next.table.order.filter((k) => k !== key);
    const idx = afterKey ? next.table.order.indexOf(afterKey) : -1;
    if (idx >= 0) next.table.order.splice(idx + 1, 0, key);
    else next.table.order.push(key);
    await save(next);
  }, [layout, clone, save]);

  const moveColumn = useCallback(async (key: string, direction: -1 | 1) => {
    if (!layout) return;
    const visible = layout.table.order.filter((k) => !layout.table.hidden.includes(k));
    const pos = visible.indexOf(key);
    const targetKey = visible[pos + direction];
    if (pos < 0 || !targetKey) return;
    const next = clone(layout);
    const from = next.table.order.indexOf(key);
    const to = next.table.order.indexOf(targetKey);
    if (from < 0 || to < 0) return;
    next.table.order.splice(from, 1);
    next.table.order.splice(to, 0, key);
    await save(next);
  }, [layout, clone, save]);

  const reorderColumns = useCallback(async (order: string[]) => {
    if (!layout) return;
    const next = clone(layout);
    next.table.order = order;
    await save(next);
  }, [layout, clone, save]);

  // ── Detail ───────────────────────────────────────────────────────────────
  const hideDetailField = useCallback(async (key: string) => {
    if (!layout) return;
    const next = clone(layout);
    next.detail.groups.forEach((g) => { g.fields = g.fields.filter((k) => k !== key); });
    if (!next.detail.hidden.includes(key)) next.detail.hidden.push(key);
    await save(next);
  }, [layout, clone, save]);

  const addDetailField = useCallback(async (key: string, groupId?: string) => {
    if (!layout) return;
    const next = clone(layout);
    next.detail.hidden = next.detail.hidden.filter((k) => k !== key);
    next.removed = next.removed.filter((k) => k !== key);
    next.detail.groups.forEach((g) => { g.fields = g.fields.filter((k) => k !== key); });
    if (next.detail.groups.length === 0) {
      next.detail.groups.push({ id: "properties", label: "Properties", fields: [] });
    }
    const target = next.detail.groups.find((g) => g.id === groupId) ?? next.detail.groups[0];
    target.fields.push(key);
    await save(next);
  }, [layout, clone, save]);

  const moveFieldToGroup = useCallback(async (key: string, groupId: string) => {
    await addDetailField(key, groupId);
  }, [addDetailField]);

  const reorderGroupFields = useCallback(async (groupId: string, fields: string[]) => {
    if (!layout) return;
    const next = clone(layout);
    const g = next.detail.groups.find((x) => x.id === groupId);
    if (!g) return;
    g.fields = fields;
    await save(next);
  }, [layout, clone, save]);

  const addGroup = useCallback(async (label = "New group") => {
    if (!layout) return;
    const next = clone(layout);
    next.detail.groups.push({ id: `group_${Date.now()}`, label, fields: [] });
    await save(next);
  }, [layout, clone, save]);

  const renameGroup = useCallback(async (groupId: string, label: string) => {
    if (!layout || !label.trim()) return;
    const next = clone(layout);
    const g = next.detail.groups.find((x) => x.id === groupId);
    if (!g) return;
    g.label = label.trim();
    await save(next);
  }, [layout, clone, save]);

  const deleteGroup = useCallback(async (groupId: string) => {
    if (!layout) return;
    const next = clone(layout);
    const g = next.detail.groups.find((x) => x.id === groupId);
    if (!g) return;
    next.detail.groups = next.detail.groups.filter((x) => x.id !== groupId);
    next.detail.hidden.push(...g.fields.filter((k) => !next.detail.hidden.includes(k)));
    await save(next);
  }, [layout, clone, save]);

  // ── Removal / restore ────────────────────────────────────────────────────
  const removeField = useCallback(async (key: string) => {
    if (!layout) return;
    const next = clone(layout);
    next.table.order = next.table.order.filter((k) => k !== key);
    next.table.hidden = next.table.hidden.filter((k) => k !== key);
    next.detail.groups.forEach((g) => { g.fields = g.fields.filter((k) => k !== key); });
    next.detail.hidden = next.detail.hidden.filter((k) => k !== key);
    if (!next.removed.includes(key)) next.removed.push(key);
    await save(next);
  }, [layout, clone, save]);

  const restoreField = useCallback(async (key: string) => {
    if (!layout) return;
    const next = clone(layout);
    next.removed = next.removed.filter((k) => k !== key);
    if (!next.table.order.includes(key)) next.table.order.push(key);
    next.table.hidden = next.table.hidden.filter((k) => k !== key);
    const inDetail =
      next.detail.groups.some((g) => g.fields.includes(key)) || next.detail.hidden.includes(key);
    if (!inDetail) {
      if (next.detail.groups.length === 0) {
        next.detail.groups.push({ id: "properties", label: "Properties", fields: [] });
      }
      next.detail.groups[0].fields.push(key);
    }
    await save(next);
  }, [layout, clone, save]);

  // ── Labels ───────────────────────────────────────────────────────────────
  const renameField = useCallback(async (key: string, label: string) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    await updateSettings.mutateAsync({
      field_label_overrides: { ...labels, [key]: trimmed },
      column_overrides: {
        ...(settings?.column_overrides || {}),
        [key]: { ...((settings?.column_overrides || {})[key] || {}), label: trimmed },
      },
    });
  }, [labels, settings?.column_overrides, updateSettings]);

  const resetFieldLabel = useCallback(async (key: string) => {
    const nextLabels = { ...labels };
    delete nextLabels[key];
    const nextCol = { ...(settings?.column_overrides || {}) };
    if (nextCol[key]) {
      const { label, ...rest } = nextCol[key];
      if (Object.keys(rest).length === 0) delete nextCol[key];
      else nextCol[key] = rest;
    }
    await updateSettings.mutateAsync({
      field_label_overrides: nextLabels,
      column_overrides: nextCol,
    });
  }, [labels, settings?.column_overrides, updateSettings]);

  return {
    layout,
    labels,
    saveLayout: save,
    hideColumn,
    showColumn,
    moveColumn,
    reorderColumns,
    hideDetailField,
    addDetailField,
    moveFieldToGroup,
    reorderGroupFields,
    addGroup,
    renameGroup,
    deleteGroup,
    removeField,
    restoreField,
    renameField,
    resetFieldLabel,
  };
}
