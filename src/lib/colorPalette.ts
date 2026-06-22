/**
 * Single source of truth for the color-picker palette used by playbooks,
 * sessions, custom-field options, and the property-options editor.
 *
 * Eighteen hand-picked Tailwind-derived hues that read well on both light
 * and dark backgrounds. Add/reorder here and every picker updates.
 */
export const COLOR_PALETTE: readonly string[] = [
  "#EF4444", "#F97316", "#F59E0B", "#EAB308", "#84CC16",
  "#22C55E", "#10B981", "#14B8A6", "#06B6D4", "#0EA5E9",
  "#3B82F6", "#6366F1", "#8B5CF6", "#A855F7", "#D946EF",
  "#EC4899", "#F43F5E", "#6B7280",
] as const;

